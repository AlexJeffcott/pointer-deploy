// Uploads a build to the store. Affects no visitor: publishing and deploying
// are two commands, and this is the one that is safe to run at any time.
//
// The manifest is written LAST, after every file it names is readable. That
// ordering is the whole reason `promote` can trust a manifest's existence as
// proof the build is complete.

import { basename } from "node:path";
import {
  CACHE_IMMUTABLE,
  configFromEnv,
  contentTypeFor,
  objectExists,
  publicUrl,
  putObject,
} from "./store.ts";

const force = process.argv.includes("--force");

const git = (args: string[]): string | null => {
  const r = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? new TextDecoder().decode(r.stdout).trim() : null;
};

type BuildRecord = { entry: { js: string; css: string }; files: string[] };

const record = (await Bun.file("dist/build.json").json().catch(() => null)) as BuildRecord | null;
if (!record) {
  console.error("dist/build.json is missing. Run `bun run build` first.");
  process.exit(1);
}

const commit = git(["rev-parse", "HEAD"]) ?? "0".repeat(40);
const short = git(["rev-parse", "--short", "HEAD"]);
const dirty = (git(["status", "--porcelain"]) ?? "") !== "";

// The commit identifies the source. It does NOT identify the artefact: the
// same commit built with different build-time configuration produces a
// different bundle, and keying the id on the commit alone makes those two
// collide - overwriting one build with the other, or refusing a genuinely new
// build as already published. So the id carries both.
//
// Same commit and same output -> same id, so republishing is correctly refused.
// Same commit, different output -> different ids, so neither is lost.
const content = new Bun.CryptoHasher("sha256")
  .update(`${record.entry.js}:${record.entry.css}`)
  .digest("hex")
  .slice(0, 8);
const source = short ? (dirty ? `${short}-dirty` : short) : "nogit";
const buildId = `${source}-${content}`;

const cfg = configFromEnv();
const prefix = `builds/${buildId}`;
const manifestKey = `${prefix}/manifest.json`;

if (!force && (await objectExists(cfg, manifestKey))) {
  console.error(
    `build ${buildId} is already published. A published build is immutable; ` +
      `commit your changes or pass --force.`,
  );
  process.exit(1);
}

for (const name of record.files) {
  const file = Bun.file(`dist/${name}`);
  await putObject(cfg, `${prefix}/${basename(name)}`, new Uint8Array(await file.arrayBuffer()), {
    contentType: contentTypeFor(name),
    cacheControl: CACHE_IMMUTABLE,
  });
  console.error(`  uploaded ${name}`);
}

const manifest = {
  schema: 1,
  buildId,
  commit,
  publishedAt: new Date().toISOString(),
  assetBase: `${publicUrl(cfg, prefix)}/`,
  entry: record.entry,
};

await putObject(
  cfg,
  manifestKey,
  new TextEncoder().encode(`${JSON.stringify(manifest, null, 2)}\n`),
  { contentType: "application/json; charset=utf-8", cacheControl: CACHE_IMMUTABLE },
);
console.error(`  uploaded manifest.json`);

// stdout carries the build id and nothing else, so this composes:
//   bun run promote qa "$(bun run --silent publish)"
console.log(buildId);
