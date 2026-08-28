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
  /**
   * A @browser scenario. Set `live` too: it needs the real store, the real
   * bundles and a Chrome.
   *
   * These are the only scenarios that can falsify a SERVER edit, because a
   * @test-channel scenario runs `bun src/server/index.ts` from this working
   * tree rather than against the deployed image.
   */
  browser?: boolean;
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
    // The cache is generic over its parser now, so the mutation drops the
    // parser rather than naming one.
    find: "      e.value = parse(await res.json());",
    replace: "      e.value = (await res.json()) as T;",
    scenario: "A manifest the server cannot trust does not replace a good one",
  },
  {
    // The TTL over a wall clock. A machine resumed from a snapshot can come
    // back with its clock behind, and an unguarded `now() - checkedAt` is then
    // negative - smaller than any TTL, so the entry reads as fresh forever and
    // the origin serves a composition nobody promoted with nothing to show for
    // it. A unit test, not a scenario: reproducing it through the network
    // means moving a machine's clock.
    name: "a clock that moved backwards counts as freshness",
    file: "src/server/manifest.ts",
    find: "      if (age >= 0 && age < ttlMs) return e.value;",
    replace: "      if (age < ttlMs) return e.value;",
    unitTest: "backwards",
  },
  {
    // index.ts is outside stryker's mutate set, so these two are the only
    // thing holding the reading an operator diagnoses a stuck origin with.
    name: "the shell stops reporting its manifest's age",
    file: "src/server/index.ts",
    find: 'res.headers.set("x-manifest-age", state.ageMs === null ? "never" : String(state.ageMs));',
    replace: 'res.headers.set("x-manifest-age", "never");',
    scenario: "A shell says how old the manifest it was rendered from is",
  },
  {
    name: "a refresh that failed is reported as one that worked",
    file: "src/server/index.ts",
    find: 'res.headers.set("x-manifest-refresh", state.lastError ?? "ok");',
    replace: 'res.headers.set("x-manifest-refresh", "ok");',
    scenario: "An origin that could not refresh its manifest says so",
  },

  // --- the composition ----------------------------------------------------
  //
  // Everything below is @live, because what these break is what publish.ts and
  // promote.ts do to the real store. A @local stand-in for either could keep a
  // scenario green while the real path was broken.

  {
    // The refusal is the only thing standing between a stale dist/ and a
    // harness build on a real channel. It ran on prod once.
    //
    // Not live, though it breaks promote.ts: the scenario it must redden runs
    // the real script from a temporary directory against an unresolvable store,
    // so no credentials and no deployed machine are involved.
    name: "the harness-build refusal is removed",
    file: "scripts/promote.ts",
    find: "  if (marked.length > 0 && !channelArg.startsWith(\"test-\")) {",
    replace: "  if (false) {",
    scenario: "A build the harness made is refused on a real channel",
  },
  {
    // The other side of it. A blanket refusal of every marked build would pass
    // the scenario above and stop the live suite promoting anything.
    name: "the refusal stops exempting the suite's own channels",
    file: "scripts/promote.ts",
    find: "  if (marked.length > 0 && !channelArg.startsWith(\"test-\")) {",
    replace: "  if (marked.length > 0) {",
    scenario: "The suite's own channels still accept a build the harness made",
  },
  {
    // And a refusal that ignored the marker would refuse every deploy.
    name: "the refusal ignores the marker and refuses every build",
    file: "scripts/promote.ts",
    find: "  if (marked.length > 0 && !channelArg.startsWith(\"test-\")) {",
    replace: "  if (!channelArg.startsWith(\"test-\")) {",
    scenario: "An ordinary build is not refused on a real channel",
  },

  // --- the source a build came from ---------------------------------------
  //
  // The other half of the same guard, and the half with no tell on it. A build
  // from an older commit carries no marker, so nothing above catches it, and
  // every check downstream stays green because the manifest is well-formed.
  //
  // @local for the same reason as the three above: these scenarios run the real
  // script from a temporary repository against an unresolvable store, so no
  // credentials and no deployed machine are involved.

  {
    name: "the source refusal is removed",
    file: "scripts/promote.ts",
    find: "  if (!channelArg.startsWith(\"test-\")) {",
    replace: "  if (false) {",
    scenario: "A build from an older commit is refused on a real channel",
  },
  {
    // A blanket refusal would pass the scenario above and stop the suites, and
    // the ordinary edit-build-look loop, promoting anything.
    name: "the source refusal stops exempting the suite's own channels",
    file: "scripts/promote.ts",
    find: "  if (!channelArg.startsWith(\"test-\")) {",
    replace: "  if (true) {",
    scenario: "The suite's own channels still accept a build from an older commit",
  },
  {
    // And a refusal that ignored what it read would refuse every deploy.
    name: "the source refusal ignores what it read and refuses every build",
    file: "scripts/promote.ts",
    find: "  if (!ofBuild) {",
    replace: "  if (true) {",
    scenario: "A build from the commit this tree is at is promoted",
  },
  {
    // The commit alone cannot see this one: a dirty build names the commit the
    // work started at, and its bytes are nowhere in git.
    name: "a dirty build passes the source check",
    file: "scripts/promote.ts",
    find: "  if (ofBuild.dirty) {",
    replace: "  if (false) {",
    scenario: "A build from an uncommitted working tree is refused on a real channel",
  },
  {
    // Deliberately serving an older build is a real operation, so the refusal
    // has an override. Without it the only way past a stale dist/ is a rebuild.
    name: "the source check's override is ignored",
    file: "scripts/promote.ts",
    find: "    if (refusal !== null && argv.includes(\"--no-source-check\")) {",
    replace: "    if (false) {",
    scenario: "An older build is promoted when the operator overrides the check",
  },

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
    find: "        const urls = unitUrls(a);",
    replace: "        const urls = unitUrls({ ...a, assetBase: m.shell.assetBase });",
    unitTest: "loads each sub-app from its own unit's base",
  },
  // --- choosing a version --------------------------------------------------
  //
  // The switcher lets a visitor compose the page themselves, so two of its
  // three guards are about what it must REFUSE, and the third is about the
  // record it offers from.

  {
    // Without this the query string is a way to make this origin serve any
    // object in the store, named by whoever crafts the link.
    name: "any unit id may be asked for, not only ones the channel served",
    file: "src/server/composition.ts",
    find: "    if (!known) return `the ${unit} unit ${id} is not one this channel has served`;",
    replace: "    if (false) return `the ${unit} unit ${id} is not one this channel has served`;",
    scenario: "An id the channel has never served is refused",
    live: true,
  },
  {
    // The same rule promote applies, applied where a visitor chooses. Without
    // it the switcher offers a composition promote would have refused.
    name: "the switcher offers a composition with no shared contract",
    file: "src/server/composition.ts",
    find: "        disabled:\n          chooseContract({ ...chosenContracts, [unit]: e.contracts }) === null,",
    replace: "        disabled: false,",
    scenario: "A unit that cannot be composed with the rest is offered and disabled",
    live: true,
  },
  {
    // A history that kept only what is live would make the switcher a control
    // with one option, which is not a switcher.
    name: "a channel's history keeps only what it serves now",
    file: "scripts/promote.ts",
    find: "    ].slice(0, HISTORY_DEPTH);",
    replace: "    ].slice(0, 1);",
    scenario: "The page offers every unit the channel has served",
    live: true,
  },
  {
    // The default is the guard. Everything else about the switcher is reachable
    // only once a channel is named.
    name: "the switcher is on for every channel by default",
    file: "src/server/composition.ts",
    find: '    (value ?? "")',
    replace: '    (value ?? "qa,prod,test-qa,test-prod")',
    unitTest: "no configuration names no channel",
  },

  {
    // The defect this fix closed. `ComposedUnit.css` is `string | null`, and
    // joining a base against an empty name gives the unit's own DIRECTORY - so
    // the page linked a listing as its stylesheet. A unit test, not a scenario:
    // nothing build.ts emits has a shell with no stylesheet, so no channel can
    // be made to serve one.
    name: "a shell with no stylesheet links its own directory",
    file: "src/server/html.ts",
    find: "      css: m.shell.css === null ? null : joinUrl(m.shell.assetBase, m.shell.css),",
    replace: '      css: joinUrl(m.shell.assetBase, m.shell.css ?? ""),',
    unitTest: "no stylesheet links no stylesheet",
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

  // --- the schema a rollback can land on -----------------------------------
  //
  // These two break the SERVER, and unlike the @live scenarios above they can
  // be falsified from here: a @test-channel scenario runs
  // `bun src/server/index.ts` out of this working tree against the real store,
  // because no browser can reach a test-* channel on Fly. So the edit reaches
  // the code under test, which is exactly what an @live scenario about server
  // behaviour cannot offer.

  {
    // The rollback nobody would miss until they needed it. A channel still
    // pointing at a pointer written before the split would answer 503 to every
    // visitor, and every other check would stay green.
    name: "the server stops accepting schema 2",
    file: "src/server/manifest.ts",
    find: "  if (m.schema !== 1 && m.schema !== 2 && m.schema !== 3) {",
    replace: "  if (m.schema !== 1 && m.schema !== 3) {",
    scenario: "A page served from a schema 2 manifest comes from one build directory",
    live: true,
    browser: true,
  },
  {
    // Schema 2's import map is the only thing making five separately fetched
    // bundles share one signals runtime. Dropping it leaves a page that
    // answers 200, paints the frame, and resolves not one sub-app.
    name: "a schema 2 page is served with no import map",
    file: "src/server/html.ts",
    find:
      "  return Object.fromEntries(\n" +
      "    Object.entries(m.imports).map(([name, file]) => [name, joinUrl(m.assetBase, file)]),\n" +
      "  );",
    replace: "  return {};",
    scenario: "Five bundles resolved through one import map are still one application",
    live: true,
    browser: true,
  },

  // --- what the browser is allowed to load ---------------------------------
  //
  // Every mutation here leaves a page that loads, renders and reports the
  // right build. That is the whole difficulty: a digest nobody checks and a
  // policy that permits everything look exactly like the ones that work.

  {
    // A digest on the shell's tag covers the shell's entry and nothing behind
    // it. The chunk that entry imports, and every sub-app the loader imports
    // by URL, are declared here or nowhere.
    name: "the import map stops carrying digests",
    file: "src/server/html.ts",
    find: "  const integrity = moduleIntegrity(m);",
    replace: "  const integrity: Record<string, string> = {};",
    scenario: "A sub-app whose script does not match its digest does not run",
    live: true,
    browser: true,
  },
  {
    // The other mechanism. A stylesheet never resolves through the import map,
    // so its digest has to reach the loader on the app list instead.
    name: "a sub-app's stylesheet digest never reaches the loader",
    file: "src/server/html.ts",
    find: "        const digest = a.css ? a.integrity?.[a.css] : undefined;",
    replace: "        const digest: string | undefined = undefined;",
    scenario: "A sub-app whose stylesheet does not match its digest does not run",
    live: true,
    browser: true,
  },
  {
    // A policy naming no origin refuses every file the manifest names. The
    // shell still answers 200 and still paints its frame, which is why only a
    // browser can tell.
    name: "the policy names none of the origins the files come from",
    file: "src/server/html.ts",
    find: "  const script = [...origins, ...(text === null ? [] : [`'${sha256(text)}'`])];",
    replace: "  const script = [...(text === null ? [] : [`'${sha256(text)}'`])];",
    scenario: "The page assembles from five bundles under its own policy",
    live: true,
    browser: true,
  },
  {
    // The hash is what lets the one inline script on the page run. Without it
    // the import map is refused, every bare specifier in every sub-app fails
    // to resolve, and the frame renders with four refusals in it.
    name: "the policy stops allowing the import map it emitted",
    file: "src/server/html.ts",
    find: "  const script = [...origins, ...(text === null ? [] : [`'${sha256(text)}'`])];",
    replace: "  const script = [...origins];",
    scenario: "The page assembles from five bundles under its own policy",
    live: true,
    browser: true,
  },
  {
    // The trap this pays for once: a cross-origin file carrying a digest is
    // REFUSED rather than checked unless it is fetched with CORS. The page
    // then renders unstyled, and every other check stays green.
    name: "a digest is attached without the CORS needed to check it",
    file: "src/server/html.ts",
    find: " crossorigin=\"anonymous\"",
    replace: "",
    scenario: "The page assembles from five bundles under its own policy",
    live: true,
    browser: true,
  },
  {
    name: "the shell is served with no content policy",
    file: "src/server/html.ts",
    find: '      "content-security-policy": contentSecurityPolicy(m),',
    replace: "      // (no policy)",
    scenario: "A shell names the only origins its files may come from",
  },
  {
    name: "the shell's own script and stylesheet carry no digest",
    file: "src/server/html.ts",
    find: "  return { js: at(m.shell.js), css: at(m.shell.css) };",
    replace: "  return {};",
    scenario: "A shell names the digest of every file it tells the browser to fetch",
  },
];

const CUKE = ["bun", "node_modules/@cucumber/cucumber/bin/cucumber.js"];

async function runScenario(m: Mutation): Promise<boolean> {
  const tag = m.browser ? "@browser" : m.live ? "@live" : "@local";
  const proc = Bun.spawn([...CUKE, "--tags", tag, "--name", m.scenario!], {
    env: { ...process.env, HARNESS: m.live ? "live" : "local" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(proc.stdout).text();
  await new Response(proc.stderr).text();
  const code = await proc.exited;
  if (!/\d+ scenarios? \(/.test(out)) {
    throw new Error(`--name ${JSON.stringify(m.scenario)} matched no single scenario:\n${out}`);
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
    const tag = m.browser ? "@browser" : "@live";
    console.log(`- ${m.name}\n    SKIPPED: ${tag}. Set FALSIFY_LIVE=1 to run it.`);
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
    stillGreen = m.scenario ? await runScenario(m) : await runUnitTest(m.unitTest!);
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
