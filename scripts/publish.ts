// Uploads each changed unit to the store. Affects no visitor: publishing and
// deploying are two commands, and this is the one that is safe to run at any
// time.
//
// A unit's manifest - unit.json - is written LAST, after every file it names is
// readable. That ordering is the whole reason `promote` can trust a unit.json's
// existence as proof the unit is complete.
//
// A unit id is a hash of that unit's own output, so a unit whose bytes did not
// change already exists in the store and is skipped. That is what makes
// "change alpha, publish alpha" upload one directory rather than five.

import {
  CACHE_IMMUTABLE,
  configFromEnv,
  contentTypeFor,
  getObjectText,
  publicUrl,
  putObject,
} from "./store.ts";
import { UNITS, type Unit } from "./contract.ts";
import type { Source } from "./source.ts";

type UnitRecord = {
  id: string;
  js: string;
  css: string | null;
  imports?: Record<string, string>;
  files: string[];
  integrity: Record<string, string>;
  contracts: string[];
  provides?: Record<string, string>;
  uses?: Record<string, string>;
  subapps?: string[];
  blocks?: Record<string, string>;
  api?: string[];
  shared: Record<string, string>;
  marker: string;
};

type BuildRecord = {
  schema: 3;
  contract: string;
  source?: Source;
  units: Record<string, UnitRecord>;
};

/** What a published unit says about itself. */
export type UnitManifest = {
  schema: 3;
  unit: string;
  id: string;
  commit: string;
  dirty: boolean;
  publishedAt: string;
  assetBase: string;
  js: string;
  css: string | null;
  imports?: Record<string, string>;
  files: string[];
  /** File name to SRI digest. Absent on a unit published before digests. */
  integrity?: Record<string, string>;
  contracts: string[];
  /**
   * The shell: every removable member of its surface, member path to digest.
   *
   * Absent on a unit published before the member reading existed, and `promote`
   * falls back to the contract sets when either side of a pair lacks it.
   */
  provides?: Record<string, string>;
  /** A sub-app: the members it uses, member path to digest. Absent, as above. */
  uses?: Record<string, string>;
  /** The `subapp.d.ts` halves this unit compiles against. Absent, as above. */
  subapps?: string[];
  /**
   * The shell: which fields of the server's JSON blocks it reads, §11.
   *
   * Compared by the running SERVER and not by `promote`, because the party on
   * the other side is a deployed image rather than a published unit.
   */
  blocks?: Record<string, string>;
  /**
   * The shell: which versions of the external API it calls, §13.
   *
   * Compared by the running server too, and for a third reason: the party on
   * the other side is neither an image nor a unit but a separate deploy whose
   * surface no compiler here owns.
   */
  api?: string[];
  shared: Record<string, string>;
  marker: string;
};

const record = (await Bun.file("dist/build.json").json().catch(() => null)) as BuildRecord | null;
if (!record || record.schema !== 3) {
  console.error("dist/build.json is missing or is not a schema 3 record. Run `bun run build` first.");
  process.exit(1);
}
if (!record.source) {
  console.error("dist/build.json records no source. Run `bun run build` first.");
  process.exit(1);
}

/** Publish one named unit, or all five. */
const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
for (const name of only) {
  if (!UNITS.includes(name as Unit)) {
    console.error(`unknown unit ${JSON.stringify(name)}. Expected one of ${UNITS.join(", ")}.`);
    process.exit(1);
  }
}
const wanted: readonly Unit[] = only.length ? (only as Unit[]) : UNITS;

// The BUILD's source, not the tree's. Asking git here would label bytes with
// whatever is checked out at publish time, which is a different question and
// answers it wrong the moment anything is committed between the two commands.
const { commit, dirty } = record.source;

const cfg = configFromEnv();
const published: Record<string, string> = {};
const width = Math.max(...UNITS.map((u) => u.length));

export const unitPrefix = (unit: string, id: string) => `units/${unit}/${id}`;

