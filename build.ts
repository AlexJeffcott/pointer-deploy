// Builds five units and records what each emitted in dist/build.json, so
// publish.ts does not re-derive the names.
//
// A unit is the thing that gets published and rolled back on its own: the
// shell, and one per sub-app. Two kinds of build, and the difference is the
// whole architecture:
//
//   1. The shell, the store and the import-map entries, in ONE Bun.build with
//      splitting. Preact's code lands in a shared chunk that every entry
//      references, so there is exactly one instance of it in the page.
//   2. One build per sub-app, with those same specifiers marked external. Each
//      app is its own bundle with its own stylesheet and shares nothing with
//      the others - but resolves "preact" and "@pointer/shell" through the
//      import map to the files built in step 1.
//
// Bundling Preact into each app instead would give each one its own signals
// runtime, and a counter the shell owns would stop re-rendering them.
//
// Because units are composed rather than deployed together, a build also has
// to say WHICH shells each unit can be composed with. That is the contract
// matrix, and it runs here rather than beside the build: the set is part of
// what gets published, not a report.

import { rm, mkdir } from "node:fs/promises";
import { basename } from "node:path";
import {
  APPS,
  SHARED,
  UNITS,
  emitSurface,
  hashSurface,
  readRegistry,
  renderMatrix,
  retainedContracts,
  runMatrix,
  sharedVersions,
  verifyRegistry,
  type Unit,
} from "./scripts/contract.ts";
import { currentSource, type Source } from "./scripts/source.ts";

const OUTDIR = "dist";
const unitDir = (unit: Unit) => `${OUTDIR}/units/${unit}`;

// Bun decides which JSX runtime to emit when the process starts, so this cannot
// be set from here. Without it every sub-app imports preact/jsx-dev-runtime,
// which the import map does not name, and fails to resolve in the browser.
if (Bun.env.NODE_ENV !== "production") {
  throw new Error(
    "NODE_ENV must be production before the process starts, or Bun emits the " +
      "development JSX runtime. Run `bun run build`, not `bun build.ts`.",
  );
}

// --- 0. the contract -------------------------------------------------------

const registry = await readRegistry();
const problems = await verifyRegistry(registry);
if (problems.length) {
  console.error("the contract registry does not verify:");
  for (const p of problems) console.error(`  ${p}`);
  process.exit(1);
}

const retained = retainedContracts(registry);
const headHash = hashSurface(await emitSurface());

// The forcing function. A surface change that reached the store with no
// contract naming it would leave every unit claiming a hash nobody can check.
if (!retained.some((c) => c.hash === headHash)) {
  console.error(
    `the type surface at HEAD is contract ${headHash}, which the registry does not hold.\n` +
      `Record it before building:\n` +
      `  bun run contract:mint --name <a-name-a-person-can-read>`,
  );
  process.exit(1);
}

const matrix = await runMatrix(retained);
console.error(renderMatrix(matrix));
console.error(`  ${UNITS.length * retained.length} cells in ${matrix.ms} ms\n`);

const unsupported = UNITS.filter((u) => matrix.sets[u].length === 0);
if (unsupported.length) {
  console.error(
    `${unsupported.join(", ")} compile against no retained contract, so nothing built ` +
      `here could be promoted. MATRIX_VERBOSE=1 bun run contract:matrix shows why.`,
  );
  process.exit(1);
}

const versions = await sharedVersions();

// --- markers ---------------------------------------------------------------

// BUILD_MARKER applies to every unit; BUILD_MARKER_<UNIT> overrides one. The
// live suite needs to publish a new alpha without touching the other four, and
// editing the source for that would make the suite depend on its own edits.
const markerFor = (unit: Unit): string =>
  Bun.env[`BUILD_MARKER_${unit.toUpperCase()}`] ?? Bun.env.BUILD_MARKER ?? "";

const common = {
  target: "browser",
  minify: true,
  sourcemap: "linked",
} as const;

const defines = (unit: Unit) => ({
  __BUILD_MARKER__: JSON.stringify(Bun.env.BUILD_MARKER ?? ""),
  __UNIT_MARKER__: JSON.stringify(markerFor(unit)),
});

await rm(OUTDIR, { recursive: true, force: true });
await mkdir(`${OUTDIR}/units`, { recursive: true });

const fail = (label: string, logs: unknown[]): never => {
  for (const log of logs) console.error(log);
  throw new Error(`${label} failed to build`);
};

// --- 1. shell, store and the shared runtime -------------------------------

