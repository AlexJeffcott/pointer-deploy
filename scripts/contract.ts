// The contract: what the shell provides to a sub-app, and what a sub-app
// provides back.
//
// A contract's identity is the content hash of its type surface, never a
// number. A number is a claim somebody has to remember to raise, and nothing
// stops an edit to a published contract from silently breaking every unit that
// claimed the old one. A hash is derived, so that edit produces a different
// identity instead.
//
// Two halves, and one hash over both:
//
//   shell.d.ts   the surface of src/web/shell/api.ts, reached as "@pointer/shell"
//   subapp.d.ts  the surface of src/web/shell/subapp.ts, reached as "@pointer/subapp"
//
// Preact and the other vendor specifiers are deliberately NOT in it. They
// resolve from node_modules at head, so a matrix cell testing an old app
// against an old contract would compile against head Preact anyway - the
// vendor half would be identity with no verification behind it - and folding
// their versions into the hash would force every app to republish on a patch
// bump. Their versions are recorded per unit and compared at promote instead.

import { mkdir, rm } from "node:fs/promises";
import { join, resolve } from "node:path";

export const CONTRACTS_DIR = "contracts";
export const REGISTRY = join(CONTRACTS_DIR, "registry.json");

/** The units that are published and composed independently. */
export const UNITS = ["shell", "alpha", "bravo", "charlie", "delta"] as const;
export type Unit = (typeof UNITS)[number];
export const APPS = UNITS.filter((u) => u !== "shell") as Exclude<Unit, "shell">[];

/**
 * Bare specifiers the shell owns and every sub-app borrows.
 *
 * "@pointer/shell" is deliberately NOT here any more. A sub-app receives the
 * store as a prop, so its only use for that module at runtime would be to call
 * createStore() and render against a store nobody else can see - silently, and
 * with every count it showed being its own. Leaving the specifier out makes
 * that a build failure rather than a bug nobody can observe. The type is still
 * imported, and a type-only import never reaches the bundle.
 */
export const SHARED = [
  "preact",
  "preact/hooks",
  "preact/jsx-runtime",
  "@preact/signals",
] as const;

/** The two files the contract is emitted from, and the name each is reached by. */
const SURFACE = [
  { file: "shell.d.ts", source: "src/web/shell/api.ts", specifier: "@pointer/shell" },
  { file: "subapp.d.ts", source: "src/web/shell/subapp.ts", specifier: "@pointer/subapp" },
] as const;

export type Surface = { "shell.d.ts": string; "subapp.d.ts": string };

export type ContractRecord = {
  /** Directory name. For people. The hash is the identity. */
  name: string;
  hash: string;
  firstSeenCommit: string;
  firstSeenAt: string;
  /** §10. Recorded after the mint, and never part of the hash. */
  deprecated?: Deprecation;
};

/**
 * A contract that is going away, §10.
 *
 * It is NOT in the hash and must not be. A deprecation is decided after the
 * contract is minted, so folding it into the identity would move the hash under
 * every unit that already claimed it - the one thing a content hash exists to
 * prevent. It sits on the record beside the hash instead, and `verifyRegistry`
 * checks its shape rather than its bytes.
 *
 * Deprecating does not un-retain. A retained contract is what a rollback
 * promotes against, so dropping it from `retained` would break the operation
 * this whole project exists for. "Going away" is a warning, not a refusal.
 */
export type Deprecation = {
  /** Why, in the operator's words. Printed wherever the contract is named. */
  reason: string;
  /** When the decision was recorded. Not when the contract was minted. */
  at: string;
  /**
   * The contract to move to, or null when there is not one yet.
   *
   * Checked here and at every verify: a replacement that is not retained
   * cannot be promoted against, so naming one would send an operator somewhere
   * they cannot go.
   */
  instead: string | null;
};

export type Registry = {
  contracts: ContractRecord[];
  /** Hashes still tested and still promotable. Pruning is never automatic. */
  retained: string[];
};

// -- emitting the surface ---------------------------------------------------

const TSC = ["node_modules/typescript/bin/tsc"];

