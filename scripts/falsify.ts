// Proves the @local scenarios have teeth.
//
// A scenario that has only ever been green is not evidence. Each mutation
// below breaks one specific behaviour and names the one scenario that must
// go red because of it. If a mutation is applied and everything still passes,
// that scenario is decoration and should be fixed or deleted.
//
//   bun run falsify

type Mutation = {
  name: string;
  file: string;
  find: string;
  replace: string;
  /** The scenario that must fail. A regex, matched against the name. */
  scenario: string;
};

const MUTATIONS: Mutation[] = [
  {
    name: "the shell becomes cacheable",
    file: "src/server/html.ts",
    find: '"cache-control": "no-store, must-revalidate",',
    replace: '"cache-control": "public, max-age=60",',
    scenario: "A shell is never stored by an intermediary",
  },
  {
    name: "an unknown host falls back to a channel",
    file: "src/server/origins.ts",
    find: "return table[name] ?? null;",
    replace: 'return table[name] ?? "prod";',
    scenario: "An unrecognised origin is refused rather than defaulted",
  },
  {
    name: "the server serves an asset path",
    file: "src/server/index.ts",
    find: 'return text("not found", 404);\n    }\n\n    const target',
    replace: 'return text("here you go", 200);\n    }\n\n    const target',
    scenario: "The server holds no application files of its own",
  },
  {
    name: "single-flight is removed",
    file: "src/server/manifest.ts",
    find: "const pending = e.inflight ?? beginRefresh(url, e);",
    replace: "const pending = beginRefresh(url, e);",
    scenario: "A burst of visitors causes one read of the manifest",
  },
  {
    name: "a failed refresh clears the cached build",
    file: "src/server/manifest.ts",
    find: "      // e.value is deliberately untouched. Rules 5 and 8.",
    replace: "      e.value = null;",
    scenario: "A running server keeps serving the last build it read",
  },
  {
    name: "stale-while-revalidate is removed",
    file: "src/server/manifest.ts",
    find: "      if (e.value) return e.value; // Rule 2: never wait when something is serveable.",
    replace: "      // (stale-while-revalidate removed)",
    scenario: "A visitor is never made to wait for the store",
  },
  {
    name: "the health check reads the manifest",
    file: "src/server/index.ts",
    find: 'if (pathname === "/healthz") return text("ok", 200);',
    replace:
      'if (pathname === "/healthz") {\n      const m = await manifests.get(manifestUrl(MANIFEST_BASE, REGION, "qa"));\n      return m ? text("ok", 200) : text("unhealthy", 503);\n    }',
    scenario: "The health check answers while the store is unreachable",
  },
  {
    name: "manifest validation is removed",
    file: "src/server/manifest.ts",
    find: "      e.value = parseManifest(await res.json());",
    replace: "      e.value = (await res.json()) as Manifest;",
    scenario: "A manifest the server cannot trust does not replace a good one",
  },
];

const CUKE = ["bun", "node_modules/@cucumber/cucumber/bin/cucumber.js"];

async function runScenario(scenario: string): Promise<boolean> {
  const proc = Bun.spawn([...CUKE, "--tags", "@local", "--name", scenario], {
    env: { ...process.env, HARNESS: "local" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (!/\d+ scenarios? \(/.test(out)) {
    throw new Error(`--name ${JSON.stringify(scenario)} matched no single scenario:\n${out}`);
  }
  return code === 0;
}

let failures = 0;

for (const m of MUTATIONS) {
  const original = await Bun.file(m.file).text();
  if (!original.includes(m.find)) {
    console.log(`✗ ${m.name}: the code it patches has moved. Update scripts/falsify.ts.`);
    failures++;
    continue;
  }

  await Bun.write(m.file, original.replace(m.find, m.replace));
  let stillGreen: boolean;
  try {
    stillGreen = await runScenario(m.scenario);
  } finally {
    await Bun.write(m.file, original);
  }

  if (stillGreen) {
    console.log(`✗ ${m.name}\n    "${m.scenario}" stayed green. That scenario proves nothing.`);
    failures++;
  } else {
    console.log(`✓ ${m.name}\n    caught by "${m.scenario}"`);
  }
}

// The suite must be green again now that every mutation is reverted.
const restored = Bun.spawnSync([...CUKE, "--tags", "@local"], {
  env: { ...process.env, HARNESS: "local" },
});
if (restored.exitCode !== 0) {
  console.log("✗ the suite is not green after restoring the sources");
  failures++;
}

console.log(
  failures === 0
    ? `\nSUCCESS: ${MUTATIONS.length} mutations, each caught by its scenario`
    : `\nFAILURE: ${failures} of ${MUTATIONS.length} mutations were not caught`,
);
process.exit(failures === 0 ? 0 : 1);

export {};