for (const unit of wanted) {
  const built = record.units[unit];
  if (!built) {
    console.error(`dist/build.json has no record for ${unit}. Run \`bun run build\`.`);
    process.exit(1);
  }

  const prefix = unitPrefix(unit, built.id);
  const manifestKey = `${prefix}/unit.json`;
  const existing = (await getObjectText(cfg, manifestKey).then((t) =>
    t === null ? null : (JSON.parse(t) as UnitManifest),
  )) as UnitManifest | null;

  // Provenance is upgraded, never replaced. Two commits can produce the same
  // bytes, so the first publish of them owns the record - except when that
  // record says `dirty`, which means "these bytes came from an uncommitted
  // working tree" and stops being true the moment a clean tree produces them.
  // Without this the first publish of a bundle decides its commit forever, and
  // one publish from a dirty tree leaves a unit permanently claiming a commit
  // that does not contain its own source.
  const upgrade = existing !== null && existing.dirty && !dirty;
  const provenance =
    existing && !upgrade ? { commit: existing.commit, dirty: existing.dirty } : { commit, dirty };

  const manifest: UnitManifest = {
    schema: 3,
    unit,
    id: built.id,
    ...provenance,
    publishedAt: existing?.publishedAt ?? new Date().toISOString(),
    assetBase: `${publicUrl(cfg, prefix)}/`,
    js: built.js,
    css: built.css,
    ...(built.imports ? { imports: built.imports } : {}),
    files: built.files,
    integrity: built.integrity,
    contracts: built.contracts,
    ...(built.provides ? { provides: built.provides } : {}),
    ...(built.uses ? { uses: built.uses } : {}),
    ...(built.subapps ? { subapps: built.subapps } : {}),
    ...(built.blocks ? { blocks: built.blocks } : {}),
    ...(built.api ? { api: built.api } : {}),
    shared: built.shared,
    marker: built.marker,
  };

  if (existing) {
    // The id is a hash of the bytes, so an existing id means the bundle is
    // already there and identical. What the unit.json CLAIMS beside it can
    // still be out of date, in two ways:
    //
    //   contracts  the shell may since have dropped an export this unit never
    //              used, so it now compiles against a contract it was
    //              published before.
    //   provides   the surface changed shape without changing this shell's
    //   uses       bytes, or a member this app uses was re-declared. Both are
    //              derived from the surface and not from the bundle, so both
    //              can move while the id does not - and the promote gate reads
    //              them, so a stale one would let through what it exists to
    //              refuse.
    //   integrity  a unit published before digests were recorded carries none,
    //              and the browser then checks nothing for it.
    //   provenance a unit first published from a dirty tree names a commit
    //              that does not contain its own source. See above.
    //
    // The bundle stays immutable; the claim beside it is rewritten.
    const sameSet =
      existing.contracts.length === built.contracts.length &&
      existing.contracts.every((c, i) => c === built.contracts[i]);
    const canon = (d: Record<string, string> = {}) =>
      JSON.stringify(Object.entries(d).sort(([a], [b]) => a.localeCompare(b)));
    const sameDigests = canon(existing.integrity) === canon(manifest.integrity);
    const list = (v: string[] = []) => JSON.stringify([...v].sort());
    const sameMembers =
      canon(existing.provides) === canon(manifest.provides) &&
      canon(existing.uses) === canon(manifest.uses) &&
      canon(existing.blocks) === canon(manifest.blocks) &&
      list(existing.api) === list(manifest.api) &&
      list(existing.subapps) === list(manifest.subapps);
    if (sameSet && sameDigests && sameMembers && !upgrade) {
      console.error(`  ${unit.padEnd(width)} ${built.id}  unchanged`);
      published[unit] = built.id;
      continue;
    }
    await putObject(
      cfg,
      manifestKey,
      new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
      { contentType: "application/json; charset=utf-8", cacheControl: CACHE_IMMUTABLE },
    );
    const changed = [
      sameSet
        ? null
        : `contracts ${existing.contracts.join(",") || "none"} -> ${built.contracts.join(",")}`,
      sameDigests ? null : `digests for ${Object.keys(manifest.integrity ?? {}).length} files`,
      sameMembers
        ? null
        : `members ${Object.keys(manifest.provides ?? manifest.uses ?? {}).length}`,
      upgrade ? `commit ${existing.commit.slice(0, 8)} dirty -> ${commit.slice(0, 8)} clean` : null,
    ].filter(Boolean);
    console.error(`  ${unit.padEnd(width)} ${built.id}  ${changed.join(", ")}`);
    published[unit] = built.id;
    continue;
  }

  for (const name of built.files) {
    const file = Bun.file(`dist/units/${unit}/${name}`);
    await putObject(cfg, `${prefix}/${name}`, new Uint8Array(await file.arrayBuffer()), {
      contentType: contentTypeFor(name),
      cacheControl: CACHE_IMMUTABLE,
    });
  }

  await putObject(
    cfg,
    manifestKey,
    new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    { contentType: "application/json; charset=utf-8", cacheControl: CACHE_IMMUTABLE },
  );

  console.error(`  ${unit.padEnd(width)} ${built.id}  uploaded ${built.files.length} files`);
  published[unit] = built.id;
}

// stdout carries the unit ids and nothing else, so this composes:
//   ids=$(bun run --silent publish)
//   bun run promote qa --app "alpha=$(echo "$ids" | jq -r .alpha)"
console.log(JSON.stringify(published, null, 2));
