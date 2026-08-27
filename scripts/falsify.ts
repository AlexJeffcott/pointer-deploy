// Proves the scenarios have teeth.
//
// A scenario that has only ever been green is not evidence. Each mutation
// below breaks one specific behaviour and names the one scenario that must
// go red because of it. If a mutation is applied and everything still passes,
// that scenario is decoration and should be fixed or deleted.
//
//   bun run falsify                  # the @local mutations
//   FALSIFY_LIVE=1 bun run falsify   # and the ones that need the real store
//
// The composition mutations are @live because what they break is what
// publish.ts and promote.ts do to the store. They are reported as SKIPPED
// rather than counted as passing, because a mutation nobody ran is not
// evidence either.

type Mutation = {
  name: string;
  file: string;
  find: string;
  replace: string;
  /**
   * What must go red. A scenario name, or a unit test name where the behaviour
   * is not something a visitor can observe.
   */
  scenario?: string;
  unitTest?: string;
  /**
   * A @live scenario, which needs the real store and the deployed machine.
   * Skipped unless FALSIFY_LIVE is set, and reported as skipped rather than
   * passed - a mutation nobody ran is not evidence either.
   */
  live?: boolean;
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
    // A unit test, not a scenario. How many times the server fetches is not
    // observable to a visitor, and a scenario that tried to observe it through
    // the network measured Bun's connection pooling instead: it went red on
    // only two runs in five.
    unitTest: "burst",
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

  // --- the composition ----------------------------------------------------
  //
  // Everything below is @live, because what these break is what publish.ts and
  // promote.ts do to the real store. A @local stand-in for either could keep a
  // scenario green while the real path was broken.

  {
    // The merge IS the feature. Without it every promote replaces all five
    // units, and "deploy alpha" silently rolls bravo back to whatever the
    // operator last had on disk.
    name: "promote replaces the composition instead of merging into it",
    file: "scripts/promote.ts",
    find: "  const kept = unit === \"shell\" ? current!.shell : current!.apps[unit]!;",
    replace:
      "  const kept = unit === \"shell\" ? current!.shell : current!.apps[unit]!;\n" +
      "  if (unit !== \"shell\") { continue; }",
    scenario: "Deploying one sub-app leaves the others where they were",
    live: true,
  },
  {
    // Rolling one unit back is exactly how a combination nothing has ever
    // typechecked comes to be served.
    name: "the contract intersection test is removed",
    file: "scripts/promote.ts",
    find: "if (shared.length === 0) {",
    replace: "if (false) {",
    scenario: "A composition with no contract in common is refused",
    live: true,
  },
  {
    // A unit id that carried the commit would change on every commit, so one
    // change to alpha would republish all five and the independence would only
    // exist in the pointer.
    name: "the unit id carries the commit",
    file: "build.ts",
    find: "  new Bun.CryptoHasher(\"sha256\").update(JSON.stringify([...files].sort())).digest(\"hex\").slice(0, 8);",
    replace:
      "  new Bun.CryptoHasher(\"sha256\")\n" +
      "    .update(JSON.stringify([...files].sort()) + String(Bun.env.FALSIFY_COMMIT ?? Date.now()))\n" +
      "    .digest(\"hex\")\n" +
      "    .slice(0, 8);",
    scenario: "Publishing after a change to one sub-app uploads that sub-app alone",
    live: true,
  },
  {
    // One shared base would name the right unit ids in the manifest and fetch
    // every sub-app from the shell's directory, where none of them are.
    //
    // A unit test, not the @live scenario that asserts the same thing. The
    // scenario runs against the DEPLOYED image, so editing this file does not
    // reach the code under test and the scenario stays green for a reason that
    // has nothing to do with its quality. That is worth stating rather than
    // hiding: an @live scenario about SERVER behaviour cannot be falsified by
    // a source edit. The three above can, because what they break is publish.ts
    // and promote.ts, which run here.
    name: "every unit is joined against the shell's base",
    file: "src/server/html.ts",
    find: "    return Object.fromEntries(Object.entries(m.apps).map(([name, a]) => [name, unitUrls(a)]));",
    replace:
      "    return Object.fromEntries(\n" +
      "      Object.entries(m.apps).map(([name, a]) => [name, unitUrls({ ...a, assetBase: m.shell.assetBase })]),\n" +
      "    );",
    unitTest: "loads each sub-app from its own unit's base",
  },
  {
    // The other half of the same invariant, and the one that would go unnoticed
    // longest: the map resolving against an app's base gives that app its own
    // Preact, so the page loads, renders, and silently stops agreeing with
    // itself. Exactly the failure the whole shared-runtime design exists to
    // prevent.
    name: "the import map is resolved against a sub-app's base",
    file: "src/server/html.ts",
    find: "        joinUrl(m.shell.assetBase, file),",
    replace: "        joinUrl(Object.values(m.apps)[0]?.assetBase ?? m.shell.assetBase, file),",
    unitTest: "resolves the import map against the shell's base",
  },
];

const CUKE = ["bun", "node_modules/@cucumber/cucumber/bin/cucumber.js"];

async function runScenario(scenario: string, live = false): Promise<boolean> {
  const proc = Bun.spawn([...CUKE, "--tags", live ? "@live" : "@local", "--name", scenario], {
    env: { ...process.env, HARNESS: live ? "live" : "local" },
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

async function runUnitTest(name: string): Promise<boolean> {
  const proc = Bun.spawn(["bun", "test", "src/server", "-t", name], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  const code = await proc.exited;
  if (/ 0 pass/.test(out) && / 0 fail/.test(out)) {
    throw new Error(`-t ${JSON.stringify(name)} matched no test:\n${out}`);
  }
  return code === 0;
}

const RUN_LIVE = Boolean(Bun.env.FALSIFY_LIVE);

let failures = 0;
let skipped = 0;

for (const m of MUTATIONS) {
  if (m.live && !RUN_LIVE) {
    // Reported, never silently dropped. A mutation nobody ran proves nothing,
    // and a summary that hid it would read as though it had.
    console.log(`- ${m.name}\n    SKIPPED: @live. Set FALSIFY_LIVE=1 to run it.`);
    skipped++;
    continue;
  }
  const original = await Bun.file(m.file).text();
  if (!original.includes(m.find)) {
    console.log(`✗ ${m.name}: the code it patches has moved. Update scripts/falsify.ts.`);
    failures++;
    continue;
  }

  const target = m.scenario ?? m.unitTest!;
  const kind = m.scenario ? "scenario" : "unit test";

  await Bun.write(m.file, original.replace(m.find, m.replace));
  let stillGreen: boolean;
  try {
    stillGreen = m.scenario
      ? await runScenario(m.scenario, m.live ?? false)
      : await runUnitTest(m.unitTest!);
  } finally {
    await Bun.write(m.file, original);
  }

  if (stillGreen) {
    console.log(`✗ ${m.name}\n    ${kind} "${target}" stayed green. It proves nothing.`);
    failures++;
  } else {
    console.log(`✓ ${m.name}\n    caught by ${kind} "${target}"`);
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

const ran = MUTATIONS.length - skipped;
const tail = skipped ? `, ${skipped} skipped (set FALSIFY_LIVE=1)` : "";
console.log(
  failures === 0
    ? `\nSUCCESS: ${ran} of ${MUTATIONS.length} mutations run, each caught by its check${tail}`
    : `\nFAILURE: ${failures} of ${ran} mutations run were not caught${tail}`,
);
process.exit(failures === 0 ? 0 : 1);

export {};
