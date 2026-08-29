// Records what the server PROVIDES in its three JSON blocks, §11.
//
//   bun run blocks:record
//
// The reading is derived from `src/server/blocks.ts` by tsc, and it has to
// travel INSIDE the image: the runtime stage copies `src/server` and runs it,
// with no tsc and no tsconfig, so a server cannot work this out about itself at
// startup. So it is generated here and committed, and `build.ts` refuses a
// build whose committed copy does not match the surface at HEAD - the same
// shape as the contract registry's refusal, and for the same reason.

import { PROVIDES_FILE, blocksProvided, writeProvided } from "./blocks.ts";
import { readBlockMembers } from "./members.ts";

const reading = await readBlockMembers();
const before = await blocksProvided();
await writeProvided(reading.provides);

const added = Object.keys(reading.provides).filter((p) => !(p in before));
const gone = Object.keys(before).filter((p) => !(p in reading.provides));
const moved = Object.keys(reading.provides).filter((p) => before[p] && before[p] !== reading.provides[p]);

console.error(`${PROVIDES_FILE}: ${Object.keys(reading.provides).length} members in ${reading.ms} ms`);
if (added.length) console.error(`  added   ${added.join(", ")}`);
if (gone.length) console.error(`  REMOVED ${gone.join(", ")}`);
if (moved.length) console.error(`  changed ${moved.join(", ")}`);
if (!added.length && !gone.length && !moved.length) console.error("  unchanged");
if (gone.length || moved.length) {
  console.error(
    `\nThese blocks are APPEND-ONLY while a shell that reads the field is still in\n` +
      `a channel's history. Removing or renaming one is what §11 demonstrated.`,
  );
}
