// Does the store ever hand back the bytes an overwrite replaced?
//
// Two cache headers in store.ts make a claim about time. `CACHE_IMMUTABLE`
// says a year, and `unit.json` carries it and is then rewritten in place when
// the claims beside a bundle move while its id does not. `CACHE_POINTER` says
// 5 s, and half of the 15 s propagation window quoted in README.md is that
// number. Both claims are about what a reader can still be holding.
//
//   bun run scripts/probe-edge-cache.ts
//
// Three cases, each on its own throwaway key under `probe/`:
//
//   C  max-age=5      warmed and read UNSIGNED, as a browser or the origin
//                     reads a pointer.
//   D  max-age=1 year warmed and read UNSIGNED, as a browser reads a bundle.
//   E  max-age=1 year warmed and read SIGNED, as the promote gate reads a
//                     unit.json.
//
// Each case writes "one", reads it three times to fill whatever cache is in
// the path, rewrites the SAME key to "two", and then reads until "two" comes
// back. The reading is that delay. A number near zero means no reader was
// holding the old copy. A number near the max-age means the header's window is
// real and the code above has to live inside it.
//
// Read the unsigned rows with one caution: a request-side cache directive
// invalidates the case. `fetch` is called plain here for that reason - adding
// `cache: "no-store"` makes a browser send no-cache headers, which can bypass
// an edge and turn the probe into a measurement of the origin.
//
// It writes only under `probe/`, and deletes both on the way out, including
// after a throw. No unit moves and no channel is promoted.

import {
  CACHE_IMMUTABLE,
  CACHE_POINTER,
  configFromEnv,
  deleteObject,
  getObjectText,
  publicUrl,
  putObject,
} from "./store.ts";

const cfg = configFromEnv();
const BUDGET_MS = Number(Bun.env.PROBE_BUDGET_MS ?? 30_000);
const EVERY_MS = Number(Bun.env.PROBE_EVERY_MS ?? 250);

const body = (v: string) => new TextEncoder().encode(`${JSON.stringify({ v })}\n`);

const put = (key: string, cacheControl: string, v: string) =>
  putObject(cfg, key, body(v), { contentType: "application/json; charset=utf-8", cacheControl });

/** Plain fetch. No request-side cache directives - see the head of this file. */
async function readUnsigned(key: string): Promise<string | null> {
  const res = await fetch(publicUrl(cfg, key));
  if (!res.ok) return null;
  return JSON.parse(await res.text()).v as string;
}

async function readSigned(key: string): Promise<string | null> {
  const text = await getObjectText(cfg, key);
  return text === null ? null : (JSON.parse(text).v as string);
}

type Case = {
  name: string;
  cacheControl: string;
  read: (key: string) => Promise<string | null>;
};

const CASES: Case[] = [
  { name: "C  max-age=5      unsigned", cacheControl: CACHE_POINTER, read: readUnsigned },
  { name: "D  max-age=1 year unsigned", cacheControl: CACHE_IMMUTABLE, read: readUnsigned },
  { name: "E  max-age=1 year signed  ", cacheControl: CACHE_IMMUTABLE, read: readSigned },
];

/** How long after a rewrite the key first reads back as the new bytes. */
async function measure(c: Case, key: string): Promise<{ warm: string[]; ms: number | null }> {
  await put(key, c.cacheControl, "one");
  const warm: string[] = [];
  for (let i = 0; i < 3; i++) warm.push(String(await c.read(key)));

  const at = Date.now();
  await put(key, c.cacheControl, "two");
  while (Date.now() - at < BUDGET_MS) {
    if ((await c.read(key)) === "two") return { warm, ms: Date.now() - at };
    await Bun.sleep(EVERY_MS);
  }
  return { warm, ms: null };
}

const stamp = Date.now();
const keys: string[] = [];
let stale = 0;

console.log(`bucket ${cfg.bucket}, budget ${(BUDGET_MS / 1000).toFixed(0)} s\n`);
try {
  for (const [i, c] of CASES.entries()) {
    const key = `probe/edge-cache-${stamp}-${i}.json`;
    keys.push(key);
    const { warm, ms } = await measure(c, key);
    const held = warm.every((v) => v === "one");
    const read = ms === null
      ? `STILL the old bytes after ${(BUDGET_MS / 1000).toFixed(0)} s`
      : `new bytes at ${(ms / 1000).toFixed(2)} s`;
    if (ms === null || ms > 1_000) stale++;
    console.log(`${c.name}  warmed ${held ? "3/3" : warm.join(",")}  ${read}`);
  }
} finally {
  for (const key of keys) await deleteObject(cfg, key).catch(() => {});
}

console.log(
  stale === 0
    ? `\nNo path held the replaced bytes for as long as a second. The rewrite of a\n` +
      `unit.json in publish.ts is safe, and the 5 s half of the propagation window\n` +
      `did not appear on this client's path.`
    : `\n${stale} of ${CASES.length} paths held the replaced bytes for over a second.\n` +
      `Read the comment on CACHE_IMMUTABLE in scripts/store.ts: it says the opposite.`,
);