const shell = await Bun.build({
  ...common,
  define: defines("shell"),
  entrypoints: [
    "src/web/shell/index.tsx",
    "src/web/shell/api.ts",
    "src/web/vendor/preact.ts",
    "src/web/vendor/preact-hooks.ts",
    "src/web/vendor/preact-jsx-runtime.ts",
    "src/web/vendor/preact-signals.ts",
  ],
  outdir: unitDir("shell"),
  splitting: true,
  naming: {
    entry: "[name]-[hash].[ext]",
    chunk: "shared-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});
if (!shell.success) fail("the shell", shell.logs);

/**
 * The SRI digest of one emitted file.
 *
 * sha384 because that is what Subresource Integrity takes, base64 because that
 * is the encoding the attribute is defined in. `BuildArtifact.hash` is NOT this:
 * it is an 8-character content hash Bun uses for `[hash]` in a file name, and a
 * browser will not check it.
 */
const digestOf = async (artifact: Bun.BuildArtifact): Promise<string> =>
  `sha384-${new Bun.CryptoHasher("sha384")
    .update(new Uint8Array(await artifact.arrayBuffer()))
    .digest("base64")}`;

/**
 * A digest for every file the browser fetches with a digest to check.
 *
 * Source maps are left out: only DevTools asks for one, and never with an
 * integrity check. Recording a digest nothing verifies would read as coverage.
 */
const integrityOf = async (outputs: Bun.BuildArtifact[]): Promise<Record<string, string>> => {
  const digests: Record<string, string> = {};
  for (const o of outputs) {
    if (o.kind === "sourcemap") continue;
    digests[basename(o.path)] = await digestOf(o);
  }
  return digests;
};

const named = (build: Bun.BuildOutput, stem: string, ext: string) => {
  const hit = build.outputs.find(
    (o) => o.kind !== "sourcemap" && basename(o.path).startsWith(`${stem}-`) && o.path.endsWith(ext),
  );
  if (!hit) throw new Error(`the build emitted no ${stem}${ext}`);
  return basename(hit.path);
};

const shellEntry = { js: named(shell, "index", ".js"), css: named(shell, "index", ".css") };

// The import map the browser needs so a sub-app's bare specifiers resolve to
// the files above. Keys are what the apps write; values are what gets served,
// relative to the SHELL unit's own base - which is what lets a sub-app from a
// different unit resolve them.
const imports: Record<string, string> = {
  preact: named(shell, "preact", ".js"),
  "preact/hooks": named(shell, "preact-hooks", ".js"),
  "preact/jsx-runtime": named(shell, "preact-jsx-runtime", ".js"),
  "@preact/signals": named(shell, "preact-signals", ".js"),
  "@pointer/shell": named(shell, "api", ".js"),
};

// --- 2. one build per sub-app ---------------------------------------------

/** Every module specifier an ES module output imports. */
const specifiersIn = (source: string): string[] =>
  [...source.matchAll(/(?:^|[;}\s])(?:import|export)[^'"`]*?from\s*["']([^"']+)["']/g)]
    .map((m) => m[1]!)
    .concat([...source.matchAll(/(?:^|[;}\s])import\s*["']([^"']+)["']/g)].map((m) => m[1]!));

type UnitFiles = { js: string; css?: string; files: string[]; integrity: Record<string, string> };
const appOutputs: Record<string, UnitFiles> = {};

for (const app of APPS) {
  const built = await Bun.build({
    ...common,
    define: defines(app),
    entrypoints: [`src/web/apps/${app}/index.tsx`],
    outdir: unitDir(app),
    external: [...SHARED],
    naming: { entry: `${app}-[hash].[ext]`, asset: `${app}-[hash].[ext]` },
  });
  if (!built.success) fail(app, built.logs);

  const js = built.outputs.find((o) => o.kind === "entry-point" && o.path.endsWith(".js"));
  const css = built.outputs.find((o) => o.path.endsWith(".css"));
  if (!js) throw new Error(`${app} emitted no JavaScript`);

  appOutputs[app] = {
    js: basename(js.path),
    ...(css ? { css: basename(css.path) } : {}),
    files: built.outputs.map((o) => basename(o.path)),
    integrity: await integrityOf(built.outputs),
  };

  // The invariant the whole design rests on: a sub-app reaches the shared
  // runtime and the store by name, and carries no copy of its own. If Preact
  // were bundled in here it would have its own signals runtime, and the shell's
  // counters would quietly stop re-rendering this app.
  const specifiers = new Set(specifiersIn(await js.text()));
  const strays = [...specifiers].filter((s) => !SHARED.includes(s as (typeof SHARED)[number]));
  if (strays.length) {
    throw new Error(
      `${app} imports ${strays.join(", ")}, which the import map does not name. ` +
        `A sub-app may only import the shared specifiers: ${SHARED.join(", ")}.`,
    );
  }
  // Any app that renders JSX imports this, so an app that does NOT is one that
  // bundled its own Preact - which gives it a second signals runtime and a
  // store the rest of the page cannot see. It is no longer "preact" itself:
  // a sub-app takes the store from a prop and calls no Preact value directly,
  // so the JSX runtime is the import every one of them still has.
  for (const required of ["preact/jsx-runtime"]) {
    if (!specifiers.has(required)) {
      throw new Error(
        `${app} does not import ${required} as a bare specifier, so it has bundled ` +
          `its own copy. That breaks the shared store.`,
      );
    }
  }
}

// --- 3. record -------------------------------------------------------------

/**
 * A unit's id is a hash of what it emitted, and nothing else.
 *
 * Bun's [hash] is content-derived, so the emitted names already carry the
 * content. The commit is deliberately not in it: the commit identifies the
 * source, not the artefact, and putting it in the id would mean one commit
 * touching only alpha changed all five ids and republished all five - which
 * removes the point of publishing units separately. The commit is recorded in
 * unit.json instead.
 */
const unitId = (files: string[]): string =>
  new Bun.CryptoHasher("sha256").update(JSON.stringify([...files].sort())).digest("hex").slice(0, 8);

export type UnitRecord = {
  id: string;
  js: string;
  css: string | null;
  /** The shell only. The page's import map, relative to the shell's own base. */
  imports?: Record<string, string>;
  /** Every emitted file, relative to the unit's directory. */
  files: string[];
  /**
   * File name to SRI digest, for every file but the source maps.
   *
   * Travels with the unit rather than with the composition, because the bytes
   * it describes are the unit's own. A composition that names an older unit
   * gets that unit's digests with it.
   */
  integrity: Record<string, string>;
  /** Which contracts this unit compiles against. Generated, never written. */
  contracts: string[];
  /** Resolved versions of the shared packages. Compared at promote, not enforced. */
  shared: Record<string, string>;
  marker: string;
};

export type BuildRecord = {
  schema: 3;
  contract: string;
  /**
   * Which source produced these bytes.
   *
   * Recorded HERE rather than read again at publish or promote time, because
   * `dist/` outlives the tree that filled it. Build at one commit, commit more
   * work, and a script asking git afterwards gets an answer about the tree and
   * not about the bytes in front of it.
   */
  source: Source;
  units: Record<string, UnitRecord>;
};

const shellFiles = shell.outputs.map((o) => basename(o.path));
const units: Record<string, UnitRecord> = {
  shell: {
    id: unitId(shellFiles),
    js: shellEntry.js,
    css: shellEntry.css,
    imports,
    files: shellFiles,
    integrity: await integrityOf(shell.outputs),
    contracts: matrix.sets.shell,
    shared: versions,
    marker: markerFor("shell"),
  },
};
for (const app of APPS) {
  const out = appOutputs[app]!;
  units[app] = {
    id: unitId(out.files),
    js: out.js,
    css: out.css ?? null,
    files: out.files,
    integrity: out.integrity,
    contracts: matrix.sets[app],
    shared: versions,
    marker: markerFor(app),
  };
}

// No git means no identified source, so this build is marked as though the tree
// were dirty. `promote` refuses either way on a real channel, which is the
// reading that is true: nothing here can say which commit these bytes are.
const source = currentSource() ?? { commit: "0".repeat(40), dirty: true };

const record: BuildRecord = { schema: 3, contract: headHash, source, units };
await Bun.write(`${OUTDIR}/build.json`, `${JSON.stringify(record, null, 2)}\n`);

const bytes = shell.outputs.reduce((n, o) => n + o.size, 0);
console.log(
  `contract ${headHash}\n` +
    `shell    ${units.shell!.id}  ${shellEntry.js} + ${shellEntry.css} ` +
    `(${(bytes / 1024).toFixed(1)} kB with the shared runtime)\n` +
    APPS.map((a) => `${a.padEnd(8)} ${units[a]!.id}  ${units[a]!.js}`).join("\n"),
);
