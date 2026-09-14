// Proves the scenarios have teeth.
//
// A scenario that has only ever been green is not evidence. Each mutation
// below breaks one specific behaviour and names the one scenario that must
// go red because of it. If a mutation is applied and everything still passes,
// that scenario is decoration and should be fixed or deleted.
//
//   bun run falsify                  # the @local mutations
//   FALSIFY_LIVE=1 bun run falsify   # and the ones that need the real store
//   bun run falsify --only <text>    # the mutations whose name contains <text>
//
// `--only` narrows and never widens: a @live mutation it names is still skipped
// unless FALSIFY_LIVE is set. It exists so that a claim about a handful of
// mutations can be MEASURED without running all of them - `PLAN.md` said nine
// came back at step 1, and eight of the nine are @live, so the command in the
// checklist skipped every one of them and the claim rested on the array having
// grown.
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
    find: "    } catch (err) {\n      e.lastError = err instanceof Error",
    replace: "    } catch (err) {\n      e.value = null;\n      e.lastError = err instanceof Error",
    scenario: "A running server keeps serving the last build it read",
  },
  {
    name: "stale-while-revalidate is removed",
    file: "src/server/manifest.ts",
    find: "      if (e.value) return e.value;\n",
    replace: "",
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
    // query string, counted as visitors, reads as an old unit still in use
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
    // is separated where a real history and a real override are involved.
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

  // --- §3, the second region ----------------------------------------------

  {
    // The whole item. A promote that writes one region leaves every other
    // region serving what it served before - correctly, from what that machine
    // can see, which is why nothing else catches it.
    name: "a promote writes one region and leaves the rest",
    file: "scripts/promote.ts",
    find: "for (const r of regions) {\n  const historyKey =",
    replace: "for (const r of regions.slice(0, 1)) {\n  const historyKey =",
    scenario: "One promote points every region at the same composition",
    live: true,
  },
  {
    // The scenario had no mutation until 2026-09-10, so it had only ever been
    // green. With every machine resolving one region, the machine reached
    // through iad reports eu, the harness's wake loop never sees us, and the
    // step fails on the reading rather than on the wait.
    name: "every machine reads one region's manifest",
    file: "src/server/origins.ts",
    find: '  const region = FLY_TO_REGION[flyRegion ?? ""];',
    replace: '  const region = FLY_TO_REGION["ams"];',
    scenario: "Each region's machine reads its own region's manifest",
    live: true,
  },
  {
    // Flattening a difference nobody asked to flatten. The merge reads one
    // region, so the other is overwritten with a composition nobody chose.
    name: "a promote flattens a difference between the regions",
    file: "scripts/promote.ts",
    find: "if (drift !== null) {",
    replace: "if (false) {",
    scenario: "A promote refuses to flatten a difference between the regions",
    live: true,
  },
  {
    name: "--region is ignored and every region is written",
    file: "scripts/regions.ts",
    find: "  if (i === -1) return { regions: [...REGIONS] };",
    replace: "  return { regions: [...REGIONS] };\n  if (i === -1) return { regions: [...REGIONS] };",
    scenario: "Naming one region writes that region and no other",
    live: true,
  },
  {
    // The sweep reading one region would see the other region's pointers as
    // naming nothing, and delete the units a machine there is serving.
    name: "a reader looks at one region's manifests",
    file: "scripts/regions.ts",
    find: "  return REGIONS.flatMap((region) =>",
    replace: "  return [REGIONS[0]!].flatMap((region) =>",
    unitTest: "covers every region, not only the one this machine is in",
  },
  {
    name: "an unknown region is ignored rather than refused",
    file: "scripts/regions.ts",
    find: "  if (!(REGIONS as readonly string[]).includes(named)) {",
    replace: "  if (false) {",
    unitTest: "a region that does not exist is refused, not ignored",
  },
  {
    name: "two regions that differ are read as agreeing",
    file: "scripts/regions.ts",
    find: "    if (differing.length === 0) continue;",
    replace: "    continue;",
    unitTest: "two compositions that differ stop the promote and name the units",
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
    // is deliberately keeping - an override stops reaching something whose
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
    // The merge IS the feature. Without it every promote replaces the whole
    // composition, and "deploy list" silently rolls the frame back to whatever
    // the operator last had on disk. With ONE unit a merge and a replace write
    // identical bytes, which is why this had nothing to hold it at step 0.
    // The mutation drops a CARRIED SUB-APP from the manifests a promote reads,
    // so the scenario it names has to be one in which a sub-app is carried.
    // "Deploying a sub-app leaves the frame where it was" is not: there the
    // sub-app is the unit being named and the SHELL is what is carried, so the
    // mutation was a no-op and the scenario could never have gone red for it.
    // Measured on 2026-09-11 with FALSIFY_LIVE=1 - which is why nobody had seen
    // it: this mutation is @live, `bun run falsify` skips every @live mutation,
    // and the entry had been in the array since step 1 proving nothing.
    name: "promote replaces the composition instead of merging into it",
    file: "scripts/promote.ts",
    find: "  const kept = unit === \"shell\" ? current!.shell : current!.apps[unit]!;",
    replace:
      "  const kept = unit === \"shell\" ? current!.shell : current!.apps[unit]!;\n" +
      "  if (unit !== \"shell\") { continue; }",
    scenario: "Deploying the frame leaves the sub-app at its new version",
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
    find: 'if (held === undefined) problems.push(`${name} uses ${path}, which this shell does not have`);',
    replace: 'if (false) problems.push(`${name} uses ${path}, which this shell does not have`);',
    scenario: "A sub-app needing a member the shell does not have is refused",
    live: true,
  },
  {
    // A unit id that carried the commit would change on every commit, so one
    // change to one unit would republish every unit and the independence would
    // only exist in the pointer.
    name: "the unit id carries the commit",
    file: "build.ts",
    find: "  new Bun.CryptoHasher(\"sha256\").update(JSON.stringify([...files].sort())).digest(\"hex\").slice(0, 8);",
    replace:
      "  new Bun.CryptoHasher(\"sha256\")\n" +
      "    .update(JSON.stringify([...files].sort()) + String(Bun.env.FALSIFY_COMMIT ?? Date.now()))\n" +
      "    .digest(\"hex\")\n" +
      "    .slice(0, 8);",
    scenario: "Publishing after a change to one unit uploads that unit alone",
    live: true,
  },
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
    // §11, at the boundary a visitor crosses: asking for a shell this image
    // cannot feed must be refused, not rendered.
    name: "a shell this server cannot feed is served anyway",
    file: "src/server/composition.ts",
    find: "if (typeof blocks === \"string\") return blocks;",
    replace: "if (false) return blocks;",
    scenario: "A shell this server cannot feed is refused",
    live: true,
  },
  {
    // §11. Renaming a field of the server-to-shell blocks is exactly what broke
    // shell 606c1c3c on 2026-08-28. Nothing covered it then.
    name: "a block field is renamed",
    file: "src/server/blocks.ts",
    find: "  channel: string;",
    replace: "  chanel: string;",
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
  // A query string lets an operator compose the page themselves, so its guards
  // are about what it must REFUSE, and about the record it composes from.

  {
    // Without this the query string is a way to make this origin serve any
    // object in the store, named by whoever crafts the link.
    name: "any unit id may be asked for, not only ones the channel served",
    file: "src/server/composition.ts",
    find: "    if (!known) return `the ${unit} unit ${id} is not one this channel can serve`;",
    replace: "    if (false) return `the ${unit} unit ${id} is not one this channel can serve`;",
    scenario: "An id the channel has never served is refused",
    live: true,
  },
  {
    // An override must never cost a visitor a wait. A manifest is worth
    // waiting for on a cold cache, because without one there is no page; the
    // history is not, because without it the page is the one the channel
    // points at.
    name: "a cold version history makes the visitor wait for the store",
    file: "src/server/index.ts",
    find: "      const channelHistory = histories.peek(historyUrl(MANIFEST_BASE, target.region, target.channel));",
    replace: "      const channelHistory = await histories.get(historyUrl(MANIFEST_BASE, target.region, target.channel));",
    scenario: "A visitor is never made to wait for the store",
  },
  // --- a pull request's preview, §30 ---------------------------------------
  //
  // One predicate decides what a channel takes from the catalogue that it has
  // never served. Every mutation here loosens or tightens it by one step.

  {
    // The rule this replaced was `allowMarked`, a boolean, and this is what it
    // would collapse back to on a real channel.
    name: "qa admits every marker",
    file: "src/server/origins.ts",
    find: '  if (channel === "qa") return (marker) => marker === "" || PREVIEW.test(marker);',
    replace: '  if (channel === "qa") return () => true;',
    scenario: "A marker qa does not admit is refused",
  },
  {
    // And the other way. A channel that takes no marker at all has no preview,
    // which is the state this item started from.
    name: "qa admits no marker",
    file: "src/server/origins.ts",
    find: '  if (channel === "qa") return (marker) => marker === "" || PREVIEW.test(marker);',
    replace: '  if (channel === "qa") return (marker) => marker === "";',
    scenario: "A build a pull request made can be asked for on qa",
  },
  {
    // The fallthrough is the strict one on purpose, so a channel added later
    // has to be named to get anything looser. This gives prod qa's rule.
    name: "every real channel gets qa's rule",
    file: "src/server/origins.ts",
    find: '  return (marker) => marker === "";\n}',
    replace: '  return (marker) => marker === "" || PREVIEW.test(marker);\n}',
    scenario: "prod takes no marker at all, a pull request's included",
  },
  {
    // A marker is matched whole or not at all. Unanchored at the front, a unit
    // marked by anything ending in a pull request's marker gets in.
    name: "the preview pattern matches a marker's tail",
    file: "src/server/origins.ts",
    find: "const PREVIEW = /^pr-\\d+$/;",
    replace: "const PREVIEW = /pr-\\d+$/;",
    scenario: "A marker with something in front of a pull request's is refused",
  },
  {
    name: "the preview pattern matches a marker's head",
    file: "src/server/origins.ts",
    find: "const PREVIEW = /^pr-\\d+$/;",
    replace: "const PREVIEW = /^pr-\\d+/;",
    scenario: "A marker with something after a pull request's is refused",
  },
  {
    // The policy is built and then ignored: `mergeKnown` takes every catalogue
    // entry whatever its marker. Nothing above this line can catch that,
    // because every one of them mutates the predicate rather than its use.
    name: "the marker policy is never consulted",
    file: "src/server/composition.ts",
    find: '        (e) => !already.has(e.unit.unitId) && admits(e.unit.marker ?? ""),',
    replace: "        (e) => !already.has(e.unit.unitId),",
    scenario: "A marker qa does not admit is refused",
  },
  {
    // Without the rebuild, the catalogue is whatever the last publish that
    // happened to write it left behind, and a unit published after it is
    // findable only by listing the bucket by hand.
    name: "publish does not record what it published",
    file: "scripts/publish.ts",
    find: "  const built = await rebuildCatalogue(cfg, previous);",
    replace: "  const built = { catalogue: previous ?? { schema: 1 as const, updatedAt: \"\", units: {} }, scanned: 0, reused: 0, marked: 0, unreadable: 0 };",
    scenario: "Publishing a unit records it where a promote can find it",
    live: true,
  },
  {
    // An override limited to what the channel has served cannot reach a build
    // before it is deployed, which is the one thing an operator wants of it.
    name: "an override forgets every build the channel never served",
    file: "src/server/composition.ts",
    find: "  if (catalogue === null) return history;",
    replace: "  if (catalogue !== null || catalogue === null) return history;",
    scenario: "A build that was published and never promoted can be asked for",
    live: true,
  },
  {
    // A rebuild that re-reads everything is correct and costs a publish 129
    // round trips instead of the five it wrote.
    name: "a rebuild re-reads every unit in the store",
    file: "scripts/catalogue.ts",
    find: "    if (kept && kept.recordedAt === o.lastModified) {",
    replace: "    if (false && kept) {",
    scenario: "A rebuild re-reads only the units whose record moved",
    live: true,
  },
  {
    // The catalogue is read on the same request and carries the same rule. It
    // is worth less to a visitor than the history is, because a visitor who
    // never asks for an override never looks at it.
    name: "a cold unit catalogue makes the visitor wait for the store",
    file: "src/server/index.ts",
    find: "              catalogues.peek(CATALOGUE_URL),",
    replace: "              await catalogues.get(CATALOGUE_URL),",
    // Not "A visitor is never made to wait for the store", which this could not
    // turn red for two reasons at once: the local stub 404'd the catalogue
    // before it applied its delay, and no local channel had a history, so the
    // line was never reached. Both are fixed, and the scenario below is the one
    // that reaches it. TODO §28.
    scenario: "A visitor whose channel has a history is not made to wait for the catalogue",
  },
  {
    // A history that kept only what is live would leave an override with one
    // id to name, which is the id already being served.
    name: "a channel's history keeps only what it serves now",
    file: "scripts/promote.ts",
    find: "    ].slice(0, HISTORY_DEPTH);",
    replace: "    ].slice(0, 1);",
    scenario: "Asking for an older unit serves it and moves no channel",
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
    scenario: "Bundles resolved through one import map are still one application",
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
    // it. The shared chunks that entry imports resolve through the import map,
    // so the map's own `integrity` block is the only place their digests can be
    // declared - and a page with none renders exactly like one with them.
    //
    // Kept aimed at the @local scenario rather than at the @browser Outline it
    // was named against before `PLAN.md` step 0, so `bun run falsify` runs it
    // on every run rather than reporting it skipped.
    name: "the import map stops carrying digests",
    file: "src/server/html.ts",
    find: "  const integrity = moduleIntegrity(m);",
    replace: "  const integrity: Record<string, string> = {};",
    scenario: "A shell names the digest of every file it tells the browser to fetch",
  },
  {
    // The other mechanism, and it has a subject again at step 1. A stylesheet
    // never resolves through the import map, so its digest has to reach the
    // loader on the app list instead - and a panel whose stylesheet is fetched
    // with no digest renders unstyled rather than being refused.
    name: "a sub-app's stylesheet digest never reaches the loader",
    file: "src/server/html.ts",
    find: "        const digest = a.css ? a.integrity?.[a.css] : undefined;",
    replace: "        const digest: string | undefined = undefined;",
    scenario: "A sub-app whose <file> does not match its digest does not run",
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
    scenario: "The page assembles from its own bundles under its own policy",
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
    scenario: "The page assembles from its own bundles under its own policy",
    live: true,
    browser: true,
  },
  {
    // The trap this pays for once: a cross-origin file carrying a digest is
    // REFUSED rather than checked unless it is fetched with CORS. The page
    // then renders unstyled, and every other check stays green.
    name: "a digest is attached without the CORS needed to check it",
    file: "src/server/html.ts",
    find: 'digest ? ` integrity="${attr(digest)}" crossorigin="anonymous"` : "";',
    replace: 'digest ? ` integrity="${attr(digest)}"` : "";',
    scenario: "The page assembles from its own bundles under its own policy",
    live: true,
    browser: true,
  },
  {
    name: "the shell is served with no content policy",
    file: "src/server/html.ts",
    find: '      "content-security-policy": contentSecurityPolicy(m, apiBase),',
    replace: "      // (no policy)",
    scenario: "A shell names the only origins its files may come from",
  },
  {
    // What was live until 2026-08-31: the policy was built from the manifest
    // alone, so a server that told the page where the service is forbade it in
    // the same breath. Every unit test passed.
    name: "the policy is built without the service the page is told to call",
    file: "src/server/html.ts",
    find: '      "content-security-policy": contentSecurityPolicy(m, apiBase),',
    replace: '      "content-security-policy": contentSecurityPolicy(m),',
    scenario: "A server that names a service permits the page to reach it",
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
    scenario: "A sub-app that throws costs its panel and not the frame",
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

  // --- the shared store -----------------------------------------------------
  //
  // Section 19. `shared-state.feature` is gone and does not come back: every
  // scenario in it was the frame and a separately deployed panel agreeing about
  // a greeting, and the greeting is gone with `PLAN.md` step 0. The same claim
  // is now made about the thing the application is actually for, in
  // `keeping-a-list-of-tasks.feature`, and the `peek` mutations below are aimed
  // at it - one at the accessor the FRAME reads, one at the accessor the PANEL
  // reads. TODO §31 carries what still needs a second sub-app.

  // --- warming a sub-app's files -------------------------------------------
  //
  // `PLAN.md` step 4 put `board` on `/board`, so there is a unit off the
  // landing route and the warm has something to buy. Both mutations below take
  // the tags away; they are separate entries because they name different
  // readings of one removal, and the second is the one that would otherwise
  // look like an unrelated scenario going red.

  {
    // Every hint gone. The page still works: the import at the navigation
    // fetches what it needs, a few hundred milliseconds later than it had to.
    // That is the whole cost, and the reading that sees it is the resource
    // timing on the landing view, where there is now nothing to see.
    name: "the page warms nothing at all",
    file: "src/server/html.ts",
    find: "  return tags.map((t) => `\\n    ${t}`).join(\"\");",
    replace: "  return \"\";",
    scenario: "The board's files are in the browser before the board is opened",
    live: true,
    browser: true,
  },
  {
    // The same removal, aimed at the count. `Moving between views draws each
    // one and fetches nothing` read as a statement about views that place no
    // unit until step 4; with `board` on `/board` the walk opens one that does,
    // and the count stays at zero only because the files were already warm.
    // Measured on 2026-09-11: 0 requests across the walk with the tags, and the
    // scenario is what says what that costs without them.
    name: "the page warms nothing, and the walk pays for it",
    file: "src/server/html.ts",
    find: "  return tags.map((t) => `\\n    ${t}`).join(\"\");",
    replace: "  return \"\";",
    scenario: "Moving between views draws each one and fetches nothing",
    live: true,
    browser: true,
  },

  // --- what the service says it holds, §26 ---------------------------------

  {
    // The document keeps saying the field is going away and every response
    // carrying it goes quiet. A page reading only the document is unaffected,
    // which is exactly why a scenario has to read the headers.
    name: "a response carrying a retired field says nothing about it",
    file: "api/service.ts",
    find: "  const going = (top: string) => deprecationHeaders(deprecationsFor(top), url.origin);",
    replace: "  const going = (_top: string): Record<string, string> => ({});",
    scenario: "The two headers, on the responses that carry the field",
  },
  {
    // The other half. The headers still warn and the document describes a
    // service where nothing is going away, so every panel that reads the
    // document - which is all five - shows a field that is not being retired.
    name: "the document leaves the retirement off the field",
    file: "api/service.ts",
    // The indentation moved at `PLAN.md` step 6: `versionBody` was lifted out of
    // `discovery` so that `GET /<version>` and the discovery document read one
    // description of a version rather than two.
    find: "      const going = deprecated.find((d) => d.path === f.path);",
    replace: "      const going = deprecated.find(() => false);",
    scenario: "A retired field is named in the document, with the day it goes",
  },
  {
    // A typed field name is accepted and published to every page as a
    // deprecation of something the service does not have. Nothing fails, and
    // the field the operator meant goes on being served with no warning at all.
    name: "a retirement of a field the service does not answer is accepted",
    file: "api/service.ts",
    find: "    if (!known.includes(path)) {",
    replace: "    if (false) {",
    scenario: "A retirement naming a field the service does not answer stops it",
  },

  // --- what the service offers, §27 ----------------------------------------


  // --- a view that names no unit, PLAN.md step 0 ---------------------------
  //
  // Two halves, and each needs its own mutation. "The frame draws it" is about
  // the route resolving to the view a visitor asked for; "nothing is fetched
  // for it" is about the page naming nothing to fetch and the walk between
  // views costing no request.
  //
  // What CANNOT be falsified here, and it is worth being plain about: with no
  // unit in the tree there is no bundle a mutation could make the page fetch,
  // so the unit-level half of "nothing is fetched" is structural rather than
  // measured. It gets its teeth back at step 1, when `/service` and `/backup`
  // still have to fetch nothing while `/` fetches `list`.

  {
    // The tag the loader reads to decide what to import, dropped. The page
    // still answers 200, still names the right build, and imports nothing.
    name: "the page carries no sub-app list at all",
    file: "src/server/html.ts",
    find: "  const appsTag = Object.keys(apps).length",
    replace: "  const appsTag = 0",
    scenario: "The page names the units its views place, and no others",
  },
  {
    // The other direction, and the one `PLAN.md` step 0 could not aim at
    // anything: a page carrying an EMPTY sub-app list where the composition has
    // none. Harmless looking, and it is the difference between "this
    // composition has no sub-app" and "its sub-apps could not be read". A unit
    // test, because no channel serves such a composition now that `/` places
    // `list` - it is the shape the deployed image has to keep accepting.
    name: "the page carries a sub-app list when there are no sub-apps",
    file: "src/server/html.ts",
    find: "  const appsTag = Object.keys(apps).length",
    replace: "  const appsTag = 1",
    unitTest: "no sub-app list is carried at all",
  },
  {
    // §17's machinery is real, so a warm aimed at the wrong thing is a
    // plausible edit. It costs a fetch of a file no view placed, which is what
    // the four views naming no unit must never cause.
    name: "the page warms a file no view placed",
    file: "src/server/html.ts",
    find: "  for (const app of Object.values(appUrls(m))) {",
    replace: "  for (const app of [...Object.values(appUrls(m)), { js: assetUrls(m).js }]) {",
    scenario: "The page warms exactly the units its views place",
  },
  {
    // The guard `PLAN.md` step 0 removed, put back. A composition of the shell
    // alone is a legitimate shape - it is what step 0 served - and a server
    // that refuses it answers 503 to every visitor in a region, which is what
    // it did on 2026-09-10. A unit test, because no channel serves that shape
    // now that `/` places `list`; TODO §36 is the item.
    name: "a composition naming no sub-app is refused",
    file: "src/server/manifest.ts",
    find: "  const shell = parseComposedUnit(\"shell\", m.shell);",
    replace:
      "  if (Object.keys(apps).length === 0) throw new Error(\"manifest names no apps\");\n" +
      "  const shell = parseComposedUnit(\"shell\", m.shell);",
    unitTest: "accepts a composition naming no apps, and still refuses one with no shell",
  },
  {
    // The router pushing the URL and forgetting to tell the view. The address
    // bar moves, the sidenav marks the link it was given, and the frame goes on
    // drawing the landing view - a page that looks entirely correct until you
    // read the heading.
    //
    // NOT `const path = DEFAULT_ROUTE` in Shell.tsx, which was tried first: it
    // narrows `path` to the literal "/", so `path === "/service"` stops
    // compiling and `bun run build` fails inside the scenario's Background.
    // The scenario does go red, and for a reason that has nothing to do with
    // its quality - see TODO §35.
    name: "the router moves the URL and not the view",
    file: "src/web/shell/router.ts",
    find: '  history.pushState(null, "", path);\n  route.value = path;',
    replace: '  history.pushState(null, "", path);',
    scenario: "Moving between views draws each one and fetches nothing",
    live: true,
    browser: true,
  },
  {
    // "Nothing is fetched for it", falsified. A link that navigates instead of
    // routing draws every view correctly and fetches the whole frame again to
    // do it - which is a page that works and a claim that does not.
    name: "a sidenav link navigates instead of routing",
    file: "src/web/shell/router.ts",
    find: '  history.pushState(null, "", path);',
    replace: "  location.assign(path);",
    scenario: "Moving between views draws each one and fetches nothing",
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

  // --- the boot prime ------------------------------------------------------

  {
    // The two documents an override is judged against are `peek`ed on the
    // request path, so a process that has read neither refuses every id it is
    // asked for. Only a scenario that restarts the server can see it: every
    // other one has already made a request.
    name: "the channel history is not read at boot",
    file: "src/server/index.ts",
    find: "  primed.push(histories.prime(historyUrl(MANIFEST_BASE, REGION, channel)));",
    replace: "",
    scenario: "The first visitor to a machine that has just started can still ask",
    live: true,
  },
  {
    // Observed red before the wait was added. The reads all start, and the
    // request that woke the machine beats them, so the page it gets is the one
    // a process that has read nothing renders.
    name: "the boot reads are started and not waited for",
    file: "src/server/index.ts",
    find: "await Promise.all(primed);",
    replace: "void Promise.all(primed);",
    scenario: "The first visitor to a machine that has just started can still ask",
    live: true,
  },
  {
    // What separates `prime` from a bare `get`. A boot read that failed and
    // was remembered reads as fresh-and-empty, and every request for a whole
    // TTL is then refused without one attempt of its own.
    name: "a failed prime is remembered",
    file: "src/server/manifest.ts",
    find: "      if (e.value === null) e.checkedAt = before;",
    replace: "",
    unitTest: "a prime that found nothing leaves the entry blank",
  },
  {
    // The store is a signal the SHELL's bundle created, and every reader of it
    // subscribes by reading `.value`. `peek` reads without subscribing, so a
    // view keeps drawing what it drew when it mounted.
    //
    // The FRAME's own reading of its own store: `index.tsx` renders "unread"
    // before the read is started, so a `/service` that ever says "ok" can only
    // have got there through the store after the first paint. The panel's half
    // of the same claim is the mutation below.
    name: "an accessor reads the store without subscribing to it",
    file: "src/web/shell/api.ts",
    find: "    service: () => service.value,",
    replace: "    service: () => service.peek(),",
    scenario: "The frame redraws when the reading it took of the service arrives",
    live: true,
    browser: true,
  },
  {
    // Appending and replacing write the same list while there is one task in
    // it, which is every scenario's first step. The second task separates them.
    name: "adding a task replaces the list instead of appending to it",
    file: "src/web/shell/api.ts",
    find: "      tasks.value = [...tasks.value, task];",
    replace: "      tasks.value = [task];",
    unitTest: "a second task joins the first rather than replacing it",
  },
  {
    // Tags written onto every task rather than onto the one named. A scenario
    // with one task on the list cannot see it, which is why the feature file
    // has a second one on the list while it tags the first.
    name: "tags land on every task rather than on the one named",
    file: "src/web/shell/api.ts",
    find: "      tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, tags: [...tags] } : t));",
    replace: "      tasks.value = tasks.value.map((t) => ({ ...t, tags: [...tags] }));",
    unitTest: "tags land on the task they name, and on no other",
  },
  {
    // The other side of the same line: a removal that takes every task rather
    // than the one named.
    name: "removing a task empties the list",
    file: "src/web/shell/api.ts",
    find: "      tasks.value = tasks.value.filter((t) => t.id !== id);",
    replace: "      tasks.value = [];",
    unitTest: "removing a task takes that task and leaves the rest",
  },
  {
    // The same reading as the one above, on the accessor a SUB-APP calls, and
    // the whole shared-runtime claim in one line. `peek` reads the signal
    // without subscribing, so the panel goes on drawing what it drew when it
    // mounted - which is exactly what a sub-app carrying its own signals
    // runtime would do. The scenario's Background builds and promotes from this
    // tree, so the edit reaches the bundle under test.
    //
    // REMOVAL, not addition, and that took measuring. This named "A task added
    // through the panel is drawn by the list" until 2026-09-11 and stayed green
    // under `peek`: `add` calls `setTitle("")` in the same handler, so the panel
    // re-renders from its OWN state whether or not it subscribed to the store,
    // and reads the new task on the way through. Removing is the one write in
    // this panel with no local state change beside it, so it is the only one
    // where a lost subscription is visible. The adding scenario is not wrong -
    // it says the write reaches the frame - it just cannot say this.
    name: "the task accessor reads the store without subscribing to it",
    file: "src/web/shell/api.ts",
    find: "    tasks: () => tasks.value,",
    replace: "    tasks: () => tasks.peek(),",
    scenario: "A task taken off the list leaves, and the rest stay",
    live: true,
    browser: true,
  },
  {
    // The defect this mutation restores shipped, and was green: the tag input
    // drew its value straight from the store, so a comma round-tripped through
    // `tagsFrom` and Preact wrote the text back without it. `page.fill` sets the
    // whole string in one event and cannot see it; only a scenario that types
    // one key at a time can, which is what the two tagging scenarios now do.
    // Aimed at the WRITE and not at the `value`, because cutting the `value`
    // expression leaves `drafts` unused and `noUnusedLocals` fails the build -
    // which §35's guard correctly refuses to read as a caught mutation. Stopping
    // the draft from being recorded gives the same behaviour and compiles: the
    // box falls back to the store on every keystroke, exactly as it shipped.
    name: "the tag box is drawn from the store between keystrokes",
    file: "src/web/apps/list/index.tsx",
    find: "                  setDrafts((d) => ({ ...d, [task.id]: text }));",
    replace: "                  setDrafts((d) => ({ ...d }));",
    scenario: "A second tag is typed onto a task that already has one",
    live: true,
    browser: true,
  },
  // --- `PLAN.md` step 2, the planner in IndexedDB ----------------------------
  //
  // All six are `@browser`, because there is no other kind of visitor of a
  // database in a browser. `bun run falsify` reports them as skipped and
  // `FALSIFY_LIVE=1 bun run falsify` runs them - which is the distinction step
  // 1 got wrong by counting the array instead of the run.

  {
    // The whole of step 2 in one cut. `write` is still called and still
    // resolves, so `pending` clears and nothing on the page reports a failure;
    // the tasks simply are not there on the next visit.
    name: "the planner is never written",
    file: "src/web/shell/planner.ts",
    find: "      for (const task of tasks) store.put(task);",
    replace: "      for (const task of tasks) void task;",
    scenario: "A task is still there after a reload",
    live: true,
    browser: true,
  },
  {
    // Read and discarded. The database is correct throughout and the page
    // starts empty every time, which is exactly what step 1 did - so this is
    // the mutation that says step 2 happened at all.
    name: "the planner is read and the tasks are dropped",
    file: "src/web/shell/index.tsx",
    find: "    store.loadTasks(await planner.read());",
    replace: "    await planner.read();",
    scenario: "The order the tasks were added in survives a reload",
    live: true,
    browser: true,
  },
  {
    // A write that adds and never removes. Every task ever typed comes back on
    // the next visit, including the ones taken off the list, and no scenario
    // that only ADDS can see it.
    name: "the write adds to the database instead of replacing it",
    file: "src/web/shell/planner.ts",
    find: "      store.clear();",
    replace: "      void store;",
    scenario: "A task taken off the list stays off after a reload",
    live: true,
    browser: true,
  },
  {
    // The first paint says the planner is empty before it has been read. Every
    // finished page is correct, so this is caught only by the observer that
    // records the state at the moment the message appears.
    name: "the empty message is drawn before the planner has been read",
    file: "src/web/apps/list/index.tsx",
    find: '      {planner.state === "unread" ? (',
    replace: "      {false ? (",
    scenario: "The empty message waits for the planner to be read",
    live: true,
    browser: true,
  },
  {
    // The page promises storage it does not have. A browser that refuses
    // IndexedDB still works, so the only thing wrong is the sentence - which is
    // the reason that sentence is a scenario.
    name: "the panel claims the planner is stored whatever the frame reports",
    file: "src/web/apps/list/index.tsx",
    find: '          {planner.state === "stored"',
    replace: "          {true",
    scenario: "The panel says the planner is not being stored",
    live: true,
    browser: true,
  },
  {
    // The version in `meta` stops describing the database it is in. Nothing a
    // visitor does goes wrong today; `PLAN.md` step 14 reads this field to
    // decide whether to migrate, and it would read a lie.
    name: "the database records a schema version it was not written at",
    file: "src/web/shell/planner.ts",
    find: "export const SCHEMA_VERSION = 1;",
    replace: "export const SCHEMA_VERSION = 2;",
    scenario: "The database records the schema version it was written at",
    live: true,
    browser: true,
  },

  // --- `PLAN.md` step 3, the planner as one file ----------------------------
  //
  // Nine of the sixteen are @local, which is the difference from step 2. Every
  // rule about what a DOCUMENT is holds in a pure function, so
  // `bun run falsify` - the command in the checklist - runs nine of these on
  // every run rather than reporting all sixteen as skipped. The seven that need
  // a browser are the ones about the page and the transaction: a file written
  // to disk, a file chosen from disk, a view drawn before the planner is read,
  // and a write the database gives up on.

  {
    // A file from another application is read as a planner. `schemaVersion` and
    // the tasks still have to be right, so a document that happens to look like
    // one is accepted whole and the name on it means nothing.
    name: "the format field is not read",
    file: "src/web/shell/document.ts",
    find: "  if (value.format !== DOCUMENT_FORMAT) {",
    replace: "  if (false) {",
    unitTest: "a file naming another format is refused, and both names are given",
  },
  {
    // What a rollback produces, let in. The shell reads a document written to
    // rules it does not have and writes whatever it can make of it into the
    // planner, which is the one thing `PLAN.md`'s table forbids at every door.
    name: "a file a newer shell wrote is read anyway",
    file: "src/web/shell/document.ts",
    find: "  if (version > schemaVersion) {",
    replace: "  if (false) {",
    unitTest: "a file a newer shell wrote is refused, and both versions are named",
  },
  {
    // The other side of the same table, and the one that is not obviously
    // wrong: an older document IS meant to be migrated forward. Nothing
    // migrates one until `PLAN.md` step 14, so accepting it silently is
    // accepting a document at a schema this shell never wrote.
    name: "a file an older shell wrote is read with no migration",
    file: "src/web/shell/document.ts",
    find: "  if (version < schemaVersion) {",
    replace: "  if (false) {",
    unitTest: "a file an older shell wrote is refused while nothing migrates it",
  },
  {
    // A task the file got wrong vanishes instead of stopping the import. The
    // planner is then a SUBSET of the file, the page says every task was
    // replaced, and nothing anywhere says one was lost.
    name: "a task the file got wrong is dropped rather than refused",
    file: "src/web/shell/document.ts",
    find: '    if (typeof read === "string") return refuse(read);',
    replace: '    if (typeof read === "string") continue;',
    unitTest: "a task with no title is refused, and the field is named",
  },
  {
    // The rebuild removed. A field this schema does not have reaches IndexedDB,
    // comes back out of the next export, and is carried by a planner no version
    // describes - and every check passes on the way through.
    name: "an imported task is stored as the file wrote it",
    file: "src/web/shell/document.ts",
    find: `  return {
    id: value.id as string,
    title: value.title as string,
    column: value.column as string,
    due: value.due as string | null,
    tags: [...(value.tags as string[])],
    createdAt: value.createdAt as string,
  };`,
    replace: "  return value as unknown as Task;",
    unitTest: "a field this schema does not have is dropped rather than stored",
  },
  {
    // Every refusal names the first task. The rule still holds and the file is
    // still refused; what is lost is the only thing that makes the sentence
    // useful, which is where in a file of forty tasks to look.
    name: "the refusal names the first task whatever went wrong",
    file: "src/web/shell/document.ts",
    find: "    const read = readTask(held, `tasks[${index}]`, columns);",
    replace: "    const read = readTask(held, `tasks[${index * 0}]`, columns);",
    unitTest: "the refusal names the task that stopped it and not the first one",
  },
  {
    // The document hands out the store's own task objects. Nothing on the page
    // goes wrong today; step 6 pushes this same document to a service, and a
    // caller that held one would be holding the planner.
    name: "the document holds the store's own task objects",
    file: "src/web/shell/document.ts",
    find: "    tasks: tasks.map((t) => ({ ...t, tags: [...t.tags] })),",
    replace: "    tasks,",
    unitTest: "the tags are copied rather than held",
  },

  {
    // The id stops being read. Every other field is still checked, so a file is
    // still refused for a missing title - and the rule the `tx.abort()` guard
    // in `planner.ts` rests on is gone: a task with no id reaches
    // `IDBObjectStore.put`, which is keyed on it.
    name: "a task with no id is read as a task",
    file: "src/web/shell/document.ts",
    find: '  for (const field of ["id", "title", "column", "createdAt"] as const) {',
    replace: '  for (const field of ["title", "column", "createdAt"] as const) {',
    unitTest: "a task with no id is refused, and the field is named",
  },
  {
    // One id twice, accepted. The page draws both tasks and says every task was
    // replaced; `tasks` is keyed on `id`, so the database holds one. Nothing
    // reports the difference and it only shows on the next visit.
    name: "one id twice is read as two tasks",
    file: "src/web/shell/document.ts",
    find: "    if (first !== undefined) {",
    replace: "    if (false) {",
    unitTest: "two tasks carrying one id are refused, and both places are named",
  },
  {
    // The view counts and exports a planner it has not read. `/backup` is in
    // the shell bundle and is landable directly, so it draws on the first
    // paint, and the file an export writes there is a valid planner holding
    // nothing.
    name: "the backup view counts a planner it has not read",
    file: "src/web/shell/Shell.tsx",
    find: '  const unread = planner.state === "unread";',
    replace: "  const unread = false;",
    scenario: "A cold landing on the backup view neither counts nor exports",
    live: true,
    browser: true,
  },
  {
    // The file is written, downloaded and empty. A scenario that only checked
    // that a download happened would pass, which is why the step reads the
    // bytes off the file the browser kept.
    name: "the exported file holds no tasks",
    file: "src/web/shell/Shell.tsx",
    find: "    const doc = documentFrom(tasks, SCHEMA_VERSION);",
    replace: "    const doc = documentFrom([], SCHEMA_VERSION);",
    scenario: "The exported file holds every task on the list",
    live: true,
    browser: true,
  },
  {
    // A merge, which is the thing `PLAN.md` refuses by name. Every scenario
    // that imports a file holding MORE than the planner had passes under it -
    // only the empty file can tell the two apart.
    name: "an import adds to the planner instead of replacing it",
    file: "src/web/shell/Shell.tsx",
    find: "    if (read.ok) store.loadTasks(read.tasks);",
    replace: "    if (read.ok) store.loadTasks([...store.tasks(), ...read.tasks]);",
    scenario: "Importing a planner with nothing in it empties the list",
    live: true,
    browser: true,
  },
  {
    // The refusal happens and is never said. The planner is correct and the
    // person who chose the file is told nothing at all, which is the failure a
    // page has that a pure function cannot.
    name: "a file that was refused is not said to have been",
    file: "src/web/shell/Shell.tsx",
    find: "    setOutcome(read);",
    replace: "    setOutcome(read.ok ? read : null);",
    scenario: "A file that is not a planner at all is refused",
    live: true,
    browser: true,
  },
  {
    // The planner is emptied before the file has been read at all. Every
    // accepted import still works; a refused one takes the planner with it, and
    // the page goes on saying nothing was changed.
    name: "the planner is emptied before the file has been read",
    file: "src/web/shell/Shell.tsx",
    find: "    const read = readDocument(await file.text(), SCHEMA_VERSION, store.columns());",
    replace:
      "    store.loadTasks([]);\n    const read = readDocument(await file.text(), SCHEMA_VERSION, store.columns());",
    scenario: "A refused file leaves the database as it was",
    live: true,
    browser: true,
  },
  {
    // The clear in a transaction of its own. The write still replaces, and a
    // transaction the database gives up on now rolls back the tasks and NOT the
    // clear - so the planner is neither what it was nor what the file held.
    name: "the clear is not in the transaction the tasks are written in",
    file: "src/web/shell/planner.ts",
    find: "        const store = tx.objectStore(TASKS);\n        store.clear();",
    replace:
      '        const store = tx.objectStore(TASKS);\n' +
      '        db.transaction(TASKS, "readwrite").objectStore(TASKS).clear();',
    scenario: "An import the database gives up on leaves every stored task where it was",
    live: true,
    browser: true,
  },
  {
    // A record the browser refuses as it is queued, left to commit. The clear
    // is already queued and everything after the refusal is not, so the
    // transaction commits an emptier planner than either side wanted.
    name: "a write the browser refuses part-way is left to commit",
    file: "src/web/shell/planner.ts",
    find: "        tx.abort();\n        throw e;",
    replace: "        throw e;",
    scenario: "A record the database refuses leaves every stored task where it was",
    live: true,
    browser: true,
  },

  // --- `PLAN.md` step 6: the service's subject, and the two doors ------------
  //
  // The greeting mutation that stood here went with the greeting. What replaced
  // it is aimed at the same places: what the service will take, what it answers
  // with, and what the page does with the answer.

  {
    // The route a page calls to learn that the version it was BUILT against is
    // answered. Aimed at the match rather than at the branch: cutting the
    // branch leaves `version` read by nothing and the build fails, which §35's
    // guard reports as a check that never ran.
    name: "the version does not answer at its own root",
    file: "api/service.ts",
    find: '  if (rest === "/") {',
    replace: '  if (rest === "/nothing-here") {',
    scenario: "The version answers at its own root, and a version it does not serve does not",
  },
  {
    // A page that has pushed nothing has made no other data request, so without
    // these headers `ServiceReport.headerSunset` is null on every page until
    // somebody presses Push.
    name: "the version's root carries no retirement",
    file: "api/service.ts",
    find: "      deprecationHeaders(deprecationsIn(version), url.origin),",
    replace: "      {},",
    scenario: "The version's own root carries the retirements inside it",
  },
  {
    // A body is written to a bucket on the strength of one unauthenticated
    // request. What the service will take at all is the first thing in front
    // of it.
    name: "the service takes a body that is not an object",
    file: "api/service.ts",
    find: '    if (!body) return refuse("body", "is not a JSON object");\n\n    // Written under the hash',
    replace: "    // Written under the hash",
    scenario: "A body that is not a planner is refused, and nothing is kept",
  },
  {
    // An address that is not a sha256 addresses nothing this service wrote, so
    // refusing it by shape keeps a bucket read off the path of anything a
    // stranger types.
    name: "an address nobody could have been given is looked up anyway",
    file: "api/service.ts",
    find: '    if (!DIGEST.test(digest)) return refuse("digest", "is not a sha256");',
    replace: '    if (false) return refuse("digest", "is not a sha256");',
    scenario: "An address that could not be one is refused before anything is read",
  },
  {
    // The field the shell's pull door reads before it writes anything. Invented
    // here, it tells every browser that a body which was never a planner is
    // one.
    name: "a snapshot is answered with a format it never carried",
    file: "api/service.ts",
    find: '    format: typeof body?.format === "string" ? body.format : "",',
    replace: '    format: "pointer-planner",',
    unitTest: "a body that is not a planner carries no format and no version",
  },
  {
    // The other half of the same reading, and the one a rollback produces.
    name: "a snapshot is answered at this shell's own schema version",
    file: "api/service.ts",
    find: '    schemaVersion: typeof body?.schemaVersion === "number" ? body.schemaVersion : null,',
    replace: "    schemaVersion: 1,",
    unitTest: "a schema version that is not a number is carried as absent",
  },
  {
    // TODO §45, and the reading that makes it more than tidiness: `planner.ts`
    // sorts the restored list by `createdAt` as a string, so a task stamped
    // "yesterday" is drawn where the document put it and somewhere else after
    // the next reload.
    name: "a task may be stamped with something that is not a moment",
    file: "src/web/shell/document.ts",
    find: "  if (!isMoment(value.createdAt as string)) {",
    replace: "  if (false && !isMoment(value.createdAt as string)) {",
    scenario: "A task stamped with something that is not a moment is refused",
    live: true,
    browser: true,
  },
  {
    // The other half of §45. The field was required by the type from step 3 and
    // read by nothing until step 6.
    name: "a document with no stamp is accepted",
    file: "src/web/shell/document.ts",
    find: '  if (typeof value.exportedAt !== "string" || !isMoment(value.exportedAt)) {',
    replace: '  if (false && typeof value.exportedAt !== "string") {',
    scenario: "A file with no stamp on it is refused, and the field is named",
    live: true,
    browser: true,
  },
  {
    // The pull door, trusting the version the snapshot declares instead of the
    // one this shell reads. That is the door `PLAN.md`'s four-doors table says
    // nothing but the shell enforces, and the two v1 fields exist for it.
    name: "the pull door reads a snapshot at whatever version it claims",
    file: "src/web/shell/Shell.tsx",
    find: "      const read = readPlanner(said.document, SCHEMA_VERSION, store.columns());",
    replace:
      "      const read = readPlanner(said.document, Number(said.document.schemaVersion), store.columns());",
    scenario: "A snapshot a newer shell pushed is refused, and both versions are named",
    live: true,
    browser: true,
  },
  {
    // A pull that merged would leave every task that was here, and every other
    // scenario about pulling would pass while it did.
    name: "a pull adds to the planner instead of replacing it",
    file: "src/web/shell/Shell.tsx",
    find: "      if (read.ok) store.loadTasks(read.tasks);\n      setPulled(read);",
    replace: "      if (read.ok) store.loadTasks([...store.tasks(), ...read.tasks]);\n      setPulled(read);",
    scenario: "Pulling replaces every task that was there",
    live: true,
    browser: true,
  },
  {
    // The push button, armed before the planner has been read. What it sends is
    // a valid planner holding nothing, under an address a person may then share
    // as though it were their planner.
    name: "the push door opens before the planner has been read",
    file: "src/web/shell/Shell.tsx",
    find: "            disabled={unread || busy || !client}\n            onClick={push}",
    replace: "            disabled={busy || !client}\n            onClick={push}",
    scenario: "A cold landing on the backup view opens no door at all",
    live: true,
    browser: true,
  },
  {
    // The stamp a pulled document carries. v1 does not answer with the
    // `exportedAt` the pushed document held, so reading that member gets
    // `undefined` and every pull is refused - which is caught by any scenario
    // that pulls successfully.
    name: "a pulled document is stamped with a field the service does not answer",
    file: "src/web/shell/service.ts",
    find: "          exportedAt: said.createdAt,",
    replace: "          exportedAt: said.exportedAt,",
    scenario: "A second browser pulls that address and holds the same tasks",
    live: true,
    browser: true,
  },
  {
    // The service's own sentence, which is what a person can act on: "not
    // found" says the address holds nothing, where a status alone sends them to
    // a table of codes.
    name: "a refusal from the service loses the sentence it carried",
    file: "src/web/shell/service.ts",
    find: '      const named = typeof why?.error === "string" ? `: ${why.error}` : "";',
    replace: '      const named = "";',
    unitTest: "an address the service holds nothing at carries the service's own sentence",
  },

  // --- §34, the record a promote writes -------------------------------------
  //
  // Unit tests, and there is no other option: scripts/ is outside
  // stryker.config.json's mutate scope, and what these break is a decision
  // taken between a pointer write and a file write - no scenario is a visitor
  // of it. Every one of them fails QUIETLY: a record is written either way, and
  // it says something that is not so.

  {
    // The live suite promotes several times per run, so this fills deploys/
    // with records of compositions no visitor was ever served - and each one
    // looks exactly like a real deploy.
    name: "the suite's own channels are archived like real ones",
    file: "scripts/record.ts",
    find: "  return (RECORDED_CHANNELS as readonly string[]).includes(channel);",
    replace: "  return true;",
    unitTest: "the suite's own channels keep no record",
  },
  {
    // Two spellings of one instant would name two directories, and the archive's
    // order is the only thing that says which deploy came last.
    name: "the stamp is taken as written rather than as an instant",
    file: "scripts/record.ts",
    find: '  return new Date(ms).toISOString().replace(/[:.]/g, "-").replace(/-\\d{3}Z$/, "Z");',
    replace: '  return at.replace(/[:.]/g, "-").replace(/-\\d{3}Z$/, "Z");',
    unitTest: "an offset names the same directory as the same instant in UTC",
  },
  {
    // The distinction the record exists for. The pointer bytes hold the whole
    // composition either way, so with this gone nothing anywhere says which
    // unit the operator asked for.
    name: "a unit the merge carried reads as one this promote deployed",
    file: "scripts/record.ts",
    find: '      now === null ? "dropped" : was === null ? "new" : was === now ? "carried" : "moved";',
    replace: '      now === null ? "dropped" : was === null ? "new" : "moved";',
    unitTest: "a unit at the same id was carried, not deployed",
  },
  {
    // The gate the shooter exists for, in the case it was blind to until §34:
    // an operator promoting the ids a channel already serves moves composedAt
    // and moves no id, so on ids alone the page from before that promote is a
    // correct reading of the one after it for as long as the TTL lasts.
    name: "a shot is judged on its ids and not on which promote wrote them",
    file: "scripts/record.ts",
    find: "  return composedAt === null || block.publishedAt === composedAt;",
    replace: "  return true;",
    unitTest: "the same ids promoted again is not the same page",
  },
  {
    // The no-op promote an operator runs to check a channel moves composedAt
    // and moves no id, so the ids alone read a shot of the LATER promote as a
    // picture of this one - and it overwrites the manifest bytes to match.
    name: "the same composition promoted twice reads as one deploy",
    file: "scripts/record.ts",
    find: "  if (serving.composedAt !== null && promote.composedAt !== serving.composedAt) {",
    replace: "  if (false) {",
    unitTest: "the same composition promoted again is a different promote",
  },
  {
    // The reading CHANGELOG.md exists to get right. Four of the five records in
    // deploys/ are promotes that moved nothing, and an archive that lists them
    // as deploys anybody asked for is a false reading of its own source.
    name: "a promote that carried every unit reads as a deploy",
    file: "scripts/record.ts",
    find: '  return Object.values(units).every((u) => stateOf(u) === "carried") ? "no-op" : "moved";',
    replace: '  return "moved";',
    unitTest: "every unit carried is a no-op",
  },
  {
    // The composition a promote writes is the channel's apps AND the tree's
    // units. Reading the tree alone removes a unit it no longer builds from
    // every channel at the next promote of anything - which is the pointer the
    // running image refused on 2026-09-10, and a cold machine answered 503 for
    // a whole region on it.
    name: "a promote composes from what this tree builds and nothing else",
    file: "scripts/record.ts",
    find: "  return [...new Set([...built, ...Object.keys(served)])].filter((u) => !remove.has(u));",
    replace: "  return [...built].filter((u) => !remove.has(u));",
    unitTest: "a unit the tree no longer builds is carried, not dropped",
  },
  {
    // And the other way: a --drop that removes nothing. Removal has to be said
    // AND obeyed, or the flag is a comment and the unit stays on the channel.
    name: "a promote ignores the removal it was asked for",
    file: "scripts/record.ts",
    find: "  const remove = new Set(drop.filter((u) => u !== \"shell\"));",
    replace: "  const remove = new Set<string>();",
    unitTest: "a dropped unit leaves, and only when it is named",
  },
  {
    // A --region run leaves the other region where it was. Reading the regions
    // a record KEPT bytes for, rather than every region the store has, makes
    // the reading vanish for a record with no shots.json - because
    // `promoteRecord` builds `manifests` from the regions it wrote, so the two
    // are identical by construction. That is `prod`, which can never be shot.
    name: "a one-region promote reads as having written every region",
    file: "scripts/record.ts",
    find: "  const others = [...new Set([...Object.keys(kept), ...ALL_REGIONS])]\n    .filter((r) => !written.includes(r))\n    .sort();",
    replace: "  const others = Object.keys(kept)\n    .filter((r) => !written.includes(r))\n    .sort();",
    unitTest: "a one-region promote names the region it did not write",
  },
  {
    // The one line in a record a person wrote. A note that opens with a blank
    // line would be gathered as a blank entry, which is the changelog silently
    // dropping the only sentence saying what a deploy demonstrates.
    name: "the note's first line is taken blank or not",
    file: "scripts/record.ts",
    find: "    if (trimmed) return trimmed;",
    replace: "    return trimmed;",
    unitTest: "a leading blank line is not the first line",
  },
  {
    // The label is prose with a schema; from/unitId are the facts it was
    // derived from. Reading the label is stopping one field short of the
    // argument the whole document rests on.
    name: "a unit's movement is read off the label rather than off its ids",
    file: "scripts/record.ts",
    find: '  return u.from === u.unitId ? "carried" : "moved";',
    replace: '  return "moved";',
    unitTest: "a unit at the same id was carried, whatever the record calls it",
  },
  {
    // shoot writes this line whenever nobody passed --note, so a check that
    // only refused an absent file would pass over every unwritten note there
    // has ever been.
    name: "the placeholder shoot writes counts as a note somebody wrote",
    file: "scripts/record.ts",
    find: "  if (head === NOTE_PLACEHOLDER) {",
    replace: "  if (false) {",
    unitTest: "the placeholder shoot writes is not a first line",
  },

  // --- `PLAN.md` step 4, the board ------------------------------------------
  //
  // Nine entries here and two under "warming a sub-app's files" above make step
  // 4's eleven. FIVE are @local, for the same reason step 3's nine are: what a
  // COLUMN is holds in the store and in the document reader, both pure. Six
  // need a browser - four of them about the panel, and the warming pair. This
  // comment said "five of the eight … the three that need a browser" until a
  // cold read on 2026-09-12 counted the array and found 4 and 4 here; a wrong
  // count beside the array is exactly the failure `PLAN.md` names.

  {
    // Every column draws every task. The board looks busy and is useless: a
    // move changes nothing anybody can see, because the card was already in
    // the column it was moved to.
    name: "every column draws every task",
    file: "src/web/apps/board/index.tsx",
    find: "          const held = tasks.filter((task) => task.column === column.id);",
    replace: "          const held = tasks;",
    scenario: "A task moved to another column leaves the one it was in",
    live: true,
    browser: true,
  },
  {
    // The button writes the column the card is ALREADY in, so a move moves
    // nothing. Caught by the `they move` step's own wait for the card in the
    // target column, which is why the scenario named is one whose FIRST move is
    // the thing being measured.
    //
    // A cold read on 2026-09-12 refuted the comment that stood here. It said
    // the card would appear in the new column because the panel re-rendered
    // from a store that changed nothing - which this panel cannot do, because
    // it holds no state of its own and draws every card off `store.tasks()`.
    // The entry is kept and re-aimed; the persistence claim it used to be
    // pointed at now has a mutation of its own, below.
    name: "a move writes the column the card is already in",
    file: "src/web/apps/board/index.tsx",
    find: "                              onClick={() => store.moveTask(task.id, to.id)}",
    replace: "                              onClick={() => store.moveTask(task.id, column.id)}",
    scenario: "A task moved to another column leaves the one it was in",
    live: true,
    browser: true,
  },
  {
    // Where a task IS never reaches the database. Every scenario that moves a
    // card and reads the board passes - the store holds the move and the panel
    // draws it - and the planner comes back from the next visit with every task
    // in the first column. The one reading that sees it is a reload.
    //
    // Aimed at `planner.ts` rather than at the board, because that is where the
    // claim is: `PLAN.md` step 2 says a sub-app does not know a database exists,
    // so a column that is not kept is the SHELL failing to keep it.
    name: "a task's column is not kept",
    file: "src/web/shell/planner.ts",
    find: "        for (const task of tasks) store.put(task);",
    replace: '        for (const task of tasks) store.put({ ...task, column: "todo" });',
    scenario: "A move is still there after a reload",
    live: true,
    browser: true,
  },
  {
    // The board draws three empty columns while the planner is still being
    // read. A visitor with a full planner is told the board is empty, and then
    // it fills in - which is `PLAN.md` step 2's requirement, on the panel that
    // is fetched last. TODO §41 is the class; the `board` half of it is the
    // reading the warm makes WIDER, because the bundle is already here.
    name: "the board is drawn before the planner has been read",
    file: "src/web/apps/board/index.tsx",
    find: '  if (planner.state === "unread") {',
    // `&& false` rather than `false`, and §35 is why. Cutting the whole
    // condition leaves `planner` read by nothing, `noUnusedLocals` fails the
    // build, and the guard refuses the reading rather than counting it - which
    // is what happened here on 2026-09-11, and to the tag box at step 1. The
    // field is still read and the branch is still dead.
    replace: '  if (planner.state === "unread" && false) {',
    scenario: "The board says it is reading before the planner has been read",
    live: true,
    browser: true,
  },
  {
    // The board draws its three columns and says nothing about a task in none
    // of them. Every count on the page agrees - they are per-column, not a
    // total - so the planner holds a task the board does not draw and no
    // reading anywhere contradicts the page.
    name: "a task the board cannot draw is not reported",
    file: "src/web/apps/board/index.tsx",
    find: "      {unplaced.length > 0 ? (",
    replace: "      {false ? (",
    scenario: "A task in a column the board does not draw is reported",
    live: true,
    browser: true,
  },
  {
    // A move that rewrites every task. With one task on the board - which is
    // where four of the five scenarios in the first Rule start - this is
    // indistinguishable from a move.
    name: "a move puts every task in the column",
    file: "src/web/shell/api.ts",
    find: "      tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, column } : t));",
    replace: "      tasks.value = tasks.value.map((t) => ({ ...t, column }));",
    unitTest: "moving one task leaves every other task where it was",
  },
  {
    // The guard that stops a task reaching a column the board does not draw.
    // Nothing a visitor can click produces one, so this costs nothing today and
    // is the second line if a control ever names a column - `PLAN.md` step 7
    // pulls a planner written by another browser.
    name: "a task is moved to a column the board does not draw",
    file: "src/web/shell/api.ts",
    find: "      if (!isColumn(column)) return;",
    // `if (false) return;` leaves `isColumn` declared and called by nothing, so
    // this mutation would NOT survive `tsc` under `noUnusedLocals`. It is a
    // unit test, and `runUnitTest` runs `bun test` without a build, so it runs
    // and is caught. Named here because it is one file away from the trap §35
    // exists for, and a later move of this entry to a scenario would meet it.
    replace: "      if (false) return;",
    unitTest: "a column no column names moves nothing",
  },
  {
    // A new task lands in the last column, which is the one that means done.
    // Every task the planner has ever held arrives finished.
    name: "a new task starts in the last column",
    file: "src/web/shell/api.ts",
    find: "const DEFAULT_COLUMN = COLUMNS[0]!.id;",
    replace: "const DEFAULT_COLUMN = COLUMNS[COLUMNS.length - 1]!.id;",
    scenario: "A new task starts in the first column",
    live: true,
    browser: true,
  },
  {
    // A document naming a column this shell does not draw is accepted. The
    // tasks are in the planner and on the list, and on no panel of the board -
    // and the only way back to them is to export the file again.
    name: "a document may put a task in a column the board does not draw",
    file: "src/web/shell/document.ts",
    find: "  if (!columns.some((c) => c.id === value.column)) {",
    replace: "  if (false) {",
    unitTest: "a task in a column this shell does not draw is refused",
  },
  {
    // The refusal stops naming the columns, so a person holding a hand-edited
    // file is told the value is wrong and not what a right one would be.
    name: "the refusal does not say which columns the shell draws",
    file: "src/web/shell/document.ts",
    find: "      columns.map((c) => JSON.stringify(c.id)).join(\", \")",
    replace: '      ""',
    unitTest: "the refusal names the columns this shell draws",
  },

  // --- TODO §44, the cold state every browser scenario starts from ---------
  //
  // Three entries, all `@local`. The hook is not mutated, for the reason §42's
  // block gives and this item states outright: nothing about cold state is
  // reachable while Playwright gives each test its own context, so a mutation
  // removing the probe stays green. `bun run verify:cold` is the arrangement -
  // two pages in one context - and it is one command.
  //
  // These three were reported CAUGHT on 2026-09-13 by a check that never ran.
  // `runUnitTest` spawned three of the five homes `package.json` names, so
  // `bun test` could not load `features/support/__tests__/cold-planner.test.ts`
  // at all; bun exits 1 with `matched 0 tests`, which is not `code === 0`, and
  // a mutation whose test cannot be found read as a mutation whose test went
  // red. Found by a cold read. `TEST_HOMES` is the fix and the guard now
  // catches both of bun's wordings for a filter that matched nothing.
  //
  // That arrangement is also what took `PLAN.md`'s `deleteDatabase` out of the
  // design. Measured 2026-09-13: a delete issued while another page holds the
  // database open is blocked, deletes nothing, and queues every later open on
  // that name behind it. The step meant to save a reused context hangs it.

  {
    // A warm context is read as cold, so the isolation can break and nothing
    // says so - which is the whole of §44.
    name: "a planner that already existed reads as cold",
    file: "features/support/cold-planner.ts",
    find: '  if (reading === null || reading === "unsupported" || reading === 0) return null;',
    replace: "  return null;",
    unitTest: "a version above 0 means the context was used before",
  },
  {
    // A browser with no `indexedDB.databases()` is reported as warm, so every
    // run on one fails for a reason that is not about the planner.
    name: "a browser that cannot answer is reported as warm",
    file: "features/support/cold-planner.ts",
    find: '  if (reading === null || reading === "unsupported" || reading === 0) return null;',
    replace: "  if (reading === null || reading === 0) return null;",
    unitTest: "a browser that cannot answer is not reported as warm",
  },
  {
    // The probe opens the database instead of reading the list. An `open` with
    // no version CREATES it with no object stores, and the shell's own
    // `open(name, 1)` then finds a version 1 holding no `tasks` store.
    //
    // A string edit caught by a string grep, and that is said rather than left
    // to be noticed: the script runs in a page, and `cold-planner.test.ts`
    // starts no browser. What RUNS it is `bun run verify:cold`. This pair is
    // worth keeping because the property it protects - the probe never opens -
    // is the one that would corrupt a real planner, and a grep catches an edit
    // that reintroduces it.
    name: "the cold probe opens the database",
    file: "features/support/cold-planner.ts",
    find: "    const reading = indexedDB.databases();",
    replace: "    const reading = Promise.resolve([]); indexedDB.open(\"x\");",
    unitTest: "opens nothing and deletes nothing",
  },

  // --- TODO §42, a channel a killed run left split ------------------------
  //
  // Four entries, all `@local`, because the message is pure and the store read
  // around it is two `fetch` calls. The hook itself is NOT mutated here: a
  // mutation that removed it would turn nothing red, because no test channel is
  // split while the suite is healthy. That is the same shape §44 has, and it is
  // why the message was made a pure function with its own tests rather than
  // written inline in `hooks.ts`.
  //
  // The hook was measured instead, by arranging the state. That arrangement is
  // `bun run verify:split` now, and was prose until a cold read on 2026-09-13
  // pointed at `~/projects/CLAUDE.md`: the verification artefact is committed
  // next to the feature, and runs in one command. It splits `test-prod`, reads
  // the report, runs the command the report printed, and puts the channel back
  // in a `finally`.
  //
  // The by-hand arrangement found a defect the same day - the check ran before
  // `recordRealChannels`, so `AfterAll` threw a SECOND error about the deploy
  // guard not running - and the order is swapped.

  {
    // The report says a channel is split and stops there, so a person has to
    // work the flags out of two manifests by hand. That is what they already
    // had from `regionDrift`, 41 times.
    name: "the split report does not name the recovery",
    file: "scripts/regions.ts",
    find: "  const commands = split.map(",
    replace: "  const commands = [] as string[];\n  void split.map(",
    unitTest: "names the promote that puts it back",
  },
  {
    // Two regions in agreement are reported as a split, so a healthy suite
    // refuses to start. The lines and the command are both built from an empty
    // list, so the message names a channel and then nothing at all.
    name: "regions in agreement are reported as a split",
    file: "scripts/regions.ts",
    find: "  if (split.length === 0) return null;",
    replace: "  if (false) return null;",
    unitTest: "two regions in agreement have nothing to report",
  },
  {
    // A unit the split region serves and the base does not is left to be
    // CARRIED. A promote merges, so running the printed command changes
    // nothing about that unit and the channel stays refused - which is the one
    // case the line above the command already describes in words.
    name: "a unit only the split region serves is not dropped",
    file: "scripts/regions.ts",
    find: "    const drops = carried.map((unit) => ` --drop ${unit}`).join(\"\");",
    replace: '    const drops = "";',
    unitTest: "a unit the base does not serve is dropped",
  },
  {
    // The recovery names what the SPLIT region serves rather than what the base
    // serves, so running it changes nothing and the channel stays refused.
    name: "the recovery names the composition that is already wrong",
    file: "scripts/regions.ts",
    find: "  const flags = Object.entries(baseComposition.ids)",
    replace: "  const flags = Object.entries(split[0]!.ids)",
    unitTest: "names the promote that puts it back",
  },

  // --- `PLAN.md` step 5, the week -------------------------------------------
  //
  // Twenty entries, counted from the array below rather than remembered:
  // SEVEN are `@local` and thirteen need a browser. The seven are what a DATE
  // is and what a WEEK is - the store, the document reader and `week.ts`, all
  // three pure - and the thirteen are the panel. The split is step 4's for
  // step 4's reason, and the count beside the array is the thing a cold read
  // on 2026-09-12 found wrong there.
  //
  // Six of the twenty were added by a cold read on 2026-09-13, which found the
  // Rule `PLAN.md` names as this step's demonstration carrying no mutation at
  // all. A count of mutations is not a count of scenarios covered: eight of
  // the sixteen scenarios in `seeing-the-week.feature` still have none, and
  // `runScenario` greps the scenario a mutation NAMES, so a mutation aimed
  // elsewhere certifies nothing about them.

  {
    // A date that writes every task. With one task on the page - which is where
    // six of the seven scenarios in the first Rule start - this is
    // indistinguishable from dating one.
    name: "a date puts every task on it",
    file: "src/web/shell/api.ts",
    find: "      tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, due } : t));",
    replace: "      tasks.value = tasks.value.map((t) => ({ ...t, due }));",
    unitTest: "dating one task leaves every other task where it was",
  },
  {
    // The guard that stops a task carrying something that is not a date. No
    // option a visitor can choose on today's `week` produces one, but this
    // shell is composed with a `week` it was not built beside - `PLAN.md`
    // steps 10 to 12 - and step 7 pulls a planner written by another browser.
    // The guard is the store's, and what it rests on is the store.
    //
    // `&& false` rather than cutting the condition, and §35 is why: cutting it
    // whole leaves `isDueDate` imported and called by nothing, `noUnusedLocals`
    // fails the build, and the guard refuses the reading rather than counting
    // it. The call stays and the branch is dead.
    name: "a task is given a date that is not one",
    file: "src/web/shell/api.ts",
    find: "      if (due !== null && !isDueDate(due)) return;",
    replace: "      if (due !== null && !isDueDate(due) && false) return;",
    unitTest: "a refused date leaves the one the task already carried",
  },
  {
    // The pattern becomes the whole rule. `2026-02-30` matches `\\d{4}-\\d{2}-\\d{2}`
    // and `Date.parse` reads it - as 2026-03-02, because the parser rolls the
    // day over - so `Number.isFinite` alone lets it through. The round trip is
    // the arm that catches it, measured on 2026-09-13, which is why the rule is
    // not the pattern.
    name: "a date that matches the pattern is a date",
    file: "src/web/shell/document.ts",
    find: "  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;",
    replace: "  return Number.isFinite(at);",
    unitTest: "is not a date, and puts the task on none",
  },
  {
    // A document carrying a due date that is not a date is accepted. The task
    // is in the planner, on the list, and on no day of the week - and the only
    // way back to it is to export the file again.
    name: "a document may carry a due date that is not a date",
    file: "src/web/shell/document.ts",
    find: "  if (value.due !== null && (typeof value.due !== \"string\" || !isDueDate(value.due))) {",
    replace: "  if (false) {",
    unitTest: "due date reads",
  },
  {
    // The refusal stops saying what shape a date is, so a person holding a
    // hand-edited file is told the value is wrong and not what a right one
    // would look like.
    name: "the refusal does not say what shape a date is",
    file: "src/web/shell/document.ts",
    find: "    return `${at}.due is ${show(value.due)}, and YYYY-MM-DD or null was expected`;",
    replace: "    return `${at}.due is ${show(value.due)}, and something else was expected`;",
    unitTest: "due date reads",
  },
  {
    // Every day draws every task. The week looks busy and is useless: putting a
    // task on a day changes nothing anybody can see, because it was already
    // drawn on every one of them.
    name: "every day draws every task",
    file: "src/web/apps/week/index.tsx",
    find: "          const due = tasks.filter((task) => task.due === day);",
    replace: "          const due = tasks;",
    scenario: "A task moved to another day leaves the one it was on",
    live: true,
    browser: true,
  },
  {
    // The control writes the date the card already carries, so choosing a day
    // does nothing. Caught by the `they put` step's own wait for the card on
    // the day it named.
    //
    // The chosen value is still READ, and §35 is why. `onPick(held)` on its own
    // leaves `picked` assigned and used by nothing, `noUnusedLocals` fails the
    // build, and the guard refuses the reading rather than counting it - which
    // is what happened here on 2026-09-13, the guard's second real use. Only
    // the "No date" arm still does what it did.
    name: "the control writes the date the card already carries",
    file: "src/web/apps/week/index.tsx",
    find: "        onPick(picked === \"\" ? null : picked);",
    replace: "        onPick(picked === \"\" ? null : held);",
    scenario: "A task put on a day is drawn on it",
    live: true,
    browser: true,
  },
  {
    // When a task is due never reaches the database. Every scenario that dates
    // a card and reads the week passes - the store holds it and the panel draws
    // it - and the planner comes back from the next visit with every date gone.
    // The one reading that sees it is a reload.
    //
    // Aimed at `planner.ts` rather than at the week, because that is where the
    // claim is: `PLAN.md` step 2 says a sub-app does not know a database
    // exists, so a date that is not kept is the SHELL failing to keep it.
    name: "a task's date is not kept",
    file: "src/web/shell/planner.ts",
    find: "        for (const task of tasks) store.put(task);",
    replace: "        for (const task of tasks) store.put({ ...task, due: null });",
    scenario: "A date survives a reload",
    live: true,
    browser: true,
  },
  {
    // The week draws seven empty days while the planner is still being read. A
    // visitor with a full planner is told nothing is due, and then it fills in.
    // `PLAN.md` step 2's requirement, on the panel the slate finishes with.
    // TODO §41 is the class.
    name: "the week is drawn before the planner has been read",
    file: "src/web/apps/week/index.tsx",
    find: '  if (planner.state === "unread") {',
    replace: '  if (planner.state === "unread" && false) {',
    scenario: "The week says it is reading before the planner has been read",
    live: true,
    browser: true,
  },
  {
    // The week draws its seven days and says nothing about a task due on none
    // of them. Every count on the page agrees - they are per-day and per-group,
    // not a total - so the planner holds a task the week does not draw and no
    // reading anywhere contradicts the page.
    name: "a task the week cannot place is not reported",
    file: "src/web/apps/week/index.tsx",
    find: "  const elsewhere = tasks.filter((task) => task.due !== null && !days.includes(task.due));",
    replace:
      "  const elsewhere = tasks.filter((task) => task.due !== null && !days.includes(task.due) && false);",
    scenario: "A task dated outside this week is reported with the date it carries",
    live: true,
    browser: true,
  },
  {
    // A task with no date is drawn nowhere at all. It is in the planner and on
    // the list, the week holds seven days that do not name it, and the page
    // says nothing - which is the whole state the No date group exists for.
    name: "a task with no date is not drawn",
    file: "src/web/apps/week/index.tsx",
    find: "  const undated = tasks.filter((task) => task.due === null);",
    replace: "  const undated = tasks.filter((task) => task.due === null && false);",
    scenario: "A new task has no date",
    live: true,
    browser: true,
  },
  {
    // The week starts a day early, so day 1 is a Sunday. Read in a browser, off
    // the page the panel drew from the clock it was given.
    name: "the week starts on the wrong day",
    file: "src/web/apps/week/week.ts",
    find: "  const monday = midnight - weekday * DAY_MS;",
    replace: "  const monday = midnight - (weekday + 1) * DAY_MS;",
    scenario: "A planner nobody has used yet has seven empty days",
    live: true,
    browser: true,
  },
  {
    // The week starts TODAY, which is the rolling window the Monday rule
    // exists to refuse. This was declined on 2026-09-13 because it is a no-op
    // on a Monday, so a scenario catches it six days in seven and the reading
    // depends on the day the suite was run. A cold read the same day asked why
    // the answer was to drop the mutation rather than to test `weekOf` over a
    // fixed date - which is what `week.test.ts` now does, 365 days a year.
    name: "the week is the next seven days",
    file: "src/web/apps/week/week.ts",
    find: "  const monday = midnight - weekday * DAY_MS;",
    // `weekday * 0` and not a cut: cutting the term leaves `weekday` assigned
    // and read by nothing, `noUnusedLocals` fails the build, and §35's guard
    // refuses the reading rather than counting it.
    replace: "  const monday = midnight - weekday * 0;",
    unitTest: "a Sunday belongs to the week that began six days earlier",
  },
  {
    // The weekday name comes off the date, so a heading can contradict the
    // position it is drawn at. Read from the position instead - which is what
    // `label` did until 2026-09-13 - it never can, and a week anchored on the
    // wrong day drew `MON 6 SEP` with nothing on the page or in the deploy
    // record's pictures saying so.
    name: "a day is named for the wrong weekday",
    file: "src/web/apps/week/week.ts",
    find: "  const weekday = (at.getUTCDay() + 6) % 7;",
    replace: "  const weekday = at.getUTCDay();",
    unitTest: "reads",
  },
  {
    // The report keeps its count and loses the value. A visitor is told a task
    // is dated another day and given nothing to look for - and a date that is
    // not a date is exactly the case where the value is the whole reading.
    name: "the value a reported task carries is not printed",
    file: "src/web/apps/week/index.tsx",
    find: "                    {task.due}",
    replace: '                    {""}',
    scenario: "A task whose date is not a date at all is reported as it is",
    live: true,
    browser: true,
  },
  {
    // The card whose date is outside the week gets no option for it, so the
    // select matches none of its options and the browser draws the first. The
    // page then says No date on a card under a heading that says otherwise.
    // `{outside ? null : null}` and not `outside && false`, and §35 is why for
    // the second time on this branch: `outside && false` has type `false`, so
    // tsc drops the narrowing that made `held` a string inside the branch and
    // the build fails with TS2322 rather than the mutation running. Measured
    // 2026-09-13. The condition is still read and the option is still gone.
    name: "a date outside the week is not offered on its own card",
    file: "src/web/apps/week/index.tsx",
    find: "      {outside ? (\n        <option value={held} disabled>\n          {held}\n        </option>\n      ) : null}",
    replace: "      {outside ? null : null}",
    scenario: "A task dated outside this week is reported with the date it carries",
    live: true,
    browser: true,
  },
  {
    // The option carrying a value this week cannot place becomes CHOOSABLE.
    // Then the option set holds something that is not necessarily a date -
    // `"yesterday"` reaches this branch - and the sentence that lets `setDue`
    // refuse silently, which is an argument about the option set, is false in
    // the file that states it. What kept the value from being written back was
    // that a select fires no `change` for the option already chosen: a DOM
    // event rule nothing recorded and nothing tested. Found by a cold read on
    // 2026-09-13.
    name: "a date the week cannot place can be chosen again",
    file: "src/web/apps/week/index.tsx",
    find: "        <option value={held} disabled>",
    replace: "        <option value={held}>",
    scenario: "A task dated outside this week is reported with the date it carries",
    live: true,
    browser: true,
  },
  {
    // A move rebuilds the task and drops its date. `board` and `week` are two
    // separately published bundles over one store, so a member of one that
    // loses a field the other draws is the failure the whole composition is
    // built to make impossible - and it is invisible on the board, which draws
    // no date at all.
    //
    // This is the Rule that `PLAN.md` names as what step 5 demonstrates, and a
    // cold read on 2026-09-13 found it carrying no mutation of its own.
    name: "a move drops the task's date",
    file: "src/web/shell/api.ts",
    find: "      tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, column } : t));",
    replace: "      tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, column, due: null } : t));",
    scenario: "A task dated on the week keeps its date when the board moves it",
    live: true,
    browser: true,
  },
  {
    // `null` stops being a value and becomes a refusal, so a date can be given
    // and never taken off. Every scenario that only ADDS a date passes.
    //
    // The mutation above it deliberately keeps the null arm working, so this
    // is the one that measures it. Found by the same cold read.
    name: "a date cannot be taken off again",
    file: "src/web/shell/api.ts",
    find: "      if (due !== null && !isDueDate(due)) return;",
    replace: '      if (!isDueDate(due ?? "")) return;',
    scenario: "A date taken off a task puts it back under No date",
    live: true,
    browser: true,
  },
  {
    // The Another date group draws EVERY task rather than the ones it is for,
    // so a task on a day is also drawn below it. Every count on the page still
    // agrees - they are per group - and the planner holds fewer tasks than the
    // page shows.
    name: "the page draws a task twice",
    file: "src/web/apps/week/index.tsx",
    find: "              {elsewhere.map((task) => (",
    replace: "              {tasks.map((task) => (",
    scenario: "Every task is drawn once, whichever group it falls in",
    live: true,
    browser: true,
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
  // §35. A red scenario and a Background that never got as far as a scenario
  // both exit non-zero, and a mutation that does not COMPILE is reported as
  // caught by a check that never ran. That is the same class of nothing as a
  // --grep matching no scenario, and it is refused the same way. Found by
  // writing a mutation into a file that did not compile and watching it pass.
  if (/\b(build failed|publish failed|Build failed|error: script "build")/.test(out)) {
    throw new Error(
      `the build failed under ${tag}, so nothing ran and "${m.name}" proves nothing:\n${out.slice(-1200)}`,
    );
  }
  const ran = Number(/Running (\d+) tests? using/.exec(out)?.[1] ?? "0");
  if (ran === 0) {
    throw new Error(
      `--grep ${JSON.stringify(m.scenario)} matched no scenario under ${tag}:\n${out}`,
    );
  }
  matched.set(m.name, ran);
  return code === 0;
}

/**
 * Every home the `test` script names, and it must stay every one of them.
 *
 * It read `src/server src/web scripts` until 2026-09-13 while `package.json`
 * named five, so a mutation whose test lives in `api/` or `features/support`
 * ran against a `bun test` that could not load it. Bun then exits 1 with
 * `matched 0 tests`, `code === 0` is false, and the mutation is reported as
 * CAUGHT by a check that never ran - which is the §35 trap one file over,
 * reached from the other side. Found by a cold read the same day, on the three
 * mutations this branch aimed at `features/support/__tests__/`.
 */
const TEST_HOMES = ["src/server", "src/web", "scripts", "api", "features/support"];

async function runUnitTest(name: string): Promise<boolean> {
  const proc = Bun.spawn(["bun", "test", ...TEST_HOMES, "-t", name], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = (await new Response(proc.stdout).text()) + (await new Response(proc.stderr).text());
  const code = await proc.exited;
  // Two wordings, because bun has two. A filter that matches nothing in the
  // files it loaded prints `matched 0 tests`; one that matches a file with no
  // tests prints a `0 pass` / `0 fail` summary. Either is a check that did not
  // run, and neither may be counted.
  if (/matched 0 tests/.test(out) || (/ 0 pass/.test(out) && / 0 fail/.test(out))) {
    throw new Error(`-t ${JSON.stringify(name)} matched no test:\n${out}`);
  }
  return code === 0;
}

const RUN_LIVE = Boolean(Bun.env.FALSIFY_LIVE);

const argv = process.argv.slice(2);
const only: string[] = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] !== "--only") continue;
  const text = argv[++i];
  if (!text) {
    console.log("--only takes the text to match in a mutation's name.");
    process.exit(1);
  }
  only.push(text);
}

const selected = only.length
  ? MUTATIONS.filter((m) => only.some((text) => m.name.includes(text)))
  : MUTATIONS;

if (only.length) {
  // A filter that matches nothing is the same class of nothing as a --grep that
  // matches no scenario, and it is refused the same way.
  const missed = only.filter((text) => !MUTATIONS.some((m) => m.name.includes(text)));
  if (missed.length) {
    console.log(`--only ${missed.map((t) => JSON.stringify(t)).join(", ")} matches no mutation.`);
    process.exit(1);
  }
  console.log(`--only: ${selected.length} of ${MUTATIONS.length} mutations selected.\n`);
}

let failures = 0;
let skipped = 0;

for (const m of selected) {
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

const ran = selected.length - skipped;
const scope = only.length ? ` of the ${selected.length} --only selected` : "";
const tail = skipped ? `, ${skipped} skipped (set FALSIFY_LIVE=1)` : "";
console.log(
  failures === 0
    ? `\nSUCCESS: ${ran}${scope || ` of ${MUTATIONS.length}`} mutations run, each caught by its check${tail}`
    : `\nFAILURE: ${failures} of ${ran} mutations run were not caught${tail}`,
);
process.exit(failures === 0 ? 0 : 1);

export {};
