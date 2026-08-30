// Which regions a promote writes, and when it must refuse to, §3.
//
// A channel names one composition, and a machine reads the manifest for its own
// region alone. So a promote that wrote one region would leave every other
// region serving what it served before - silently, because nothing compares
// them and each machine is answering correctly from what it can see.
//
// The default is therefore every region, and the two readings here are what
// make that safe:
//
//   the region flag   `--region us` writes one, for a deliberate difference
//   the drift check   two regions already serving different compositions is a
//                     state a promote must not flatten by accident
//
// Pure. The store reads are in promote.ts.

import { REGIONS, type Region } from "../src/server/origins.ts";

export { REGIONS, type Region };

/** What a pointer names, or null for a region that has no pointer yet. */
export type RegionComposition = {
  region: Region;
  /** Unit name to unit id. Null when nothing is published there. */
  ids: Record<string, string> | null;
};

/**
 * The regions this invocation writes.
 *
 * An unknown region is refused rather than ignored: `--region eu1` writing
 * every region because the flag did not match anything is the accident this
 * exists to prevent.
 */
export function regionsFor(argv: string[]): { regions: Region[] } | { error: string } {
  const i = argv.indexOf("--region");
  if (i === -1) return { regions: [...REGIONS] };
  const named = argv[i + 1];
  if (!named) return { error: `--region takes a region: ${REGIONS.join(", ")}` };
  if (!(REGIONS as readonly string[]).includes(named)) {
    return { error: `unknown region ${JSON.stringify(named)}. Expected one of ${REGIONS.join(", ")}.` };
  }
  return { regions: [named as Region] };
}

/**
 * Why these regions cannot be written together, or null.
 *
 * A region with no pointer is not a disagreement - it is the state a first
 * promote is there to fix, and refusing it would make a new region
 * unreachable except by hand. Two regions that BOTH name a composition, and
 * name different ones, is the state that has to stop a promote: whichever one
 * an operator merged onto, the other would be overwritten with a composition
 * nobody chose for it.
 */
export function regionDrift(compositions: RegionComposition[]): string | null {
  const known = compositions.filter((c) => c.ids !== null) as Array<
    RegionComposition & { ids: Record<string, string> }
  >;
  if (known.length < 2) return null;

  const first = known[0]!;
  for (const other of known.slice(1)) {
    const differing = unitsThatDiffer(first.ids, other.ids);
    if (differing.length === 0) continue;
    return (
      `${first.region} and ${other.region} serve different compositions: ` +
      differing
        .map((u) => `${u} ${first.ids[u] ?? "none"} != ${other.ids[u] ?? "none"}`)
        .join(", ") +
      `. Writing both would replace one with a composition nobody chose for it. ` +
      `Name one with --region <${REGIONS.join("|")}>.`
    );
  }
  return null;
}

/** One pointer and one history, per region per channel. */
export type ManifestKeys = {
  region: Region;
  channel: string;
  pointer: string;
  history: string;
};

/**
 * Every manifest key a reader has to look at to see the whole deploy.
 *
 * The sweep is why this exists. A sweep that read one region would see the
 * other region's pointers and histories as naming nothing at all, and would
 * delete the units a machine there is serving - a reading that is wrong in the
 * one direction that cannot be undone.
 */
export function manifestKeys(channels: readonly string[]): ManifestKeys[] {
  return REGIONS.flatMap((region) =>
    channels.map((channel) => ({
      region,
      channel,
      pointer: `manifests/${region}/${channel}.json`,
      history: `manifests/${region}/${channel}.history.json`,
    })),
  );
}

/** Unit names the two compositions disagree about, including one-sided ones. */
export function unitsThatDiffer(
  a: Record<string, string>,
  b: Record<string, string>,
): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((u) => a[u] !== b[u]).sort();
}