async function runTsc(configPath: string): Promise<{ ok: boolean; output: string }> {
  const proc = Bun.spawn(["bun", ...TSC, "-p", configPath], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { ok: (await proc.exited) === 0, output: `${out}${err}`.trim() };
}

/**
 * Emits the two declaration files for the surface at HEAD.
 *
 * Comments are stripped so a reformat or a docstring edit does not mint a new
 * contract. The normalisation is weaker than an API report would give; see
 * README. Emit is into a scratch directory that is removed afterwards, so this
 * leaves no build output behind.
 */
export async function emitSurface(): Promise<Surface> {
  const dir = join(".contract-emit");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const config = {
    extends: "../tsconfig.json",
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      removeComments: true,
      outDir: ".",
      rootDir: "../src/web/shell",
      // A .d.ts cannot import a .ts path, so the emitted files must not carry
      // the extension the source uses.
      allowImportingTsExtensions: false,
    },
    include: [],
    files: [...SURFACE.map((s) => `../${s.source}`), "../src/web/globals.d.ts"],
  };
  const configPath = join(dir, "tsconfig.json");
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runTsc(configPath);
  if (!result.ok) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`could not emit the contract surface:\n${result.output}`);
  }

  const surface = {} as Surface;
  for (const s of SURFACE) {
    const emitted = join(dir, s.source.replace("src/web/shell/", "").replace(/\.ts$/, ".d.ts"));
    const text = await Bun.file(emitted).text();
    if (!text.trim()) throw new Error(`${s.file} came out empty`);
    surface[s.file] = normalise(text);
  }

  await rm(dir, { recursive: true, force: true });
  return surface;
}

/**
 * The server-to-shell block surface, §11, emitted the same way.
 *
 * One file and no specifier of its own to resolve, so it needs none of the
 * two-halves machinery above. It is emitted rather than read as source for the
 * same reason: tsc's output is canonical, so a reformat or a docstring is not
 * a change to the surface.
 */
export async function emitBlocks(): Promise<string> {
  const dir = join(".contract-emit-blocks");
  await rm(dir, { recursive: true, force: true });
  await mkdir(dir, { recursive: true });

  const config = {
    extends: "../tsconfig.json",
    compilerOptions: {
      noEmit: false,
      declaration: true,
      emitDeclarationOnly: true,
      removeComments: true,
      outDir: ".",
      rootDir: "../src/server",
      allowImportingTsExtensions: false,
    },
    include: [],
    files: ["../src/server/blocks.ts"],
  };
  const configPath = join(dir, "tsconfig.json");
  await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);

  const result = await runTsc(configPath);
  if (!result.ok) {
    await rm(dir, { recursive: true, force: true });
    throw new Error(`could not emit the block surface:\n${result.output}`);
  }
  const text = normalise(await Bun.file(join(dir, "blocks.d.ts")).text());
  await rm(dir, { recursive: true, force: true });
  if (!text.trim()) throw new Error("blocks.d.ts came out empty");
  return text;
}

/** Trailing whitespace and line endings are not part of a type surface. */
function normalise(text: string): string {
  return `${text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim()}\n`;
}

/**
 * One half's identity, on its own.
 *
 * The full hash cannot say WHICH half moved, and the two halves are gated
 * differently: `shell.d.ts` is gated member by member, on what a sub-app
 * actually uses, and `subapp.d.ts` is all-or-nothing because the shell requires
 * the whole of it. So the sub-app half needs an identity the shell half's churn
 * does not disturb - three contracts that changed only `api.ts` share one of
 * these, and a unit built against any of them is interchangeable on this half.
 */
export function hashHalf(surface: Surface, file: keyof Surface): string {
  const hasher = new Bun.CryptoHasher("sha256");
  hasher.update(file);
  hasher.update("\0");
  hasher.update(surface[file]);
  return hasher.digest("hex").slice(0, 7);
}

/**
 * The identity. Over both files and their names, so moving a declaration from
 * one half to the other is a different contract.
 */
export function hashSurface(surface: Surface): string {
  const hasher = new Bun.CryptoHasher("sha256");
  for (const s of SURFACE) {
    hasher.update(s.file);
    hasher.update("\0");
    hasher.update(surface[s.file]);
    hasher.update("\0");
  }
  return hasher.digest("hex").slice(0, 7);
}

// -- the registry -----------------------------------------------------------

export async function readRegistry(): Promise<Registry> {
  const doc = (await Bun.file(REGISTRY)
    .json()
    .catch(() => null)) as Registry | null;
  return doc ?? { contracts: [], retained: [] };
}

