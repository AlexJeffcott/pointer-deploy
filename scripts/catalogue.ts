// One object naming every published unit, so nothing has to be enumerated by
// hand to find a build worth promoting.
//
// The record it is built from already existed: every publish writes
// `units/<name>/<id>/unit.json`, and a LIST of `units/` finds all of them. What
// did not exist was one place to read that from. A browser cannot LIST a
// bucket, and a script that could would still be answering the question one
// key at a time.
//
// So the catalogue is DERIVED and never authored. `publish` rebuilds it from a
// LIST rather than appending an entry to it, which is the whole reason it can
// be trusted: a write lost to a crash, or to two publishers at once, heals on
// the next publish. An appended file would carry that loss forever, and a file
// that can silently disagree with the store is the thing this replaces.
//
// A build the harness made is listed like any other. It has to be: 112 of the
// 129 units in the live store on 2026-08-31 carried a marker, and a record that
// leaves out 87 per cent of what was published is not the record of what was
// published. WHICH of them a channel may serve is a different question, and the
// server answers it in `mergeKnown` - where the channel is known, and where a
// marked unit reaches a `test-*` channel and no other. `bun run units` hides
// them unless asked, for the same reason and not the same mechanism.
//
// A rebuild re-reads only what changed. The LIST reports when each `unit.json`
// was last written, and `publish` rewrites one in place whenever the claims
// beside a bundle change - the contracts, the members, the digests - so an
// entry cached against an immutable id would go stale exactly where the
// compatibility gate reads it. Cached against that timestamp it cannot.

import {
  CACHE_POINTER,
  getObjectText,
  listObjectDetails,
  putObject,
  type StoreConfig,
} from "./store.ts";
import { UNITS } from "./contract.ts";
import type { UnitManifest } from "./publish.ts";
import type { ComposedUnit } from "../src/server/manifest.ts";
import {
  CATALOGUE_KEY,
  parseHistory,
  type Catalogue,
  type HistoryEntry,
  type UnitSurface,
} from "../src/server/composition.ts";

export { CATALOGUE_KEY } from "../src/server/composition.ts";

/** How many `unit.json` reads are in flight at once while rebuilding. */
const CONCURRENCY = 16;

/**
 * What a manifest says a page must fetch to run this unit.
 *
 * `promote` writes the same object into a channel history, and both read it
 * back through the same parser. One mapping, so a field that stops being copied
 * here stops being copied there too rather than in one of the two.
 */
export const composedUnit = (m: UnitManifest): ComposedUnit => ({
  unitId: m.id,
  commit: m.commit,
  assetBase: m.assetBase,
  js: m.js,
  css: m.css,
  ...(m.imports ? { imports: m.imports } : {}),
  ...(m.integrity && Object.keys(m.integrity).length ? { integrity: m.integrity } : {}),
  marker: m.marker ?? "",
});

/** What a manifest says about the type surface, for the compatibility gate. */
export const surfaceOfManifest = (m: UnitManifest): UnitSurface => ({
  provides: m.provides,
  uses: m.uses,
  subapps: m.subapps,
  blocks: m.blocks,
  api: m.api,
});

export const entryOf = (m: UnitManifest, recordedAt: string): HistoryEntry => ({
  unit: composedUnit(m),
  contracts: m.contracts ?? [],
  surface: surfaceOfManifest(m),
  publishedAt: m.publishedAt,
  dirty: m.dirty,
  recordedAt,
});

