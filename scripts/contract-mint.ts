// Records the type surface at HEAD as a contract, when it is not one already.
//
//   bun run contract:mint --name counters-2026-08
//
// The name is for people reading a directory listing. The identity is the
// hash, and nobody types that in.
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
  emitSurface,
  hashSurface,
  readRegistry,
  verifyRegistry,
  writeRegistry,
  type ContractRecord,
} from "./contract.ts";

const args = process.argv.slice(2);
const nameFlag = args.indexOf("--name");
const name = nameFlag === -1 ? null : args[nameFlag + 1];

const git = (a: string[]): string | null => {
  const r = Bun.spawnSync(["git", ...a], { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? new TextDecoder().decode(r.stdout).trim() : null;
};

const registry = await readRegistry();

// A mint that appended to a registry already holding an edited contract would
// bury the edit under a new entry.
const problems = await verifyRegistry(registry);
if (problems.length) {
  console.error("the contract registry does not verify:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

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

const record: ContractRecord = {
  name,
  hash,
  firstSeenCommit: git(["rev-parse", "HEAD"]) ?? "0".repeat(40),
  firstSeenAt: new Date().toISOString(),
};

const dir = contractDir(record);
await mkdir(dir, { recursive: true });
await Bun.write(join(dir, "shell.d.ts"), surface["shell.d.ts"]);
await Bun.write(join(dir, "subapp.d.ts"), surface["subapp.d.ts"]);
await Bun.write(join(dir, "contract.json"), `${JSON.stringify(record, null, 2)}\n`);

registry.contracts.push(record);
registry.retained.push(hash);
await writeRegistry(registry);

console.error(`minted ${hash} as ${join(CONTRACTS_DIR, name)}/`);
console.error(`  run \`bun run contract:matrix\` to see which units compile against it`);
console.log(hash);