export async function writeRegistry(registry: Registry): Promise<void> {
  await Bun.write(REGISTRY, `${JSON.stringify(registry, null, 2)}\n`);
}

export function contractDir(record: ContractRecord): string {
  return join(CONTRACTS_DIR, record.name);
}

/** Reads a contract's two files back off disk. */
export async function readSurface(record: ContractRecord): Promise<Surface> {
  const dir = contractDir(record);
  const surface = {} as Surface;
  for (const s of SURFACE) {
    surface[s.file] = await Bun.file(join(dir, s.file)).text();
  }
  return surface;
}

/**
 * Re-derives every stored contract's hash from its own files.
 *
 * This is what an in-place edit to a published contract cannot hide. Without
 * it the hash in contract.json is just another number somebody wrote down.
 */
export async function verifyRegistry(registry: Registry): Promise<string[]> {
  const problems: string[] = [];
  for (const record of registry.contracts) {
    const surface = await readSurface(record).catch(() => null);
    if (!surface) {
      problems.push(`${record.name}: its files are missing`);
      continue;
    }
    const derived = hashSurface(surface);
    if (derived !== record.hash) {
      problems.push(
        `${record.name}: contract.json claims ${record.hash}, its files hash to ${derived}. ` +
          `A published contract was edited in place.`,
      );
    }
  }
  for (const hash of registry.retained) {
    if (!registry.contracts.some((c) => c.hash === hash)) {
      problems.push(`retained hash ${hash} names no contract`);
    }
  }
  problems.push(...deprecationProblems(registry));
  return problems;
}

// -- deprecation, §10 -------------------------------------------------------

/** The deprecation on a hash, or null. */
export function deprecationOf(registry: Registry, hash: string): Deprecation | null {
  return registry.contracts.find((c) => c.hash === hash)?.deprecated ?? null;
}

/**
 * What is wrong with the deprecations in a registry.
 *
 * Read by `verifyRegistry`, so every command that touches the registry applies
 * it. The field is written by `contract:deprecate` and lifted by hand - the
 * retained list is maintained the same way - so a hand edit has to be caught
 * where every other registry fault is, rather than surfacing as a warning that
 * names a contract nobody can move to.
 */
export function deprecationProblems(registry: Registry): string[] {
  const problems: string[] = [];
  for (const record of registry.contracts) {
    const d = record.deprecated;
    if (d === undefined) continue;
    if (d === null || typeof d !== "object") {
      problems.push(`${record.name}: deprecated is not a record`);
      continue;
    }
    if (typeof d.reason !== "string" || d.reason.trim() === "") {
      problems.push(`${record.name}: a deprecation has to say why`);
    }
    if (typeof d.at !== "string" || Number.isNaN(Date.parse(d.at))) {
      problems.push(`${record.name}: deprecated.at is not a date`);
    }
    if (d.instead === null) continue;
    if (typeof d.instead !== "string") {
      problems.push(`${record.name}: deprecated.instead has to be a hash or null`);
      continue;
    }
    const target = registry.contracts.find((c) => c.hash === d.instead);
    if (!target) {
      problems.push(`${record.name}: it says to move to ${d.instead}, which is not a contract here`);
    } else if (!registry.retained.includes(target.hash)) {
      problems.push(
        `${record.name}: it says to move to ${target.hash}, which is not retained. ` +
          `Nothing can be promoted against it.`,
      );
    } else if (target.deprecated) {
      problems.push(
        `${record.name}: it says to move to ${target.hash}, which is deprecated too.`,
      );
    }
  }
  return problems;
}

/**
 * What an operator is told when the contract a promote resolved at is going
 * away, §10.
 *
 * `chosen` is what the composition resolved at and `shared` is every contract
 * it could have resolved at. Both are needed: the second says whether this
 * promote has any option that is not deprecated, and a promote whose only
 * option is deprecated is the state the whole warning exists to prevent.
 *
 * A warning and never a refusal, for the reason the vendor-version mismatch is
 * one: a deprecated contract is still the contract a published unit was built
 * against, and refusing it would make a rollback onto that unit impossible.
 */
