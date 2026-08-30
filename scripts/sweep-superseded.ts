// Removes what no channel can serve any more, and not before it is safe to.
//
//   bun run sweep                        # says what it would delete
//   bun run sweep --delete               # does it. Irreversible
//   bun run sweep --floor-days 30        # a shorter floor, stated out loud
//
// Two readings decide, and both have to allow it:
//
//   1. no channel can serve it. Its unit is in no pointer, and in no history
//      entry whose contract set includes a RETAINED contract.
//   2. the retention floor, §5. 90 days from the later of when the object was
//      written and when a channel stopped serving it. A tab opened before a
//      promote keeps its composition and fetches a sub-app's files whenever
//      somebody opens that view, so a unit that stopped being served an hour
//      ago is still in use by pages nothing can reach.
//
// The policy itself is in retention.ts and is decided there against a clock the
// caller passes in. This file reads the store, prints the plan, and carries it
// out.
//
// A history entry is dropped only for a unit whose files are actually deleted:
// the drop exists so the switcher cannot offer a build whose files are gone,
// and dropping one whose files stay would retire a build the floor is keeping.
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
  listObjectDetails,
  putObject,
} from "./store.ts";
import { readRegistry } from "./contract.ts";
import { manifestKeys } from "./regions.ts";
import { FLOOR_DAYS, heldByReason, retentionPlan, type HistoryReading } from "./retention.ts";

type Entry = { unit: { unitId: string }; contracts?: string[]; supersededAt?: string };

// §3. Every region, and this is not a detail. A sweep that read one region
// would see the other region's pointers and histories as naming nothing, and
// would delete the units a machine there is serving right now.
const CHANNELS = ["qa", "prod", "test-qa", "test-prod"];
const argv = process.argv.slice(2);
const DELETE = argv.includes("--delete");

const daysFlag = argv.indexOf("--floor-days");
const floorDays = daysFlag === -1 ? FLOOR_DAYS : Number(argv[daysFlag + 1]);
if (!Number.isFinite(floorDays) || floorDays < 0) {
  throw new Error(`--floor-days ${argv[daysFlag + 1]} is not a number of days`);
}

const cfg = configFromEnv();
const retained = new Set((await readRegistry()).retained);
if (retained.size === 0) throw new Error("the registry retains no contract; refusing to sweep");
console.error(`retained: ${[...retained].join(", ")}`);
if (floorDays < FLOOR_DAYS) {
  // Stated out loud, in the style --no-source-check is. The floor is the whole
  // of §5, so lowering it is a decision an operator makes on the command line
  // and never something a default does quietly.
  console.error(
    `WARNING the retention floor is ${floorDays} days, not ${FLOOR_DAYS}. ` +
      `A tab opened before a promote can still be fetching these files.`,
  );
}

// -- what the store holds ---------------------------------------------------

const pointed = new Set<string>();
const histories: HistoryReading[] = [];
/** The raw documents, so a rewrite keeps every field this script does not read. */
const docs = new Map<string, { units: Record<string, Entry[]> } & Record<string, unknown>>();
for (const { region, channel, pointer: pointerKey, history: key } of manifestKeys(CHANNELS)) {
  const pointer = await getObjectText(cfg, pointerKey);
  if (pointer) {
    for (const m of pointer.matchAll(/units\/([a-z]+)\/([0-9a-f]+)\//g)) {
      pointed.add(`units/${m[1]}/${m[2]}`);
    }
  }
  const text = await getObjectText(cfg, key);
  if (!text) continue;
  const doc = JSON.parse(text) as { units: Record<string, Entry[]> } & Record<string, unknown>;
  docs.set(key, doc);
  histories.push({
    channel,
    region,
    updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : new Date().toISOString(),
    units: Object.fromEntries(
      Object.entries(doc.units).map(([unit, entries]) => [
        unit,
        entries.map((e) => ({
          unitId: e.unit.unitId,
          contracts: e.contracts ?? [],
          ...(e.supersededAt ? { supersededAt: e.supersededAt } : {}),
        })),
      ]),
    ),
  });
}

const objects = [
  ...(await listObjectDetails(cfg, "units/")),
  ...(await listObjectDetails(cfg, "builds/")),
  ...(await listObjectDetails(cfg, "probe/")),
];

// -- the plan ---------------------------------------------------------------

const plan = retentionPlan({
  now: Date.now(),
  floorDays,
  objects,
  pointed,
  histories,
  retained,
});

const trespass = plan.deleteKeys.filter((k) => k.startsWith("legacy/"));
if (trespass.length) {
  throw new Error(`refusing: ${trespass.length} legacy/ keys reached the delete set`);
}

const counts = heldByReason(plan.held);
const under = (prefix: string) => plan.deleteKeys.filter((k) => k.startsWith(prefix)).length;

console.error(
  `\n${plan.deleteKeys.length} objects to remove: ${under("units/")} under units/, ` +
    `${under("builds/")} under builds/, ${under("probe/")} under probe/`,
);
console.error(
  `${counts.served} unit directories are being served and ${counts.offered} are still offered ` +
    `by a switcher.`,
);
console.error(
  `The ${floorDays}-day floor holds ${counts.young} written since ${plan.cutoff} and ` +
    `${counts["recently served"]} that a channel stopped serving after it.`,
);
console.error(`${plan.historyDrops.length} history entries name a unit being deleted.`);

if (!DELETE) {
  console.error("\nnothing was changed. Pass --delete to carry it out.");
  process.exit(0);
}

// -- carry it out -----------------------------------------------------------

for (const [key, doc] of docs) {
  const drops = plan.historyDrops.filter(
    (d) => `manifests/${d.region}/${d.channel}.history.json` === key,
  );
  if (drops.length === 0) continue;
  for (const [unit, entries] of Object.entries(doc.units)) {
    doc.units[unit] = entries.filter(
      (e) => !drops.some((d) => d.unit === unit && d.unitId === e.unit.unitId),
    );
  }
  doc.updatedAt = new Date().toISOString();
  await putObject(cfg, key, new TextEncoder().encode(JSON.stringify(doc)), {
    contentType: "application/json",
    cacheControl: CACHE_POINTER,
  });
  console.error(`${key}: ${drops.length} history entries dropped`);
}

let done = 0;
for (let i = 0; i < plan.deleteKeys.length; i += 24) {
  await Promise.all(plan.deleteKeys.slice(i, i + 24).map((k) => deleteObject(cfg, k)));
  done += Math.min(24, plan.deleteKeys.length - i);
  if (done % 480 === 0) console.error(`  ${done}/${plan.deleteKeys.length}`);
}
console.error(`deleted ${done}. ${(await listObjectDetails(cfg, "")).length} objects remain.`);
