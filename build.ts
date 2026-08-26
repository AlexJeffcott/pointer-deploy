// Builds the shell and every sub-app, and records what it emitted in
// dist/build.json so publish.ts does not re-derive the names.
//
// Two kinds of build, and the difference is the whole architecture:
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

import { rm, mkdir } from "node:fs/promises";
import { basename } from "node:path";

const OUTDIR = "dist";
const APPS = ["alpha", "bravo", "charlie", "delta"] as const;

/** Bare specifiers the shell owns and every sub-app borrows. */
const SHARED = [
  "preact",
  "preact/hooks",
  "preact/jsx-runtime",
  "@preact/signals",
  "@pointer/shell",
] as const;

// Bun decides which JSX runtime to emit when the process starts, so this cannot
// be set from here. Without it every sub-app imports preact/jsx-dev-runtime,
// which the import map does not name, and fails to resolve in the browser.
if (Bun.env.NODE_ENV !== "production") {
  throw new Error(
    "NODE_ENV must be production before the process starts, or Bun emits the " +
      "development JSX runtime. Run `bun run build`, not `bun build.ts`.",
  );
}

const marker = Bun.env.BUILD_MARKER ?? "";
const common = {
  target: "browser",
  minify: true,
  sourcemap: "linked",
  define: { __BUILD_MARKER__: JSON.stringify(marker) },
} as const;

await rm(OUTDIR, { recursive: true, force: true });
await mkdir(OUTDIR, { recursive: true });

const fail = (label: string, logs: unknown[]): never => {
  for (const log of logs) console.error(log);
  throw new Error(`${label} failed to build`);
};

// --- 1. shell, store and the shared runtime -------------------------------

const shell = await Bun.build({
  ...common,
  entrypoints: [
    "src/web/shell/index.tsx",
    "src/web/shell/api.ts",
    "src/web/vendor/preact.ts",
    "src/web/vendor/preact-hooks.ts",
    "src/web/vendor/preact-jsx-runtime.ts",
    "src/web/vendor/preact-signals.ts",
  ],
  outdir: OUTDIR,
  splitting: true,
  naming: {
    entry: "[name]-[hash].[ext]",
    chunk: "shared-[hash].[ext]",
    asset: "[name]-[hash].[ext]",
  },
});
if (!shell.success) fail("the shell", shell.logs);

const named = (build: Bun.BuildOutput, stem: string, ext: string) => {
  const hit = build.outputs.find(
    (o) => o.kind !== "sourcemap" && basename(o.path).startsWith(`${stem}-`) && o.path.endsWith(ext),
  );
  if (!hit) throw new Error(`the build emitted no ${stem}${ext}`);
  return basename(hit.path);
};

const shellEntry = { js: named(shell, "index", ".js"), css: named(shell, "index", ".css") };

// The import map the browser needs so a sub-app's bare specifiers resolve to
// the files above. Keys are what the apps write; values are what gets served.
const imports: Record<string, string> = {
  preact: named(shell, "preact", ".js"),
  "preact/hooks": named(shell, "preact-hooks", ".js"),
  "preact/jsx-runtime": named(shell, "preact-jsx-runtime", ".js"),
  "@preact/signals": named(shell, "preact-signals", ".js"),
  "@pointer/shell": named(shell, "api", ".js"),
};

// --- 2. one build per sub-app ---------------------------------------------

const apps: Record<string, { js: string; css?: string }> = {};
const appFiles: string[] = [];

/** Every module specifier an ES module output imports. */
const specifiersIn = (source: string): string[] =>
  [...source.matchAll(/(?:^|[;}\s])(?:import|export)[^'"`]*?from\s*["']([^"']+)["']/g)]
    .map((m) => m[1]!)
    .concat([...source.matchAll(/(?:^|[;}\s])import\s*["']([^"']+)["']/g)].map((m) => m[1]!));

for (const app of APPS) {
  const built = await Bun.build({
    ...common,
    entrypoints: [`src/web/apps/${app}/index.tsx`],
    outdir: `${OUTDIR}/apps`,
    external: [...SHARED],
    naming: { entry: `${app}-[hash].[ext]`, asset: `${app}-[hash].[ext]` },
  });
  if (!built.success) fail(app, built.logs);

  const js = built.outputs.find((o) => o.kind === "entry-point" && o.path.endsWith(".js"));
  const css = built.outputs.find((o) => o.path.endsWith(".css"));
  if (!js) throw new Error(`${app} emitted no JavaScript`);

  apps[app] = {
    js: `apps/${basename(js.path)}`,
    ...(css ? { css: `apps/${basename(css.path)}` } : {}),
  };

  appFiles.push(...built.outputs.map((o) => `apps/${basename(o.path)}`));

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
  for (const required of ["preact", "@pointer/shell"]) {
    if (!specifiers.has(required)) {
      throw new Error(
        `${app} does not import ${required} as a bare specifier, so it has bundled ` +
          `its own copy. That breaks the shared store.`,
      );
    }
  }
}

// --- record ----------------------------------------------------------------

const files = [...shell.outputs.map((o) => basename(o.path)), ...appFiles];

await Bun.write(
  `${OUTDIR}/build.json`,
  `${JSON.stringify({ shell: shellEntry, imports, apps, files }, null, 2)}\n`,
);

const bytes = shell.outputs.reduce((n, o) => n + o.size, 0);
console.log(
  `shell ${shellEntry.js} + ${shellEntry.css} (${(bytes / 1024).toFixed(1)} kB with the shared runtime)\n` +
    APPS.map((a) => `  ${a.padEnd(8)} ${apps[a]!.js}`).join("\n"),
);