export function deprecationWarnings(
  registry: Registry,
  chosen: string,
  shared: string[],
): string[] {
  const deprecation = deprecationOf(registry, chosen);
  if (!deprecation) return [];

  const nameOf = (hash: string) => {
    const record = registry.contracts.find((c) => c.hash === hash);
    return record ? `${hash} (${record.name})` : hash;
  };

  const lines = [
    `  WARNING contract ${nameOf(chosen)} was deprecated on ${deprecation.at.slice(0, 10)}: ` +
      `${deprecation.reason}`,
  ];
  lines.push(
    deprecation.instead
      ? `  Move to ${nameOf(deprecation.instead)}: rebuild and republish every unit in this composition.`
      : `  Nothing is named to move to, so this contract is going away with no successor recorded.`,
  );

  const live = shared.filter((hash) => hash !== chosen && !deprecationOf(registry, hash));
  lines.push(
    live.length
      ? `  This composition also shares ${live.join(", ")}, which ${live.length === 1 ? "is" : "are"} not deprecated.`
      : `  Every contract this composition shares is deprecated, so a promote has no other option.`,
  );
  return lines;
}

export function retainedContracts(registry: Registry): ContractRecord[] {
  return registry.contracts.filter((c) => registry.retained.includes(c.hash));
}

/** The versions of the shared packages this build resolved. */
export async function sharedVersions(): Promise<Record<string, string>> {
  const pkg = (await Bun.file("package.json").json()) as {
    dependencies?: Record<string, string>;
  };
  const out: Record<string, string> = {};
  for (const name of ["preact", "@preact/signals"]) {
    const installed = (await Bun.file(`node_modules/${name}/package.json`)
      .json()
      .catch(() => null)) as { version?: string } | null;
    const version = installed?.version ?? pkg.dependencies?.[name];
    if (version) out[name] = version;
  }
  return out;
}

export function majorOf(version: string): string {
  return version.replace(/^[^\d]*/, "").split(".")[0] ?? version;
}

// -- the matrix -------------------------------------------------------------

const MATRIX_WORK = ".contract-matrix";

/** What each unit compiles: its own sources plus its conformance adapter. */
export function filesFor(unit: Unit): string[] {
  const shared = ["src/web/globals.d.ts", "src/web/css-modules.d.ts"];
  if (unit === "shell") {
    return [...shared, "src/web/shell/contract.ts", "src/web/shell/index.tsx"];
  }
  return [...shared, `src/web/apps/${unit}/contract.ts`];
}

/**
 * Compiles one unit with the contract specifiers re-pointed at a directory
 * holding a `shell.d.ts` and a `subapp.d.ts`.
 *
 * The matrix points this at a retained contract. The member reading in
 * members.ts points it at the same surface with one declaration cut out, which
 * is the same question asked of one member instead of the whole surface.
 */
