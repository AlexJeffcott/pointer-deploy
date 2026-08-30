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
    find: "    return parse(await res.json());",
    replace: "    return (await res.json()) as T;",
    scenario: "A manifest the server cannot trust does not replace a good one",
  },
  {
    // §13. The third gate, and the only one comparing strings rather than
    // digests. Removing it serves a shell against a service that cannot answer
    // the version it calls: the page renders, hydration 404s, and the values
    // silently come from nowhere. A unit test, not a scenario - reproducing it
    // live means deploying a service that answers a different version.
    name: "the API version gate is removed",
    file: "src/server/composition.ts",
    find: "  const api = apiRefusal(serves, surfaces.shell);\n  if (typeof api === \"string\") return api;",
    replace: "  apiRefusal(serves, surfaces.shell);",
    unitTest: "refuseComposition refuses a chosen shell the service cannot feed",
  },
  {
    // The gate present but blind. It has to compare the SETS, not merely have
    // been called - and a filter that finds nothing missing allows everything.
    name: "every version counts as answered",
    file: "src/server/composition.ts",
    find: "  const missing = needs.filter((v) => !serves.includes(v));",
    replace: "  const missing: string[] = [];",
    unitTest: "the API gate",
  },
  {
    // Rule 11. A fetch that answers neither the request nor its own abort
    // leaves the refresh promise pending for the life of the process, so
    // e.inflight stays set and every later request takes the stale path -
    // silently, with the last refresh still stamped ok. A unit test, not a
    // scenario: no store can be made to hang and ignore an abort on demand.
    name: "the refresh deadline is removed",
    file: "src/server/manifest.ts",
    find: "  const deadlineMs = timeoutMs * 2;",
    replace: "  const deadlineMs = 2_147_483_647;",
    unitTest: "never settles",
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

  // --- §12, the reading a sunset is made on ------------------------------
  //
  // The count itself is in src/server/served.ts and stryker mutates that. What
  // stryker cannot see is index.ts, which is where the count is wired to the
  // one request that hands a composition out - so the wiring is falsified here.

  {
    name: "the origin stops counting what it hands out",
    file: "src/server/index.ts",
    find: "    handedOut.record({\n      channel: target.channel,",
    replace: "    if (false) handedOut.record({\n      channel: target.channel,",
    scenario: "The origin counts the composition it handed out",
  },
  {
    // The half a sunset would be wrong on. One operator working through the
    // version switcher, counted as visitors, reads as an old unit still in use
    // by people - which is exactly the finding that stops it being removed.
    name: "every response is counted as an operator's override",
    file: "src/server/index.ts",
    find: "      overridden,\n    });",
    replace: "      overridden: true,\n    });",
    scenario: "The origin counts the composition it handed out",
  },
  {
    name: "a repeat response starts the row again",
    file: "src/server/served.ts",
    find: "      const row = rows.get(key);",
    replace: "      const row = undefined as ServedComposition | undefined;",
    scenario: "Two visitors of one composition are one row, not two",
  },
  {
    // A log holding only what is served NOW answers the question nobody has to
    // ask. The reading exists for the composition the channel has moved off.
    name: "the origin keeps only the composition it serves now",
    file: "src/server/index.ts",
    find: "const handedOut = createServedLog();",
    replace: "const handedOut = createServedLog({ capacity: 1 });",
    scenario: "A composition served before a promote is still named after it",
  },
  {
    // A row no page corresponds to is worse than no row: an operator reads it
    // as a composition somebody is running.
    name: "a refused request is counted as a composition served",
    file: "src/server/index.ts",
    find: '    if (pathname === "/assets" || pathname.startsWith("/assets/")) {\n      return text("not found", 404);',
    replace:
      '    if (pathname === "/assets" || pathname.startsWith("/assets/")) {\n' +
      '      handedOut.record({ channel: "qa", region: REGION, buildId: "none", units: {}, contract: null, overridden: false });\n' +
      '      return text("not found", 404);',
    scenario: "A request that was refused is not counted as a composition",
  },
  {
    // The limits are the deliverable, not decoration on it. A count of what was
    // handed out, read as a count of what is still running, is how a unit gets
    // removed out from under the tabs still using it.
    name: "the reading stops saying what it cannot see",
    file: "src/server/served.ts",
    find: "        blindTo: BLIND_TO,",
    replace: "        blindTo: [],",
    scenario: "The reading says which population it cannot see",
  },
  {
    // The same wiring at the boundary the local scenarios cannot reach: the
    // stub store holds no history, so nothing @local can make an override
    // happen. @live, and it is the only check that an operator's own request
    // is separated where a real history and a real switcher are involved.
    name: "an operator's own choice is counted as a visitor's",
    file: "src/server/index.ts",
    find: "      overridden,\n    });",
    replace: "      overridden: false,\n    });",
    scenario: "An operator's own choice is not counted as a visitor's",
    live: true,
  },

  // --- §10, a contract that is going away ---------------------------------
  //
  // Unit tests rather than scenarios, and the reason is the item's own: a
  // deprecation is read by an operator at a command line, not by a visitor. The
  // WIRING - promote printing it, and contract:matrix refusing a deprecation on
  // the surface at HEAD - is held by `bun run e2e:deprecation`, which mints a
  // successor against the real store because nothing smaller can produce the
  // state at all.

  {
    name: "a deprecation may name a replacement nobody retains",
    file: "scripts/contract.ts",
    find: "    } else if (!registry.retained.includes(target.hash)) {",
    replace: "    } else if (false) {",
    unitTest: "a deprecation naming a replacement nobody retains is refused",
  },
  {
    name: "a deprecation need not say why",
    file: "scripts/contract.ts",
    find: '    if (typeof d.reason !== "string" || d.reason.trim() === "") {',
    replace: "    if (false) {",
    unitTest: "a deprecation that does not say why is refused",
  },
  {
    // The line an operator acts on. Told only that the contract is going away,
    // they move to the successor; told that this promote has no other option,
    // they know the composition has to be rebuilt before it can.
    name: "a promote with no other option is not told so",
    file: "scripts/contract.ts",
    find: "      : `  Every contract this composition shares is deprecated, so a promote has no other option.`,",
    replace: "      : ``,",
    unitTest: "that a promote with no other option has none",
  },
  {
    name: "the matrix stops naming a contract that is going away",
    file: "scripts/contract.ts",
    find: "  for (const contract of result.contracts) {\n    const d = contract.deprecated;",
    replace: "  for (const contract of [] as ContractRecord[]) {\n    const d = contract.deprecated;",
    unitTest: "the deprecation is named under the table",
  },

  // --- §5, the retention floor --------------------------------------------
  //
  // Unit tests, because what these break is a decision about deleting files
  // and the reading is made against a clock the test owns. The wiring - promote
  // stamping an entry it displaces - fails SAFE: with no stamp the floor falls
  // back to the last promote on that channel, which keeps a unit longer rather
  // than shorter, so it is read live rather than mutated here.

  {
    // The floor's first half. Without it a unit published an hour ago is
    // deletable the moment the next promote supersedes it.
    name: "the floor ignores how old the files are",
    file: "scripts/retention.ts",
    find: "    if (written > cutoff) {",
    replace: "    if (false) {",
    unitTest: "a unit written inside the floor stays",
  },
  {
    // The half an age-since-publish rule gets wrong: a year-old unit that was
    // serving traffic yesterday is a day out of use, not a year.
    name: "the floor ignores when a channel stopped serving it",
    file: "scripts/retention.ts",
    find: "    if (last !== undefined && last > cutoff) {",
    replace: "    if (false) {",
    unitTest: "an old unit a channel stopped serving inside the floor stays",
  },
  {
    name: "an entry with no stamp is treated as ancient",
    file: "scripts/retention.ts",
    find: "        const at = Date.parse(entry.supersededAt ?? history.updatedAt);",
    replace: '        const at = Date.parse(entry.supersededAt ?? "1970-01-01T00:00:00.000Z");',
    unitTest: "an entry with no stamp counts as the last promote on its channel",
  },
  {
    // A history entry dropped for a unit that STAYS retires a build the floor
    // is deliberately keeping - the switcher stops offering something whose
    // files are still there.
    name: "history entries are dropped whether or not the unit goes",
    file: "scripts/retention.ts",
    find: "        if (doomed.has(`units/${unit}/${entry.unitId}`)) {",
    replace: "        if (true) {",
    unitTest: "a history entry is kept when the floor keeps its unit",
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
    name: "the composition refusal is removed",
    file: "scripts/promote.ts",
    // The leading newline is load-bearing: `sourceRefusal` has an `} else if
    // (refusal !== null) {` above this, and a `find` that matched it patched
    // the wrong branch and read as caught. Measured on 2026-08-29.
    find: "\nif (refusal !== null) {",
    replace: "\nif (false) {",
    scenario: "A composition with no contract in common is refused",
    live: true,
  },
  {
    // §9. The gate that replaced the intersection: an app may not need a
    // member the shell does not have.
    name: "a member the shell does not have is allowed through",
    file: "src/server/composition.ts",
    find: "if (held === undefined) problems.push(",
    replace: "if (false) problems.push(",
    scenario: "A sub-app needing a member the shell does not have is refused",
    live: true,
  },
  {
    // A list of member NAMES would pass this. The digest is what makes a
    // narrowed parameter a different member.
    name: "a re-declared member is treated as the same member",
    file: "src/server/composition.ts",
    // Named in full: `blockRefusal` has the same shape one function below, and
    // a `find` that matched both would patch whichever came first.
    find: "else if (held !== digest) problems.push(`${name} uses",
    replace: "else if (false) problems.push(`${name} uses",
    unitTest: "a re-declared member refuses only the apps that name it",
  },
  {
    // The half `uses` cannot see. The shell requires all of `subapp.d.ts`, so
    // nothing about which members an app calls covers it.
    name: "the SubApp half is not compared",
    file: "src/server/composition.ts",
    find: "if (!surface.subapps.some((h) => shellHalves.includes(h))) {",
    replace: "if (false) {",
    unitTest: "a different SubApp half refuses even when every member fits",
  },
  {
    // §11, at the boundary a visitor crosses: choosing a shell this image
    // cannot feed must be refused, not rendered.
    name: "a shell this server cannot feed is served anyway",
    file: "src/server/composition.ts",
    find: "if (typeof blocks === \"string\") return blocks;",
    replace: "if (false) return blocks;",
    scenario: "Choosing a shell this server cannot feed is refused",
    live: true,
  },
  {
    // And the control: an option that cannot be chosen must say so, or an
    // operator finds out by being refused.
    name: "the switcher offers a shell this server cannot feed",
    file: "src/server/composition.ts",
    find: "          typeof blocks === \"string\" ||",
    replace: "          false ||",
    scenario: "A shell this server cannot feed is offered and disabled",
    live: true,
  },
  {
    // §11. Renaming a field of the server-to-shell blocks is exactly what broke
    // shell 606c1c3c on 2026-08-28. Nothing covered it then.
    name: "a block field is renamed",
    file: "src/server/blocks.ts",
    find: "  live: boolean;",
    replace: "  alive: boolean;",
    unitTest: "matches the surface it is derived from",
  },
  {
    // The gate itself: a shell may not read a field this server does not write.
    name: "a block field the server does not write is allowed through",
    file: "src/server/composition.ts",
    find: "if (held === undefined) problems.push(`that shell reads",
    replace: "if (false) problems.push(`that shell reads",
    unitTest: "a field this server does not write refuses, and names it",
  },
  {
    // A member whose removal breaks the surface cannot be asked about. Probing
    // it anyway reads it as used by every app, which would refuse compositions
    // that are fine.
    name: "a member that cannot be removed is probed anyway",
    file: "scripts/members.ts",
    find: "if (!(await surfaceHolds(dir, spec))) return { member, structural: true, users: [] as string[] };",
    replace: "if (false) return { member, structural: true, users: [] as string[] };",
    unitTest: "measures which app uses what",
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
    // The switcher must never cost a visitor a wait. A manifest is worth
    // waiting for on a cold cache, because without one there is no page; the
    // history is not, because without it the page is the one that was served
    // before the switcher existed.
    name: "a cold version history makes the visitor wait for the store",
    file: "src/server/index.ts",
    find: "      const history = histories.peek(historyUrl(MANIFEST_BASE, target.region, target.channel));",
    replace: "      const history = await histories.get(historyUrl(MANIFEST_BASE, target.region, target.channel));",
    scenario: "A visitor is never made to wait for the store",
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

  // --- containing what a sub-app throws -------------------------------------
  //
  // These two mutate a CLIENT bundle, which is why their scenarios build and
  // promote from this tree in their Background. A browser reading a
  // composition this run did not build would load the unmutated bundle and
  // stay green for the wrong reason.

  {
    // The name is the whole mechanism: Preact walks up looking for a component
    // that HAS componentDidCatch. Rename it and the class is no longer a
    // boundary, so a sub-app's throw carries on to the frame and takes the
    // page. Nothing else changes - the method still exists and still compiles.
    name: "the loader's boundary stops being a boundary",
    file: "src/web/shell/AsyncAppLoader.tsx",
    find: "  componentDidCatch(error: unknown): void {",
    replace: "  componentDidNotCatch(error: unknown): void {",
    scenario: "A sub-app that throws costs one panel and no more",
    live: true,
    browser: true,
  },
  {
    // Remounting without clearing the error leaves the panel in the state it
    // failed in. The control would still be there and would still do
    // something, which is the version of this bug nobody would notice.
    name: "mounting again does not clear the error",
    file: "src/web/shell/AsyncAppLoader.tsx",
    find: "    this.setState({ error: null, attempt: this.state.attempt + 1 });",
    replace: "    this.setState({ attempt: this.state.attempt + 1 });",
    scenario: "A panel that threw can be mounted again",
    live: true,
    browser: true,
  },

  // --- the shared store, from THIS tree -------------------------------------
  //
  // Section 19. The shared-state scenarios under the first Rule read the
  // DEPLOYED composition, so neither mutation below reaches them: they would
  // stay green against the last build that was promoted, which is exactly the
  // hole the second Rule was written to close. Both name a scenario from that
  // Rule, whose Background builds and promotes from here.

  {
    // A write that never reaches the map the other panels read. alpha's own
    // count still moves, the totals view still lists every namespace, and the
    // panel that did not create the counter reads zero - which is the failure
    // this whole design exists to prevent, and the one that looks like a
    // working page.
    name: "a sub-app's write does not reach the shared map",
    file: "src/web/shell/api.ts",
    find:
      "  const snapshot = computed<Counts>(() =>\n" +
      "    Object.entries(counters.value).sort(([a], [b]) => a.localeCompare(b)),\n" +
      "  );",
    replace:
      "  const snapshot = computed<Counts>(() =>\n" +
      "    Object.keys(counters.value).sort().map((k) => [k, 0] as const),\n" +
      "  );",
    scenario: "A count raised in one sub-app is read by another, from this tree",
    live: true,
    browser: true,
  },
  {
    // The claim api.ts makes about itself: an accessor reads `.value` INSIDE
    // itself, and that is what subscribes whichever component is rendering.
    // `peek` reads the same data and subscribes nobody, so every panel shows
    // the name it first rendered with and nothing on the page is wrong-looking.
    name: "an accessor reads the store without subscribing to it",
    file: "src/web/shell/api.ts",
    find: "    user: () => user.value,",
    replace: "    user: () => user.peek(),",
    scenario: "The name the frame holds reaches every sub-app, from this tree",
    live: true,
    browser: true,
  },

  // --- warming a sub-app's files -------------------------------------------

  {
    // Section 17. Without the tags the bundles for a view nobody has opened are
    // not fetched at all, and the page is exactly the one that was served
    // before preloading - which is why only a scenario that looks at the
    // network can tell the two apart.
    name: "the page warms none of the files a navigation will need",
    file: "src/server/html.ts",
    find: "</script>${preloadLinks(m)}",
    replace: "</script>",
    scenario: "The bundles for a view nobody has opened are warmed, not run",
    live: true,
    browser: true,
  },

  // --- placement -----------------------------------------------------------

  {
    // Section 14, and the direction nothing else reports. An app the build
    // emits that no view places is published, promoted, paid for and fetched
    // never. A unit test, not a scenario: what it breaks is a refusal at build
    // time, and a build that does not happen renders no page.
    name: "the placement check stops looking for an unplaced unit",
    file: "src/web/shell/views.ts",
    find: "    if (!placed.includes(app)) {",
    replace: "    if (false) {",
    unitTest: "reports a built app that no view places",
  },
];

// The runner, named the long way for the reason playwright.config.ts gives:
// `bun x playwright` runs the workers under Node, and the harness is Bun code.
const BDDGEN = ["bun", "node_modules/playwright-bdd/dist/cli/index.js", "test"];
const RUNNER = ["bun", "node_modules/@playwright/test/cli.js", "test"];

/** A scenario title as a regex that matches it and nothing it does not. */
const exactly = (name: string) => name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** How many scenarios each mutation's title matched, for the report. */
const matched = new Map<string, number>();

async function output(proc: Bun.Subprocess<"ignore", "pipe", "pipe">): Promise<string> {
  const out = await new Response(proc.stdout).text();
  const err = await new Response(proc.stderr).text();
  return out + err;
}

async function runScenario(m: Mutation): Promise<boolean> {
  const tag = m.browser ? "@browser" : m.live ? "@live" : "@local";
  const env = { ...process.env, HARNESS: m.live ? "live" : "local" };

  // Generation is filtered by tag and the run is filtered by title, so a
  // @local mutation never generates a @browser scenario and never starts a
  // browser to skip it.
  const gen = Bun.spawn([...BDDGEN, "--tags", tag], { env, stdout: "pipe", stderr: "pipe" });
  const genOut = await output(gen);
  if ((await gen.exited) !== 0) throw new Error(`bddgen failed for ${tag}:\n${genOut}`);

  const proc = Bun.spawn([...RUNNER, "--grep", exactly(m.scenario!)], {
    env,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await output(proc);
  const code = await proc.exited;

  // A title that matches NOTHING makes the reading meaningless, and that is the
  // failure this catches: the mutation would be reported as caught by a
  // scenario nobody ran. More than one is legitimate - a Scenario Outline is
  // one name and several examples - so the count is reported rather than
  // refused, and a mutation is caught only when every match is red.
  const ran = Number(/Running (\d+) tests? using/.exec(out)?.[1] ?? "0");
  if (ran === 0) {
    throw new Error(
      `--grep ${JSON.stringify(m.scenario)} matched no scenario under ${tag}:\n${out}`,
    );
  }
  matched.set(m.name, ran);
  return code === 0;
}

async function runUnitTest(name: string): Promise<boolean> {
  // The same homes the `test` script names. `scripts` is here because the
  // member reading lives there and a mutation of it must find its test.
  const proc = Bun.spawn(["bun", "test", "src/server", "src/web", "scripts", "-t", name], {
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
  // A `find` that matches twice patches whichever comes first, which may not be
  // the code the mutation is about - and the check that then goes red is
  // reported as catching a mutation that was never applied where it was aimed.
  // Found on 2026-08-29: "if (refusal !== null) {" matched `sourceRefusal`'s
  // branch as well as the composition gate, and the reading was wrong twice.
  if (original.split(m.find).length > 2) {
    console.log(
      `✗ ${m.name}: ${JSON.stringify(m.find)} matches ${original.split(m.find).length - 1} places ` +
        `in ${m.file}. A mutation must name one. Update scripts/falsify.ts.`,
    );
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
    const n = matched.get(m.name);
    const several = n && n > 1 ? ` (${n} examples)` : "";
    console.log(`✓ ${m.name}\n    caught by ${kind} "${target}"${several}`);
  }
}

// The suite must be green again now that every mutation is reverted.
const localEnv = { ...process.env, HARNESS: "local" };
Bun.spawnSync([...BDDGEN, "--tags", "@local"], { env: localEnv });
const restored = Bun.spawnSync([...RUNNER], { env: localEnv });
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
