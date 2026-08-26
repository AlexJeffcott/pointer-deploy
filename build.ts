// Bundles the client into dist/ with content-hashed file names, and records
// what it emitted in dist/build.json so publish.ts does not have to re-derive
// the names.
//
// Bun handles the JSX transform through tsconfig.json (jsx: react-jsx,
// jsxImportSource: preact) and scopes *.module.css with no configuration, so
// there is no separate build tool and no plugin to keep in step.

import { mkdir, rm } from "node:fs/promises";
import { basename } from "node:path";

const OUTDIR = "dist";

await rm(OUTDIR, { recursive: true, force: true });
await mkdir(OUTDIR, { recursive: true });

// A build-time constant. Two builds of the same source with different markers
// are genuinely different bundles with different content hashes, which is how
// the acceptance suite produces two distinct real builds to promote between.
const marker = Bun.env.BUILD_MARKER ?? "";

const result = await Bun.build({
  entrypoints: ["src/web/index.tsx"],
  define: { __BUILD_MARKER__: JSON.stringify(marker) },
  outdir: OUTDIR,
  target: "browser",
  // Production builds only. A development bundle would ship unminified source
  // and Preact's debug warnings to every visitor.
  minify: true,
  sourcemap: "linked",
  naming: "[name]-[hash].[ext]",
});

if (!result.success) {
  for (const log of result.logs) console.error(log);
  process.exit(1);
}

const emitted = result.outputs.filter((o) => o.kind !== "sourcemap");
const js = emitted.find((o) => o.path.endsWith(".js"));
const css = emitted.find((o) => o.path.endsWith(".css"));

// A missing stylesheet means the CSS module import stopped being bundled.
// Failing here beats publishing a build whose manifest names a file that is
// not in the build directory.
if (!js) throw new Error("the build emitted no JavaScript entry point");
if (!css) throw new Error("the build emitted no stylesheet");

const files = result.outputs.map((o) => basename(o.path));

await Bun.write(
  `${OUTDIR}/build.json`,
  `${JSON.stringify({ entry: { js: basename(js.path), css: basename(css.path) }, files }, null, 2)}\n`,
);

const bytes = result.outputs.reduce((n, o) => n + o.size, 0);
console.log(
  `built ${result.outputs.length} files, ${(bytes / 1024).toFixed(1)} kB\n` +
    `  js  ${basename(js.path)}\n  css ${basename(css.path)}`,
);