export async function compileAgainst(
  unit: Unit,
  surfaceDir: string,
  workDir: string,
): Promise<{ ok: boolean; output: string }> {
  await mkdir(workDir, { recursive: true });

  const sdir = resolve(surfaceDir);
  const config = {
    extends: resolve("tsconfig.json"),
    compilerOptions: {
      noEmit: true,
      // The point of the whole exercise: the unit is compiled against the
      // contract's declarations rather than against the sources at HEAD.
      baseUrl: resolve("."),
      paths: {
        "@pointer/shell": [join(sdir, "shell.d.ts")],
        "@pointer/subapp": [join(sdir, "subapp.d.ts")],
        // NOT part of the contract, and resolved at HEAD like the vendor types
        // are. It is the surface between the server and the shell, and §11's
        // own member reading is what covers it - see src/server/blocks.ts.
        "@pointer/blocks": [resolve("src/server/blocks.ts")],
      },
    },
    include: [],
    files: filesFor(unit).map((f) => resolve(f)),
  };
  await Bun.write(join(workDir, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);
  return runTsc(join(workDir, "tsconfig.json"));
}

async function cell(unit: Unit, contract: ContractRecord, verbose: boolean): Promise<boolean> {
  const result = await compileAgainst(
    unit,
    contractDir(contract),
    join(MATRIX_WORK, `${unit}-${contract.hash}`),
  );
  if (!result.ok && verbose) {
    console.error(`\n--- ${unit} x ${contract.hash} ---\n${result.output}\n`);
  }
  return result.ok;
}

export type MatrixResult = {
  /** Unit name to the sorted set of contract hashes it compiles against. */
  sets: Record<Unit, string[]>;
  contracts: ContractRecord[];
  ms: number;
};

/**
 * One tsc run per unit per retained contract. The compiler is the oracle.
 *
 * Cells are independent, so they all run at once. Twenty of them against a
 * project whose full `tsc --noEmit` is 0.69 s.
 */
export async function runMatrix(
  contracts: ContractRecord[],
  options: { verbose?: boolean } = {},
): Promise<MatrixResult> {
  await rm(MATRIX_WORK, { recursive: true, force: true });
  const started = Bun.nanoseconds();

  const cells = await Promise.all(
    UNITS.flatMap((unit) =>
      contracts.map(async (contract) => ({
        unit,
        hash: contract.hash,
        pass: await cell(unit, contract, options.verbose ?? false),
      })),
    ),
  );

  await rm(MATRIX_WORK, { recursive: true, force: true });

  const sets = Object.fromEntries(UNITS.map((u) => [u, [] as string[]])) as Record<Unit, string[]>;
  for (const c of cells) if (c.pass) sets[c.unit].push(c.hash);
  for (const u of UNITS) sets[u].sort();

  return { sets, contracts, ms: Math.round((Bun.nanoseconds() - started) / 1e6) };
}

/** The table, for a person. */
export function renderMatrix(result: MatrixResult): string {
  const width = Math.max(...UNITS.map((u) => u.length));
  const cellText = (hash: string, pass: boolean) =>
    (pass ? "pass" : "fail").padStart(hash.length);
  const lines = [`${" ".repeat(width)}  ${result.contracts.map((c) => c.hash).join("  ")}`];
  for (const unit of UNITS) {
    const row = result.contracts.map((c) => cellText(c.hash, result.sets[unit].includes(c.hash)));
    lines.push(`${unit.padEnd(width)}  ${row.join("  ")}`);
  }
  // §10. Below the table rather than in the header: a cell is padded to the
  // width of its hash, so a marked column would move every row under it. A
  // contract that is going away still passes or fails exactly as it did.
  for (const contract of result.contracts) {
    const d = contract.deprecated;
    if (!d) continue;
    const instead = d.instead
      ? `Move to ${d.instead}.`
      : `Nothing is named to move to.`;
    lines.push(
      `\n${contract.hash} (${contract.name}) is deprecated as of ${d.at.slice(0, 10)}: ` +
        `${d.reason}\n  ${instead} It is still retained, so a rollback onto a unit built ` +
        `against it still promotes.`,
    );
  }
  return lines.join("\n");
}

// -- the direction of a change ----------------------------------------------

const DIRECTION_WORK = ".contract-direction";

export type Half = "shell" | "subapp";

export type HalfResult = { half: Half; ok: boolean; output: string };

export type Direction = {
  /** Both halves compile. Nothing published against the older surface breaks. */
  additive: boolean;
  halves: HalfResult[];
  ms: number;
};

/** What each half breaking means, and for whom. */
const WHO: Record<Half, string> = {
  shell:
    "the shell half. The new surface no longer provides what this contract " +
    "declared, so every sub-app published against it consumes something that is gone",
  subapp:
    "the sub-app half. A sub-app published against this contract no longer " +
    "satisfies SubApp, so the shell cannot render one",
};

/**
 * Whether a newer surface is additive over an older one.
 *
 * The hash says a surface changed and says nothing about the direction. tsc
 * answers it: two generated probes, compiled the way cell() compiles a matrix
 * cell, with the contract specifiers re-pointed at the NEWER surface.
 *
 * The direction REVERSES between the halves, because a sub-app consumes the
 * shell API and produces a SubApp:
 *
 *   shell    the newer module must still be assignable to the older module
 *   subapp   an older SubApp must still be assignable to the newer type
 *
 * Trap, and it reproduced: subapp.d.ts exports a type and no value, so
 * `typeof import(...)` gives an EMPTY module shape and a module-level probe
 * passes on a SubApp that gained a required member. The sub-app half names the
 * type, never the module.
 *
 * "@pointer/shell" resolves to the newer shell.d.ts in both probes, so the
 * older subapp.d.ts - which imports ShellStore by specifier, as HEAD does -
 * sees the store the shell would really hand it.
 *
 * skipLibCheck is turned OFF here, and the project has it on. A module shape
 * carries VALUES only, so with it on a removed or renamed TYPE export read as
 * additive: the resulting "no exported member" error sits inside a .d.ts and
 * was skipped, and both SubApps degraded to something permissive. Measured on
 * 2026-08-28: turning it off catches that case (TS2305, naming the type), adds
 * no error from node_modules on this project's own contracts, and costs about
 * 0.3 s to about 1.2 s per comparison.
 *
 * One consequence of both choices: a type the newer surface no longer names is
 * reported by the SUB-APP half, because that is the file that imports it.
 * tsc's output names the type.
 */
export async function directionFrom(older: Surface, newer: Surface): Promise<Direction> {
  const dir = join(DIRECTION_WORK, `${hashSurface(older)}-${hashSurface(newer)}`);
  await rm(dir, { recursive: true, force: true });
  const started = Bun.nanoseconds();

  for (const [side, surface] of [
    ["old", older],
    ["new", newer],
  ] as const) {
    for (const s of SURFACE) await Bun.write(join(dir, side, s.file), surface[s.file]);
  }

  const probes: Record<Half, string> = {
    shell:
      "// Sub-apps CONSUME this API, so the newer surface must provide at least\n" +
      "// what the older one declared.\n" +
      'import * as newer from "@pointer/shell";\n' +
      'export const provides: typeof import("../old/shell") = newer;\n',
    subapp:
      "// A sub-app PRODUCES this, so one built against the older surface must\n" +
      "// still satisfy the newer type. The TYPE is named: the module shape of\n" +
      "// subapp.d.ts is empty, and every SubApp passes against an empty shape.\n" +
      'import type { SubApp as Newer } from "@pointer/subapp";\n' +
      'import type { SubApp as Older } from "../old/subapp";\n' +
      "declare const built: Older;\n" +
      "export const accepted: Newer = built;\n",
  };

  const halves = await Promise.all(
    (Object.keys(probes) as Half[]).map(async (half) => {
      await Bun.write(join(dir, "probe", `${half}.ts`), probes[half]);
      const config = {
        extends: resolve("tsconfig.json"),
        compilerOptions: {
          noEmit: true,
          // See above. The type-only half of the surface is invisible without
          // this, and nothing in node_modules objects to being checked.
          skipLibCheck: false,
          // A probe needs the lib types and whatever the two surfaces import.
          // It needs no ambient package, and with skipLibCheck off, loading
          // one means checking it.
          types: [],
          baseUrl: resolve("."),
          paths: {
            "@pointer/shell": [resolve(dir, "new", "shell.d.ts")],
            "@pointer/subapp": [resolve(dir, "new", "subapp.d.ts")],
          },
        },
        include: [],
        files: [resolve(dir, "probe", `${half}.ts`)],
      };
      const configPath = join(dir, `tsconfig-${half}.json`);
      await Bun.write(configPath, `${JSON.stringify(config, null, 2)}\n`);
      const result = await runTsc(configPath);
      // The scratch path is noise in a reading a person has to act on, and it
      // is a directory that no longer exists by the time they read it. What
      // matters is which side each type came from, so leave "old/shell" and
      // "new/subapp" and take the rest away.
      const output = result.output.split(`${resolve(dir)}/`).join("").split(`${dir}/`).join("");
      return { half, ok: result.ok, output };
    }),
  );

  await rm(dir, { recursive: true, force: true });

  return {
    additive: halves.every((h) => h.ok),
    halves,
    ms: Math.round((Bun.nanoseconds() - started) / 1e6),
  };
}

/**
 * The reading, for a person.
 *
 * A warning and never a refusal. A breaking change is a legitimate thing to
 * mint; the promote's intersection rule is what stops it reaching a channel.
 */
export function renderDirection(record: ContractRecord, direction: Direction): string {
  const head = `${record.hash} ${record.name}`;
  if (direction.additive) return `${head}: additive. Nothing published against it breaks.`;
  const lines = [`${head}: NOT additive.`];
  for (const half of direction.halves) {
    if (half.ok) continue;
    lines.push(`  ${WHO[half.half]}:`);
    for (const l of half.output.split("\n")) lines.push(`    ${l}`);
  }
  return lines.join("\n");
}

export { runTsc };
