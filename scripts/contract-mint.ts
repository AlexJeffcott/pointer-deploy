// Records the type surface at HEAD as a contract, when it is not one already.
//
//   bun run contract:mint --name counters-2026-08
//   bun run contract:mint --name counters-2026-08 --at <commit>
//
// The name is for people reading a directory listing. The identity is the
// hash, and nobody types that in.
//
// `--at` is for the commit the surface first appears in, and it exists because
// the obvious reading is wrong. A mint runs with the new surface in the working
// tree and HEAD still at the commit BEFORE it, so `git rev-parse HEAD` names the
// last commit that did not have this surface. Both records this repository holds
// were written that way and both were off by one. With no `--at`, a dirty tree
// records `mintedDirty: true` beside the commit rather than claiming it.
//
// build.ts refuses to run when the surface at HEAD hashes to something the
// registry does not hold. That refusal is the only reason this command is ever
// needed, and it is what stops a surface change from reaching the store
// without a contract to name it.

import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import {
  CONTRACTS_DIR,
  contractDir,
  directionFrom,
  emitSurface,
  hashSurface,
  readRegistry,
  readSurface,
  renderDirection,
  retainedContracts,
  verifyRegistry,
  writeRegistry,
  type ContractRecord,
} from "./contract.ts";
import { currentSource } from "./source.ts";

const args = process.argv.slice(2);
const nameFlag = args.indexOf("--name");
const name = nameFlag === -1 ? null : args[nameFlag + 1];
const atFlag = args.indexOf("--at");
const at: string | null = atFlag === -1 ? null : (args[atFlag + 1] ?? "");

const registry = await readRegistry();

// A mint that appended to a registry already holding an edited contract would
// bury the edit under a new entry.
const problems = await verifyRegistry(registry);
if (problems.length) {
  console.error("the contract registry does not verify:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

// Read before the mint appends to it: the reading below is against what was
// retained when the change was made.
const previous = retainedContracts(registry);

const surface = await emitSurface();
const hash = hashSurface(surface);

const existing = registry.contracts.find((c) => c.hash === hash);
if (existing) {
  const retained = registry.retained.includes(hash);
  console.error(
    `the surface at HEAD is contract ${hash}, already recorded as ` +
      `${existing.name}${retained ? "" : " (not retained)"}. Nothing to mint.`,
  );
  if (!retained) {
    registry.retained.push(hash);
    await writeRegistry(registry);
    console.error(`  retained ${hash} again`);
  }
  console.log(hash);
  process.exit(0);
}

if (!name) {
  console.error(
    `the surface at HEAD is contract ${hash}, which the registry does not hold.\n` +
      `Give it a name a person can read:\n` +
      `  bun run contract:mint --name <name>`,
  );
  process.exit(1);
}
if (!/^[a-z0-9][a-z0-9-]*$/.test(name)) {
  console.error(`name ${JSON.stringify(name)} must be lowercase letters, digits and hyphens.`);
  process.exit(1);
}
if (registry.contracts.some((c) => c.name === name)) {
  console.error(`a contract named ${JSON.stringify(name)} already exists.`);
  process.exit(1);
}

// What the tree can honestly say about where this surface came from. `--at`
// names the commit that holds it, for a mint made after the fact; otherwise the
// reading is HEAD plus whether the tree was dirty, and a dirty tree means the
// commit named is where the work started and not what it contains.
const source = currentSource();
if (at !== null && !/^[0-9a-f]{7,40}$/.test(at)) {
  console.error(`--at ${JSON.stringify(at)} is not a commit.`);
  process.exit(1);
}
const record: ContractRecord = {
  name,
  hash,
  firstSeenCommit: at ?? source?.commit ?? "0".repeat(40),
  ...(at === null && source?.dirty ? { mintedDirty: true } : {}),
  firstSeenAt: new Date().toISOString(),
};
if (record.mintedDirty) {
  console.error(
    `NOTE ${record.firstSeenCommit.slice(0, 8)} is where this work started, not where this\n` +
      `     surface is: the tree is dirty, so no commit holds it yet. Recorded as\n` +
      `     mintedDirty. Once it is committed, correct it with --at <commit>.`,
  );
}

const dir = contractDir(record);
await mkdir(dir, { recursive: true });
await Bun.write(join(dir, "shell.d.ts"), surface["shell.d.ts"]);
await Bun.write(join(dir, "subapp.d.ts"), surface["subapp.d.ts"]);
await Bun.write(join(dir, "contract.json"), `${JSON.stringify(record, null, 2)}\n`);

registry.contracts.push(record);
registry.retained.push(hash);
await writeRegistry(registry);

console.error(`minted ${hash} as ${join(CONTRACTS_DIR, name)}/`);

// The direction, §8. The hash says the surface changed and says nothing about
// which way, so tsc is asked: is anything published against a retained
// contract still typed correctly against this one?
//
// A WARNING and never a refusal. A breaking change is a legitimate thing to
// mint - the shell split was one - and `promote` refusing a composition with
// an empty intersection is what stops it reaching a channel.
if (previous.length) {
  const readings = await Promise.all(
    previous.map(async (earlier) =>
      renderDirection(earlier, await directionFrom(await readSurface(earlier), surface)),
    ),
  );
  console.error("");
  for (const reading of readings) console.error(reading);
}

console.error(`\n  run \`bun run contract:matrix\` to see which units compile against it`);
console.log(hash);
