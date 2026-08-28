// Removes what no channel can serve any more.
//
//   bun run scripts/sweep-superseded.ts             # says what it would delete
//   bun run scripts/sweep-superseded.ts --delete    # does it. Irreversible
//
// Two steps, in this order and never the other way round:
//
//   1. every channel's history drops the entries whose contract set does not
//      include a RETAINED contract. A history naming a unit whose files are
//      gone offers a visitor a build that cannot be served.
//   2. every object under units/ belonging to a unit no history and no pointer
//      names, plus builds/ and probe/, which are the pre-schema-3 layout and a
//      one-off measurement.
//
// legacy/ is exempt and the sweep refuses to run if anything under it reaches
// the delete set. The schema 2 rollback scenarios point a channel at that
// fixture, and it is the only schema 2 composition there is - a retention
// policy that expired it would delete evidence rather than rubbish.

import {
  CACHE_POINTER,
  configFromEnv,
  deleteObject,
  getObjectText,
  listObjects,
  putObject,
} from "./store.ts";
import { readRegistry } from "./contract.ts";

type Entry = { unit: { unitId: string }; contracts?: string[] };

const REGION = Bun.env.STORE_REGION ?? "eu";
const CHANNELS = ["qa", "prod", "test-qa", "test-prod"];
const DELETE = process.argv.includes("--delete");

const cfg = configFromEnv();
const retained = new Set((await readRegistry()).retained);
if (retained.size === 0) throw new Error("the registry retains no contract; refusing to sweep");
console.error(`retained: ${[...retained].join(", ")}`);

// -- 1. the histories -------------------------------------------------------

const live = new Set<string>();
const drops: Array<{ key: string; doc: unknown; dropped: number }> = [];

for (const ch of CHANNELS) {
  const pointer = await getObjectText(cfg, `manifests/${REGION}/${ch}.json`);
  if (pointer) {
    for (const m of pointer.matchAll(/units\/([a-z]+)\/([0-9a-f]+)\//g)) live.add(`${m[1]}/${m[2]}`);
  }
  const key = `manifests/${REGION}/${ch}.history.json`;
  const text = await getObjectText(cfg, key);
  if (!text) continue;
  const doc = JSON.parse(text) as { units: Record<string, Entry[]> } & Record<string, unknown>;
  let dropped = 0;
  for (const [unit, entries] of Object.entries(doc.units)) {
    const kept = entries.filter((e) => (e.contracts ?? []).some((c) => retained.has(c)));
    dropped += entries.length - kept.length;
    for (const e of kept) live.add(`${unit}/${e.unit.unitId}`);
    doc.units[unit] = kept;
  }
  doc.updatedAt = new Date().toISOString();
  drops.push({ key, doc, dropped });
  console.error(`${ch}: ${dropped} history entries name no retained contract`);
}

// -- 2. the objects ---------------------------------------------------------

const unitKeys = (await listObjects(cfg, "units/")).filter(
  (k) => !live.has(k.split("/").slice(1, 3).join("/")),
);
const buildKeys = await listObjects(cfg, "builds/");
const probeKeys = await listObjects(cfg, "probe/");
const all = [...unitKeys, ...buildKeys, ...probeKeys];

const trespass = all.filter((k) => k.startsWith("legacy/"));
if (trespass.length) {
  throw new Error(`refusing: ${trespass.length} legacy/ keys reached the delete set`);
}

console.error(
  `\n${all.length} objects to remove: ${unitKeys.length} under units/, ` +
    `${buildKeys.length} under builds/, ${probeKeys.length} under probe/`,
);
console.error(`${live.size} unit directories are still named by a channel and stay.`);

if (!DELETE) {
  console.error("\nnothing was changed. Pass --delete to carry it out.");
  process.exit(0);
}

for (const d of drops) {
  await putObject(cfg, d.key, new TextEncoder().encode(JSON.stringify(d.doc)), {
    contentType: "application/json",
    cacheControl: CACHE_POINTER,
  });
}
console.error("histories rewritten");

let done = 0;
for (let i = 0; i < all.length; i += 24) {
  await Promise.all(all.slice(i, i + 24).map((k) => deleteObject(cfg, k)));
  done += Math.min(24, all.length - i);
  if (done % 480 === 0) console.error(`  ${done}/${all.length}`);
}
console.error(`deleted ${done}. ${(await listObjects(cfg, "")).length} objects remain.`);
