// Which units compile against which contracts.
//
//   bun run contract:matrix
//   MATRIX_VERBOSE=1 bun run contract:matrix    # and why each fail failed
//
// The matrix itself is in contract.ts, because build.ts runs it too: a unit's
// contract set is part of what gets published, not a report generated beside
// it. This is the command that shows it to a person.

import {
  UNITS,
  emitSurface,
  hashSurface,
  readRegistry,
  renderMatrix,
  retainedContracts,
  runMatrix,
  verifyRegistry,
} from "./contract.ts";

const registry = await readRegistry();
const problems = await verifyRegistry(registry);
if (problems.length) {
  console.error("the contract registry does not verify:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const retained = retainedContracts(registry);
if (retained.length === 0) {
  console.error("no contracts are retained. Run `bun run contract:mint --name <name>` first.");
  process.exit(1);
}

// The surface at HEAD must be one of them, or the sets this produces describe
// a shell nobody can publish.
const headHash = hashSurface(await emitSurface());
if (!retained.some((c) => c.hash === headHash)) {
  console.error(
    `the surface at HEAD is contract ${headHash}, which is not retained.\n` +
      `  bun run contract:mint --name <name>`,
  );
  process.exit(1);
}

const result = await runMatrix(retained, { verbose: Boolean(process.env.MATRIX_VERBOSE) });
console.error(renderMatrix(result));
console.error(`\n${UNITS.length * retained.length} cells in ${result.ms} ms`);

const empty = UNITS.filter((u) => result.sets[u].length === 0);
if (empty.length) {
  console.error(
    `\n${empty.join(", ")} compile against no retained contract. ` +
      `Nothing built now could be promoted. Run with MATRIX_VERBOSE=1 to see why.`,
  );
  process.exit(1);
}

// stdout carries the machine-readable result and nothing else.
console.log(JSON.stringify(result.sets, null, 2));
