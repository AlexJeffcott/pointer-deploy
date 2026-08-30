// Records that a contract is going away, §10.
//
//   bun run contract:deprecate --hash 9e79879 --reason "the store is injected now" --instead e0160a6
//   bun run contract:deprecate --hash 9e79879 --reason "..." --instead none
//
// The field goes on the registry record beside the hash. It is not in the hash
// and must not be: a deprecation is decided long after the mint, and folding it
// into the identity would move the hash under every unit that already claimed
// it.
//
// What it does NOT do is un-retain. A retained contract is what a rollback
// promotes against, so a deprecated contract stays promotable and the operator
// gets a warning instead of a refusal. Lifting one is a hand edit to
// registry.json, exactly as retention already is.

import {
  deprecationWarnings,
  emitSurface,
  hashSurface,
  readRegistry,
  verifyRegistry,
  writeRegistry,
  type Deprecation,
} from "./contract.ts";

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
  const i = argv.indexOf(name);
  return i === -1 ? null : (argv[i + 1] ?? null);
};

const hash = flag("--hash");
const reason = flag("--reason");
const instead = flag("--instead");

const usage =
  `  bun run contract:deprecate --hash <hash> --reason "<why>" --instead <hash|none>\n` +
  `\n` +
  `--instead is required. A deprecation with no successor is a legitimate\n` +
  `reading and "none" is how it is said out loud, so that it cannot be the\n` +
  `state a forgotten flag leaves behind.`;

if (!hash || !reason || !instead) {
  console.error(`deprecate a contract, so promote and the matrix say it is going away:\n${usage}`);
  process.exit(1);
}
if (reason.trim() === "") {
  console.error(`a deprecation has to say why. It is printed at every promote that resolves at it.`);
  process.exit(1);
}

const registry = await readRegistry();

// Before the write, for the reason mint verifies before appending: a registry
// already holding an edited contract must not have the edit buried under a
// change made on top of it.
const problems = await verifyRegistry(registry);
if (problems.length) {
  console.error("the contract registry does not verify:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const record = registry.contracts.find((c) => c.hash === hash);
if (!record) {
  console.error(
    `${hash} is not a contract here. The registry holds ` +
      `${registry.contracts.map((c) => c.hash).join(", ")}.`,
  );
  process.exit(1);
}
if (record.deprecated) {
  console.error(
    `${hash} (${record.name}) is already deprecated, as of ` +
      `${record.deprecated.at.slice(0, 10)}: ${record.deprecated.reason}\n` +
      `  Change it by editing ${JSON.stringify("contracts/registry.json")} directly.`,
  );
  process.exit(1);
}

// The rule the whole item turns on. If the surface at HEAD hashes to this
// contract then everything built from now on is built against it, so the
// deprecation would name a move nobody can make - and every promote would carry
// a warning about the only thing an operator is able to do. Mint the
// replacement first: that is what makes HEAD something else.
const headHash = hashSurface(await emitSurface());
if (headHash === hash) {
  console.error(
    `${hash} (${record.name}) is the surface at HEAD, so everything built now is built ` +
      `against it.\n` +
      `  Change the surface and run \`bun run contract:mint --name <name>\` first. ` +
      `Then deprecate this one, pointing at what was minted.`,
  );
  process.exit(1);
}

let target: string | null = null;
if (instead !== "none") {
  const to = registry.contracts.find((c) => c.hash === instead);
  if (!to) {
    console.error(`--instead ${instead} is not a contract here.`);
    process.exit(1);
  }
  if (to.hash === hash) {
    console.error(`--instead names the contract being deprecated.`);
    process.exit(1);
  }
  if (!registry.retained.includes(to.hash)) {
    console.error(
      `--instead ${to.hash} (${to.name}) is not retained, so nothing can be promoted against ` +
        `it. Retain it first, or record --instead none.`,
    );
    process.exit(1);
  }
  if (to.deprecated) {
    console.error(
      `--instead ${to.hash} (${to.name}) is deprecated too. A move that lands on a deprecated ` +
        `contract is not a move.`,
    );
    process.exit(1);
  }
  target = to.hash;
}

const deprecation: Deprecation = {
  reason: reason.trim(),
  // Recorded here rather than typed. A date somebody wrote down is a claim; the
  // rest of this project derives its facts, and so does this one.
  at: new Date().toISOString(),
  instead: target,
};
record.deprecated = deprecation;

// After the field is set, so the count is of the state being written.
const live = registry.retained.filter(
  (h) => !registry.contracts.find((c) => c.hash === h)?.deprecated,
);
await writeRegistry(registry);

console.error(`${hash} (${record.name}) is deprecated as of ${deprecation.at.slice(0, 10)}.`);
console.error(`  ${deprecation.reason}`);
console.error(
  deprecation.instead
    ? `  Move to ${deprecation.instead}.`
    : `  Nothing is named to move to.`,
);
console.error(
  registry.retained.includes(hash)
    ? `  Still retained, so a rollback onto a unit built against it still promotes.`
    : `  It was not retained, so nothing could be promoted against it anyway.`,
);
console.error(`  ${live.length} of ${registry.retained.length} retained contracts are not deprecated.`);

// What an operator will now see, in the words they will see it in. A warning
// nobody has read is a warning nobody can tell is wrong.
console.error(`\nAt a promote that resolves at ${hash}:`);
for (const line of deprecationWarnings(registry, hash, [hash])) console.error(line);

console.log(hash);