/** Runs `work` over `items`, at most `limit` at a time. */
async function pooled<I, O>(items: I[], limit: number, work: (item: I) => Promise<O>): Promise<O[]> {
  const out: O[] = new Array(items.length);
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await work(items[i]!);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export type BuiltCatalogue = {
  catalogue: Catalogue;
  /** How many `unit.json` objects the LIST found. */
  scanned: number;
  /** How many of those were taken from the previous catalogue rather than read. */
  reused: number;
  /** How many carry a harness marker. Listed, and offered only on a `test-*` channel. */
  marked: number;
  /** How many could not be read or parsed, and were left out. */
  unreadable: number;
};

/** `units/<name>/<id>/unit.json` -> `<name>`. The key is what says which unit it is. */
export const unitNameOf = (key: string): string | null => key.split("/")[1] ?? null;

export type Read = { name: string; entry: HistoryEntry };

/**
 * Reads every published unit and groups it by name, newest publish first.
 *
 * `previous` is a catalogue to reuse entries from. An entry is reused only when
 * the store still reports the same `LastModified` for that unit's `unit.json`,
 * so a claim rewritten beside an unchanged bundle is always re-read.
 */
export async function buildCatalogue(
  cfg: StoreConfig,
  previous: Catalogue | null = null,
): Promise<BuiltCatalogue> {
  const listed = (await listObjectDetails(cfg, "units/")).filter((o) =>
    o.key.endsWith("/unit.json"),
  );

  const cached = new Map<string, HistoryEntry>();
  for (const [name, entries] of Object.entries(previous?.units ?? {})) {
    for (const e of entries) {
      if (e.recordedAt) cached.set(`units/${name}/${e.unit.unitId}/unit.json`, e);
    }
  }

  let reused = 0;
  const read = await pooled(listed, CONCURRENCY, async (o): Promise<Read | null> => {
    const name = unitNameOf(o.key);
    if (name === null) return null;
    const kept = cached.get(o.key);
    if (kept && kept.recordedAt === o.lastModified) {
      reused++;
      return { name, entry: kept };
    }
    const text = await getObjectText(cfg, o.key);
    if (text === null) return null;
    try {
      return { name, entry: entryOf(JSON.parse(text) as UnitManifest, o.lastModified) };
    } catch {
      return null;
    }
  });

  return { ...catalogueFrom(read), scanned: listed.length, reused };
}

/** Groups what was read into a catalogue. Pure, so the ordering can be shown without a store. */
export function catalogueFrom(read: (Read | null)[]): Omit<BuiltCatalogue, "scanned" | "reused"> {
  let marked = 0;
  let unreadable = 0;
  const units: Record<string, HistoryEntry[]> = {};
  for (const r of read) {
    if (r === null || !r.entry.unit.unitId) {
      unreadable++;
      continue;
    }
    if ((r.entry.unit.marker ?? "") !== "") marked++;
    (units[r.name] ??= []).push(r.entry);
  }

  // Newest publish first, so the switcher and the printed table both read
  // top-down. The id breaks a tie, so two units published in the same
  // millisecond do not swap places between two rebuilds of the same store.
  for (const list of Object.values(units)) {
    list.sort((a, b) => {
      const at = a.publishedAt ?? "";
      const bt = b.publishedAt ?? "";
      return at === bt ? a.unit.unitId.localeCompare(b.unit.unitId) : at < bt ? 1 : -1;
    });
  }

  // The five units in their own order, so a reader sees the shell where the
  // shell always is rather than wherever the bucket happened to list it.
  const ordered: Record<string, HistoryEntry[]> = {};
  for (const name of [...UNITS, ...Object.keys(units)]) {
    if (units[name] && !ordered[name]) ordered[name] = units[name]!;
  }

  return {
    catalogue: { schema: 1, updatedAt: new Date().toISOString(), units: ordered },
    marked,
    unreadable,
  };
}

export async function writeCatalogue(cfg: StoreConfig, catalogue: Catalogue): Promise<void> {
  await putObject(
    cfg,
    CATALOGUE_KEY,
    new TextEncoder().encode(`${JSON.stringify(catalogue, null, 2)}\n`),
    // Short, not immutable. Every other object under `units/` names its own
    // content and never changes; this one changes on every publish.
    { contentType: "application/json; charset=utf-8", cacheControl: CACHE_POINTER },
  );
}

export async function rebuildCatalogue(
  cfg: StoreConfig,
  previous: Catalogue | null = null,
): Promise<BuiltCatalogue> {
  const built = await buildCatalogue(cfg, previous);
  await writeCatalogue(cfg, built.catalogue);
  return built;
}

/** The catalogue as it stands in the store, or null if nothing readable is there. */
export async function readCatalogue(cfg: StoreConfig): Promise<Catalogue | null> {
  const text = await getObjectText(cfg, CATALOGUE_KEY);
  if (text === null) return null;
  return parseHistory(JSON.parse(text));
}

export const countOf = (catalogue: Catalogue): number =>
  Object.values(catalogue.units).reduce((n, list) => n + list.length, 0);
