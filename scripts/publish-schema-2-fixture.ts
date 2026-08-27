// Publishes the schema 2 fixture: one build directory, one assetBase, and a
// manifest in the shape a channel held before units were published separately.
//
//   bun run build
//   bun run fixture:schema-2
//
// Why it exists. Both channels a visitor can reach are schema 3, so no browser
// has ever loaded a page assembled the schema 2 way. The server still parses
// schema 2 and a channel can still be rolled back onto a pointer written before
// the split - manifest.test.ts covers the parser - but whether such a page
// RENDERS is a different claim, and nothing was making it. A parser cannot
// answer it: schema 2 shares ONE assetBase across every unit and resolves the
// import map against that one base, and whether five bundles fetched that way
// still make one application is only observable in a browser.
//
// The output is kept twice, and neither copy is rebuilt by a test run:
//
//   legacy/schema-2/<id>/   in the store, which nothing deletes
//   features/support/fixtures/schema-2.json   here, committed
//
// features/rolling-back-onto-an-older-schema.feature writes those bytes to a
// test-* channel's pointer and loads the page. A fixture rebuilt on every run
// would be today's bundles under yesterday's schema, which is not the
// operation being claimed.
//
// Re-running this is a skip when nothing changed: the prefix is a hash of the
// file names, so an identical build is already in the store.

import { mkdir } from "node:fs/promises";
import {
  CACHE_IMMUTABLE,
  configFromEnv,
  contentTypeFor,
  getObjectText,
  publicUrl,
  putObject,
  urlsInManifest,
  warmAll,
} from "./store.ts";
import { APPS, UNITS, type Unit } from "./contract.ts";

const FIXTURE_PATH = "features/support/fixtures/schema-2.json";

type UnitRecord = {
  id: string;
  js: string;
  css: string | null;
  imports?: Record<string, string>;
  files: string[];
  marker: string;
};

type BuildRecord = { schema: 3; contract: string; units: Record<string, UnitRecord> };

/** A manifest in the shape the server read before each unit carried its own base. */
export type SchemaTwoManifest = {
  schema: 2;
  buildId: string;
  commit: string;
  publishedAt: string;
  assetBase: string;
  shell: { js: string; css: string };
  imports: Record<string, string>;
  apps: Record<string, { js: string; css?: string }>;
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

// dist/ is shared, and e2e, verify:live and falsify all overwrite it with
// throwaway builds. The same tell promote.ts uses: a marker is set only by a
// harness. This fixture is permanent, so a marker baked into it would be
// permanent too.
const marked = UNITS.filter((u) => (record.units[u]?.marker ?? "") !== "");
if (marked.length > 0) {
  console.error(
    `refusing: dist/build.json is a harness build. ${marked
      .map((u) => `${u}=${JSON.stringify(record.units[u]!.marker)}`)
      .join(", ")}`,
  );
  console.error("Run `bun run build` and publish the fixture again.");
  process.exit(1);
}

const shell = record.units.shell;
if (!shell) {
  console.error("dist/build.json has no record for the shell. Run `bun run build`.");
  process.exit(1);
}
if (!shell.css) {
  console.error("the shell emitted no stylesheet, and schema 2 names one. Nothing was uploaded.");
  process.exit(1);
}
if (!shell.imports || Object.keys(shell.imports).length === 0) {
  console.error("the shell emitted no import map, so no sub-app could resolve. Nothing was uploaded.");
  process.exit(1);
}

/**
 * Where each unit's file goes inside the ONE directory.
 *
 * The shell's own files sit at the base, because its import map names them
 * relative to it. Sub-apps go under apps/, which is where schema 2 put them -
 * and which is why the browser steps match an asset by its FILE NAME: the
 * directory belongs to the schema, not to the application.
 */
const relative = (unit: Unit, file: string): string => (unit === "shell" ? file : `apps/${file}`);

const uploads: Array<{ unit: Unit; file: string; rel: string }> = [];
for (const unit of UNITS) {
  const built = record.units[unit];
  if (!built) {
    console.error(`dist/build.json has no record for ${unit}. Run \`bun run build\`.`);
    process.exit(1);
  }
  for (const file of built.files) uploads.push({ unit, file, rel: relative(unit, file) });
}

// Content-addressed, like a unit id: the emitted names already carry the
// content, so an identical build lands on the identical prefix and uploads
// nothing.
const id = new Bun.CryptoHasher("sha256")
  .update(JSON.stringify(uploads.map((u) => u.rel).sort()))
  .digest("hex")
  .slice(0, 8);

const cfg = configFromEnv();
const prefix = `legacy/schema-2/${id}`;
const manifestKey = `${prefix}/manifest.json`;
const assetBase = `${publicUrl(cfg, prefix)}/`;

const existing = (await getObjectText(cfg, manifestKey).then((t) =>
  t === null ? null : (JSON.parse(t) as SchemaTwoManifest),
)) as SchemaTwoManifest | null;

const manifest: SchemaTwoManifest = existing ?? {
  schema: 2,
  // Schema 2 had one build id for the whole page, and the served HTML reports
  // it. It is what the scenario reads to know which schema answered.
  buildId: `schema2-${id}`,
  commit: git(["rev-parse", "HEAD"]) ?? "0".repeat(40),
  publishedAt: new Date().toISOString(),
  assetBase,
  shell: { js: shell.js, css: shell.css },
  imports: shell.imports,
  apps: Object.fromEntries(
    APPS.map((app) => {
      const built = record.units[app]!;
      return [
        app,
        {
          js: relative(app, built.js),
          ...(built.css ? { css: relative(app, built.css) } : {}),
        },
      ];
    }),
  ),
};

if (existing) {
  console.error(`  ${manifest.buildId}  unchanged, already in the store`);
} else {
  for (const { unit, file, rel } of uploads) {
    const body = Bun.file(`dist/units/${unit}/${file}`);
    await putObject(cfg, `${prefix}/${rel}`, new Uint8Array(await body.arrayBuffer()), {
      contentType: contentTypeFor(file),
      cacheControl: CACHE_IMMUTABLE,
    });
  }
  // Last, after every file it names is readable, for the reason publish.ts
  // writes unit.json last: its existence is what makes the fixture trustable.
  await putObject(
    cfg,
    manifestKey,
    new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
    { contentType: "application/json; charset=utf-8", cacheControl: CACHE_IMMUTABLE },
  );
  console.error(`  ${manifest.buildId}  uploaded ${uploads.length} files to ${prefix}/`);
}

// A fixture nobody can fetch is not a fixture. This also fills the edge, so the
// scenario that points a channel here is not the first visitor through a cold
// one - the failure that once cost a visitor over 30 s.
const urls = urlsInManifest(manifest);
const { warmed, failed } = await warmAll(urls);
console.error(`  fetched ${warmed}/${urls.length} of the files it names`);
if (failed.length) {
  console.error(`the fixture is incomplete. Nothing here can be trusted:\n  ${failed.join("\n  ")}`);
  process.exit(1);
}

await mkdir("features/support/fixtures", { recursive: true });
await Bun.write(FIXTURE_PATH, `${JSON.stringify(manifest, null, 2)}\n`);
console.error(`  wrote ${FIXTURE_PATH}`);

console.log(JSON.stringify({ buildId: manifest.buildId, assetBase }, null, 2));
