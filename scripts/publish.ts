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

type UnitRecord = {
  id: string;
  js: string;
  css: string | null;
  imports?: Record<string, string>;
  files: string[];
  contracts: string[];
  shared: Record<string, string>;
  marker: string;
};

type BuildRecord = {
  schema: 3;
  contract: string;
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
  contracts: string[];
  shared: Record<string, string>;
  marker: string;
};

const git = (args: string[]): string | null => {
  const r = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? new TextDecoder().decode(r.stdout).trim() : null;
};

const record = (await Bun.file("dist/build.json").json().catch(() => null)) as BuildRecord | null;
if (!record || record.schema !== 3) {
  console.error("dist/build.json is missing or is not a schema 3 record. Run `bun run build` first.");
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

const commit = git(["rev-parse", "HEAD"]) ?? "0".repeat(40);
const dirty = (git(["status", "--porcelain"]) ?? "") !== "";

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

  const manifest: UnitManifest = {
    schema: 3,
    unit,
    id: built.id,
    commit,
    dirty,
    publishedAt: existing?.publishedAt ?? new Date().toISOString(),
    assetBase: `${publicUrl(cfg, prefix)}/`,
    js: built.js,
    css: built.css,
    ...(built.imports ? { imports: built.imports } : {}),
    files: built.files,
    contracts: built.contracts,
    shared: built.shared,
    marker: built.marker,
  };

  if (existing) {
    // The id is a hash of the bytes, so an existing id means the bundle is
    // already there and identical. Its CONTRACT SET can still be out of date:
    // the shell may since have dropped an export this unit never used, which
    // makes this unit compile against a contract it was published before. The
    // bundle stays immutable; the claim beside it does not.
    const sameSet =
      existing.contracts.length === built.contracts.length &&
      existing.contracts.every((c, i) => c === built.contracts[i]);
    if (sameSet) {
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
    console.error(
      `  ${unit.padEnd(width)} ${built.id}  contracts ` +
        `${existing.contracts.join(",") || "none"} -> ${built.contracts.join(",")}`,
    );
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
