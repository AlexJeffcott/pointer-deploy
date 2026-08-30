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
const head = retained.find((c) => c.hash === headHash);
if (!head) {
  console.error(
    `the surface at HEAD is contract ${headHash}, which is not retained.\n` +
      `  bun run contract:mint --name <name>`,
  );
  process.exit(1);
}

// §10. `contract:deprecate` refuses to deprecate HEAD's contract, and this is
// the same rule applied to the registry however it got that way - a hand edit,
// or a surface change that landed back on a contract deprecated earlier.
// Everything built from now on is built against HEAD, so a deprecation on it
// warns every promote about the only thing an operator can do.
if (head.deprecated) {
  console.error(
    `the surface at HEAD is contract ${headHash} (${head.name}), which is deprecated: ` +
      `${head.deprecated.reason}\n` +
      `  Everything built now is built against it, so the warning names a move nobody can ` +
      `make.\n` +
      `  Mint the replacement, or lift the deprecation in contracts/registry.json.`,
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
