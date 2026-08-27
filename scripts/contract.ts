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

/** Bare specifiers the shell owns and every sub-app borrows. */
export const SHARED = [
  "preact",
  "preact/hooks",
  "preact/jsx-runtime",
  "@preact/signals",
  "@pointer/shell",
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

/** Trailing whitespace and line endings are not part of a type surface. */
function normalise(text: string): string {
  return `${text
    .split("\n")
    .map((l) => l.trimEnd())
    .join("\n")
    .trim()}\n`;
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
  return problems;
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
function filesFor(unit: Unit): string[] {
  const shared = ["src/web/globals.d.ts", "src/web/css-modules.d.ts"];
  if (unit === "shell") {
    return [...shared, "src/web/shell/contract.ts", "src/web/shell/index.tsx"];
  }
  return [...shared, `src/web/apps/${unit}/contract.ts`];
}

async function cell(unit: Unit, contract: ContractRecord, verbose: boolean): Promise<boolean> {
  const dir = join(MATRIX_WORK, `${unit}-${contract.hash}`);
  await mkdir(dir, { recursive: true });

  const cdir = resolve(contractDir(contract));
  const config = {
    extends: resolve("tsconfig.json"),
    compilerOptions: {
      noEmit: true,
      // The point of the whole exercise: the unit is compiled against the
      // contract's declarations rather than against the sources at HEAD.
      baseUrl: resolve("."),
      paths: {
        "@pointer/shell": [join(cdir, "shell.d.ts")],
        "@pointer/subapp": [join(cdir, "subapp.d.ts")],
      },
    },
    include: [],
    files: filesFor(unit).map((f) => resolve(f)),
  };
  await Bun.write(join(dir, "tsconfig.json"), `${JSON.stringify(config, null, 2)}\n`);

  const result = await runTsc(join(dir, "tsconfig.json"));
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
  return lines.join("\n");
}

export { runTsc };
