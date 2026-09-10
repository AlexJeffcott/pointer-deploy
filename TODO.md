# TODO

Open items and what is done. Read this first after a context clear.

| File | What it carries |
| --- | --- |
| `PLAN.md` | What is being built on the slate, and in what order |
| `README.md` | The design, the traps and the conventions |
| `first-steps.md` | What happens on a first visit, step by step |
| this file | What is open, and a one-line index of what is closed |

**Cut back on 2026-09-10.** Every closed item's full text — its measurements, its refuted leads and its reasoning — is in git history, and `TODO.md` at `f7d2318` is the last version that carries it. The index at the bottom keeps every `§N` resolvable, because 119 references to those numbers live in `scripts/`, `src/`, `api/`, `README.md` and `PLAN.md`.

**The slate was cleared on 2026-09-10.** Two units remained and the object store was rewritten from one build. `PLAN.md` step 0 then removed `hello`, so **one** unit remains: the shell draws five views and none of them places a sub-app. A unit name in the index below is a name that was true at the time.

## Where things are

| | |
| --- | --- |
| Live | <https://pointer-deploy.fly.dev/> |
| Fly app | `pointer-deploy`, two machines since §3: `ams` started, `iad` stopped under `auto_stop_machines`. `min_machines_running = 1` holds `ams` up, and the stopped machine's check reads `the machine hasn't started`, which is that and not a fault |
| Store | Tigris bucket `pointer-deploy-assets`, public, CORS set |
| Channels | `qa`, `prod` for visitors; `test-qa`, `test-prod` for the live suite |
| Units | one: `shell`. `hello` is gone at `PLAN.md` step 0; its published units are still in the store and still promotable |
| Service | `pointer-deploy-api`, its own `fly deploy`. One resource, `greeting`, over `GET` and `POST /v1/greeting`. `API_SERVES` and `API_DEPRECATED` are its two operator switches |
| Contract | `9d1b0a3` (`hello-2026-09`), and it is the only one the registry holds |
| Unit catalogue | `units/catalogue.json`, written by every publish. `bun run units` |
| Schema 2 fixture | `legacy/schema-2/649ca22b/`, kept. Named by `features/support/fixtures/schema-2.json` |
| Deploy records | `deploys/<composedAt>-<channel>/`, opened by `bun run promote` and filled in by `bun run shoot --out <dir>`. The act, the pointer bytes for every region, the shots, and one hand-written line. `2026-09-10T21-07-27Z-qa` is the first with no pictures, and its `notes.md` says why |
| Changelog | `CHANGELOG.md`, generated from `deploys/` by `bun run changelog`, never written by hand and **gitignored** - every fact in it is already in `deploys/`. `scripts/changelog.test.ts` holds the loader that reads the archive |
| Pull requests | Every change goes through one. `CLAUDE.md` is the rule, `.github/pull_request_template.md` the questions, `bun run pr` the URLs and the two sets of shots |
| Secrets | `.env.local`, gitignored |

`prod` has no hostname. Reach it with `curl -H "Host: prod.pointer-deploy.test"`.

```sh
bun run build && bun run publish
bun run promote qa --from-build          # everything just built
bun run promote qa --shell <id>          # one unit. Same command rolls it back
bun run units                            # which ids there are to name
bun run e2e                              # REFUSES on this slate: independence needs a second unit
bun run shoot --out <dir>                # the pictures, into the directory promote opened
bun run changelog                        # the archive as CHANGELOG.md. Run it whenever a record is added
bun run pr                               # the review URLs and both sets of shots
```

`e2e`, `verify:live` and `falsify` all overwrite `dist/`, so build clean immediately before any real promote. A promote to `qa` or `prod` refuses a build this tree did not make — a harness build, another commit, or an uncommitted tree — and `--no-source-check` overrides the last two.

## Open

Numbers are stable identifiers, so a gap means the item is in the index below and not that anything was renumbered.

### 34. What the deploy record does not reach

`bun run promote` opens `deploys/<composedAt>-<channel>/` on a real channel and writes the act and the pointer bytes into it; `bun run shoot --out <dir>` fills in the pictures, gated so that no shot can be filed under a composition it is not a picture of; `bun run changelog` gathers the archive into a gitignored `CHANGELOG.md`; `bun run pr` puts two links and two columns of pictures in a pull request body. What is not built, and what each gap costs.

| Missing | What it costs |
| --- | --- |
| `scripts/record.ts` scores 81.12% under mutation | **Measured 2026-09-10, and this is the row that was avoiding the number.** Widening the scope is two lines, not the difficulty this row used to claim: `commandRunner.command` becomes `bun test src/server api scripts/record.test.ts` and `scripts/record.ts` joins `mutate`. Run that way, `record.ts` kills 850 and 198 survive - 103 `StringLiteral`, 54 `ConditionalExpression`, 15 `MethodExpression`, 14 `EqualityOperator`, 11 `Regex` and 10 `LogicalOperator` - and the whole tree falls from 96.51% to 89.35%, under `thresholds.break: 96`. So the scope is unchanged and the reason is now a number rather than a claim about difficulty. The 54 conditionals are worth reading first: that is where the real gaps were in `composition.ts`. Note the runner cannot be `bun test scripts`, because two tests in `changelog.test.ts` read the real archive and the mutation sandbox has no `deploys/` |
| A promote nobody commits is a record nobody has | The directory is written into the working tree and left there. `bun run pr` refuses a production column that git does not hold at the commit it links, so the failure is caught - one pull request late |
| A publish from `pr` uses the asset bucket's key | §4 refuses CI that key because it is a production-origin execution key, and `bun run pr` now uses it on a laptop on every pull request. The second Tigris key §4 wants closes both |
| The picture is not a function of the composition | The gate proves the pointer. `unchecked.apiBase` and `unchecked.renderer` name two of the inputs it does not reach, and the third - `/service` drawing a wall clock - is named in prose and measured by nobody. §29 is the case that bites: the live browser suite writes the greeting audience to the deployed service |
| A kept manifest outlives the units it names | `retentionPlan` deletes a superseded unit at 90 days and the sweep reads channel pointers, never `deploys/`. So an archived manifest's `assetBase` URLs eventually 404 and the pictures are the only artefact left - the durability argument the other way round. Either the sweep reads the archive, or the README says the record is what the composition WAS and not a way to serve it again |
| No suite reaches the record write | Every suite channel is `test-*` and `keepsRecord` short-circuits there, by design. So the whole evidence for the wiring is manual promotes: five of them now, all `qa`, all `carried`, all `warnings: []`, and the `catch` that guards a partly-written promote has never run |
| The archive is mostly its own verification | Four of the five records in `deploys/` are no-op promotes made to exercise the recorder, each saying so in its `notes.md`. The reason `test-*` is excluded - records of compositions no visitor was served - now applies to the archive's own contents. `CHANGELOG.md` reads that off `promote.json` rather than off the prose and says it in a line of its own, so the state is visible; it is not fixed, and the fix is a deploy that moves a unit |

`prod` is not shot at all, and that is §2 rather than this.

**Read cold on 2026-09-10 by `devils-advocate-agent`,** which found 14 defects in the first version. Eight were fixed the same day: the route table iterated production's routes, nothing checked that a linked record was in git, `--out` was an undocumented `--update` that also crossed `deploys/`/`previews/`, the routes came from this tree rather than the deployed nav, `pr` published before checking it could write the body, `git commit` took no pathspec, the newest record was not filtered by channel, and `contract`/`composedAt` came from a different page load than the ids. The rest are the rows above.

**What the promote record closed, and what building it found.** The act is in `promote.json` and the bytes a region's pointer was given are in `manifest.<region>.json`, written where they were PUT rather than read back later from a browser - which is the durability claim, and it now holds for `prod`, where no browser can reach. Two defects surfaced in the verification rather than in review: the record read `dirty` from a tree its own files had just made dirty, and `shoot`'s gate could not tell a promote of the ids a channel already serves from the page that preceded it, because only the stamp moves. Both are fixed, and the second is `servesWanted`. `deploys/2026-09-10T16-33-38Z-qa` is the record of the promote that read them.

**Read cold on 2026-09-10 by `devils-advocate-agent`, second time.** Thirteen defects in the changelog, all fixed on the branch that added it, each with the test that would have caught it. Three were states the design itself produces and nothing else would have found: `shoot` writes `notes.md` and refuses `prod`, so requiring a note from every record would have made the first `prod` promote a permanently red suite; `shoot` also writes a `TODO:` placeholder whenever nobody passes `--note`, so the reachable failure was a note that says nothing rather than a note that is missing; and `writeRecord` writes the manifests before `promote.json` and awaits neither, so a record can hold the pointer bytes of a real deploy with no act beside them - and the first loader skipped exactly that directory. The rest: a false sentence in the generated header, an unattributable JSON parse error, a `readdir` failure that would have overwritten the document and exited 0, `Composed at` falling back to the moment of a screenshot, "predates `promote.json`" printed above a table quoting one, movement read off the stored label rather than off the ids it was derived from, two records in one second sharing a heading, a preview under `deploys/` reading as a deploy, a summary range taken from the sort key rather than from the instants, and a shot entry missing a field throwing inside the generator.

**What the changelog closed.** `CHANGELOG.md` is generated from `deploys/` by `bun run changelog`, never written by hand, and not committed: every fact in it is already in `deploys/`, so a copy in git buys nothing and costs staleness, a check for it, and a conflict on its counts whenever two branches each land a deploy. What has to be right is the archive and the readings, and `scripts/changelog.test.ts` holds the loader against fixtures - the half that had no test at all and had been wrong twice. The archive forced three readings the entry has to get right, each of them a state the records already hold: a promote every one of whose units is `carried` moved nothing and is not a deploy anybody asked for, a record written by `--region eu` names one region and keeps another promote's bytes under an as-served name, and the oldest record has no act at all, so `not recorded` and `nothing` are different cells. The fourth is a state the archive has never held: `warnings` is `[]` in all five records, so the block that lists them is written and tested against the case nobody has seen. Verified by hand on 2026-09-10 with a sixth record staged in the working tree - a moved unit, two warnings, no pictures - which made both tests red, rendered the entry it should, and was then removed.

### 36. A promote can write a pointer the running image cannot parse

`PLAN.md` step 0 took the application to one unit, so `promote qa --from-build` wrote a pointer whose `apps` is `{}`. The image deployed at the time threw `manifest names no apps` on it. Nothing refused the write; the refusal happened later, in every machine, one at a time.

**What it cost, measured on 2026-09-10.** `ams` was already up: it kept the last manifest it could read, went on serving the previous composition, and put the reason in `x-manifest-refresh` — the degradation working exactly as designed. `iad` was suspended. Waking it primed its cache against a pointer it could not parse, and it answered **503** to every request for `us` until the pointer was put back. Three requests with `fly-prefer-region: iad`, all 503. `deploys/2026-09-10T21-07-27Z-qa/notes.md` is the record.

**Why nothing caught it.** The shell-to-server surface has a gate: the server publishes `blocks.provides.json`, the shell records what it reads, and the origin refuses a shell it cannot feed (§11). The **pointer**-to-server surface has neither. `parseManifest` is the only thing that knows which manifests an image accepts, it lives inside the image, and `promote` runs on a laptop.

| | Gated | By what |
| --- | --- | --- |
| sub-app needs a member the shell has | yes | `uses` vs `provides`, at promote and at the origin |
| shell reads a block the server writes | yes | `blocks` vs `blocks.provides.json`, at the origin |
| **pointer says something the image parses** | **no** | nothing |

**The headline claim does not hold for this change, and that is worth saying plainly.** "A deploy is one JSON write" is true of every change to a unit. This was not a change to a unit: it was a change to what a manifest may say, and it needed a `fly deploy` as well. The project has never had one of those before.

**`bun run verify:live` cannot pass until the image is deployed, and that is measured too.** The `@live` suite promotes to `test-qa` and `test-prod` from this tree, so it writes pointers with `apps: {}` and the deployed image refuses those the same way. Read on 2026-09-10: `test-qa`'s pointer names `shell 5b4b3f51` and no app, and the origin answers it with `x-manifest-refresh: manifest names no apps` over a manifest 15,536 s old. Three scenarios failed in 2 minutes before the run was stopped; the rest would have failed the same way.

**Three ways out, none built.**

- The origin publishes what it accepts, the way the server publishes its blocks: a `schemas` field on `/healthz` or `/compositions`, and `promote` reads it before writing a real channel and refuses. Costs `promote` a network read of the origin it is about to change, which it does not currently make.
- `promote` re-reads the pointer through the origin after writing it, and rolls back on a refusal. Catches everything, and only after every visitor in one region has seen it.
- The parser accepts strictly more, forever, and a manifest field is never removed. That is the rule already; what broke is that a field's ALLOWED VALUES narrowed in the image and widened in the tree, which no version number would have caught either.

### 35. `falsify` cannot tell a red scenario from a build that failed

A mutation is reported as caught when the scenario's process exits non-zero. Several scenarios build and publish from this working tree in their Background, so a mutation that does not COMPILE makes that build fail, the scenario go red, and `falsify` print `✓ caught by scenario X` — for a reading in which the scenario never ran a step of its own.

Seen on 2026-09-10 while writing the step 0 mutations. `Shell.tsx`'s `const path = VIEWS[route.value] ? route.value : DEFAULT_ROUTE` was mutated to `const path = DEFAULT_ROUTE`, which narrows `path` to the literal `"/"`; `path === "/service"` two lines down then stops compiling, `bun run build` fails inside the Background, and the scenario is red on `build failed:`. The mutation now in `scripts/falsify.ts` moves the same behaviour into `router.ts`, where it compiles, and says so in a comment.

**What it costs.** Every mutation of a file the matrix compiles is suspect in the same way, and the report gives a reader no way to tell. The ones aimed at `src/server/` are safe — the server is not rebuilt by a scenario — and the ones aimed at `src/web/` are not.

**The fix is small.** `runScenario` already reads the runner's output to count how many scenarios matched; it can read it again for `build failed:` and `publish failed:` and refuse the reading rather than counting it, the same way a `--grep` matching nothing is refused today. Not built: it wants a fixture that produces the state on purpose, and the state is a compile error, which no committed source can hold.

### 31. Claims that need a second unit

Clearing the slate to one sub-app took the subject away from four readings. `PLAN.md` step 0 then removed that sub-app, and the losses below are what going from one to none cost on top. None of these claims is wrong; each has nothing to measure. `PLAN.md` steps 1, 4, 5, 9 and 10 restore them.

**What was already lost at one sub-app**, and what has happened to it since:

| Claim | Where it was | What holds it now |
| --- | --- | --- |
| A dropped member refuses the app that used it **and nothing else** | `scripts/e2e-member-gate.ts` | **Nothing.** `members.test.ts` used to assert that a member no app calls shows as used by none; with no app that is true of every member, so the test now asserts what the shell PROVIDES and says nothing about use. `bun run e2e:members` refuses to run |
| Warming an off-screen unit's files buys something | two `@browser` scenarios, one `falsify` mutation, `scripts/measure-preload.ts` | `html.test.ts` holds the tags' shape. Nothing measures the benefit. What IS now measured is the opposite: the page warms nothing at all, and `falsify` warms a file no view placed to prove that check has teeth |
| Two independently deployed sub-apps share one signals runtime | `shared-state.feature`, five panels | **Nothing.** `shared-state.feature` is deleted: every scenario in it was a frame and a separately deployed panel agreeing. What survives is one bundle short of the claim — the frame subscribes to its own store, held by `The frame redraws when the reading it took of the service arrives` and by the `peek` mutation, now aimed at `service()` rather than `greeting()` |
| A published pair reads as not additive | `scripts/contract.test.ts` | Nothing. The registry holds one contract, and the reading needs two |

**What removing `hello` cost on top.** Each row is a check that was deleted or turned off, and where it comes back:

| Claim | Where it was | Comes back |
| --- | --- | --- |
| One unit deploys and rolls back without moving the other, read off the rendered page | `bun run e2e` | Step 1. The script now exits non-zero and names the commit holding the full version (`ff196d5`) |
| `promote` merges into the composition instead of replacing it | `Deploying a sub-app leaves the frame where it was`, and a `falsify` mutation | Step 1. Nothing holds it: with one unit a replace and a merge write the same bytes |
| A publish uploads only the unit that changed | `Publishing after a change to one unit uploads that unit alone`, and the `unit id carries the commit` mutation | Step 1. With one unit "only that unit" is true whatever the id rule is |
| A composition whose units share no contract is refused | a `@live` scenario and a `@live` `falsify` mutation | Step 1. `src/server/composition.test.ts` still holds the rule; nothing holds the wiring through a real promote |
| A sub-app needing a member the shell does not have is refused | a `@live` scenario and a `@live` `falsify` mutation | Step 1, and step 10 for the "and nothing else" half. `composition.test.ts` holds the rule |
| A panel that throws costs its panel and not the frame, and can be mounted again | two `@browser` scenarios and two `falsify` mutations | Step 1. `AsyncAppLoader.tsx` is unexercised until then; the frame's own boundary is still held by `The frame throwing replaces the page and offers a reload` |
| A sub-app whose script or stylesheet does not match its digest does not run | a `@browser` Scenario Outline and two `falsify` mutations | Step 1. One of the two mutations — the import map carrying no digests — was re-aimed at a `@local` scenario and is now run on every `bun run falsify` rather than skipped |
| Each sub-app is fetched from its own unit's directory | a `@live` scenario | Step 1. `html.test.ts` holds `loads each sub-app from its own unit's base` |

**Two records this could not keep.** The promote that removed `hello` reads its `before` through `idsInPointer` now, but that fix came after the pointer had moved, so `deploys/2026-09-10T21-07-27Z-qa` does not name `hello` as dropped. And that promote was never served at all — §36 — so the composition live on `qa` still carries a `hello` unit no view places, and will until the server image is deployed. The `@live` scenario `The page names no bundle beyond the frame's own` passes against `test-qa`, which is what `verify:live` uses, and would fail against the real `qa` today. That is the shape `~/projects/CLAUDE.md` warns about and it is named here rather than left to be found.

**One thing closed itself, and by accident rather than by the fix §29 names.** No scenario in the suite now writes to the deployed service: the only `POST` was a panel's audience input, and the panel is gone. §29 stays open, because what closes it is the service changing its subject at step 6 — not a writer losing its keyboard.

### 33. 42 mutants survive in `api/service.ts`

`bun run mutate` on 2026-09-10: `src/server` is 895 of 895 across all seven files, and `api/service.ts` is 268 of 310 — 86.45%. The 42 are 17 `StringLiteral`, 16 `ConditionalExpression`, 4 `Regex`, 3 `MethodExpression` and 2 others, spread over `parseDeprecations`, `discovery` and `handle`.

The file has been inside the mutate scope since `7a0ae6f` and was never held to the standard the server files are. Nothing reported it, because `stryker.config.json` set no `thresholds.break` and the run exits 0 at any score. `thresholds.break` is now 96, which holds the line and does not close this.

**Not obviously worth taking to 100.** OVERVIEW already argues that the API service surface is checked coarsely on purpose: it has no compiler behind it, and a version set compared at serve time is coarser than a type. Several of the 17 string mutants are the second kind README names — wording in an error a test would then pin. The 16 `ConditionalExpression` ones are worth reading first, because that is where the real gaps were in `composition.ts`.

`PLAN.md` step 6 rewrites this file: `greeting` goes and snapshots arrive. Triage after that lands, not before, or the reading is taken against code that is about to be deleted.

### 32. Two member readings at once corrupt each other

`scripts/members.ts` puts its scratch directories under `.contract-members`, a fixed path, and clears the whole tree at the start of a run. Two readings at once therefore delete each other's cut surfaces mid-compile, and the output is not an error — it is a DIFFERENT reading, with members marked used or unused at random.

Seen on 2026-09-10 by running `bun test` while `verify:live` was building in another process: `members.test.ts` claimed `hello` used `ServiceReport.serves`, which it does not reference anywhere, and two runs of `bun run contract:members` minutes apart disagreed about six members.

That reading is what `promote` refuses on, so a wrong one either refuses a composition that works or admits one that does not. Nothing in the repository runs two readings concurrently, so this bites a person and not the pipeline.

**The fix is one line of naming:** put the run's own pid or a random suffix in `ROOT`, or take a lock. Until then, do not run a build and a test run at the same time.

### 2. A browser-reachable `prod`

Needs a domain and a certificate. The domain substitutes in three places: `src/server/origins.ts`, `fly certs add`, `features/support/world.ts`.

### 4. CI

`verify:live` needs live credentials, and the asset bucket's write key is a production-origin execution key. Needs a second Tigris key scoped to non-prod paths first.

`PLAN.md` step 6 adds a second requirement to the same item: the snapshot bucket needs its own key, held by the service and by nothing else. Whether `fly storage create` issues an independent key pair per bucket is **unverified**.

### 6. `verify:live` fails intermittently in a full run

**The symptom.** A full run fails one scenario: the origin serves the composition from before a promote for 25–30 s after the pointer moved, with no failed refresh in the machine's log. It stays open because the next live occurrence, not any fix, is what closes it.

**Refuted by measurement. Do not re-run these.**

| Lead | Reading that refuted it |
| --- | --- |
| The store answers late | Overwrite and read back: 151 ms signed, 305 ms public, 465 ms `no-cache`, under `immutable` and `max-age=5` alike. 1.46 s from inside the ams machine |
| Propagation accumulates over repeated promotes | Eight consecutive pointer rewrites reached the origin in 1047–10716 ms. The 10 s is `MANIFEST_TTL_MS` and does not grow |
| A resumed machine's clock is behind | `scripts/probe-resume-skew.ts`: suspended 120 s, moved the pointer, resumed. Caught up in 2220 ms, guest clock 0 ms out. Fly corrects it on resume |
| The machine stops on its own through a run | Zero restarts across 30 minutes idle. The restarts in the log are the suite's own `fly machine stop`, `features/steps/shell.steps.ts:46`, one per run |

**One real hole found on the way, and fixed.** `now() - checkedAt < ttlMs` reads a backwards clock as freshness: the difference is negative, so the entry never expires. Two unit tests and a `falsify` mutation hold it. It is **not** the diagnosis.

**The reading that matters, captured 2026-08-28.** `x-manifest-age` of 27464 ms against a 10 s TTL, `lastError` null. A store serving a superseded pointer would show a small age, because the age is measured from `fetchedAt` and only a successful refresh advances it. A failing refresh would set `lastError`. So for 27 s **no refresh completed at all** — neither succeeded nor failed — which means `beginRefresh`'s promise did not settle and `e.inflight` stayed non-null. `MANIFEST_TIMEOUT_MS` is not set in `fly.toml`, so the deployed timeout is the 3000 ms default and a refresh should settle within about 3 s either way.

**What closes it.** The next occurrence, with the whole run output kept to a file. Runs since the fixes: 7 of 7 green, then 41 of 41 green on 2026-08-30.

### 29. The live suite writes to the deployed service

`verify:browser` writes to the live page, and a write is a `POST` to `pointer-deploy-api`. On this slate one scenario sets the greeting's audience and `restoreAudience` in the `After` hook puts it back, so the window is one scenario long. The suite still writes to production.

The channels are already handled — the suite owns `test-qa` and `test-prod`, and a tripwire fails a run that moved a real one. The service has no equivalent.

**`PLAN.md` step 6 chooses the way out.** The service stops holding a greeting and starts holding snapshots and slots in a bucket, and the suite's snapshots and slots go under a `test-` key prefix that the existing tripwire pattern covers. The item closes when that lands, not before.

**Nothing writes to it today, and that is not the fix.** `PLAN.md` step 0 removed the panel whose input was the only `POST` in the suite, so the window is currently zero scenarios long. The service is still writable by anything that can reach it, and the suite still reads production; the item is open until the service holds something the suite owns.

### 21. Pin the vendor types the contract references, or stop claiming to

Was §9's second half. NOT built, and the decision is open.

`subapp.ts` says `import type { ComponentType } from "preact"`, and the emitted `subapp.d.ts` carries that line rather than inlining the type. So a matrix cell resolves `preact` from `node_modules` at HEAD, and a retained contract's hash covers a type whose meaning can change under it.

| Reading, 2026-08-28/29 | Value |
| --- | --- |
| The matrix under preact 10.29.8 | 5 cells pass against `e0160a6` |
| The matrix under preact 11.0.0-rc.1 | 5 cells pass against `e0160a6` |
| Vendor types a pin must copy | 255 kB |
| A contract directory today | 12 kB |

The pin would have caught nothing across the one major step available, and any **hashed** pin mints a contract on every Preact patch. Three ways:

- record the resolved vendor versions on `ContractRecord`, unhashed, and warn when `node_modules` differs. No growth, no churn, and it does NOT restore `tsc` as the oracle;
- copy the types into each contract directory and hash them. The oracle is restored, at 255 kB a contract and a mint per patch, and old contracts cannot be retrofitted;
- copy once into `contracts/vendor/preact@<version>/` and hash a reference to it. Same oracle, no duplication, one more concept.

§9's member gate narrows it: a member's digest covers the text of its declaration, so the gap is scoped to the members that name a vendor type, which is `SubApp` alone.

### 23. Compatibility rather than equality on the member gate

`uses` records a member path against the digest of its declaration, and `memberRefusal` refuses when the digest moved. A digest cannot tell a widening from a narrowing:

| Change to a member an app calls | Every caller still compiles | The gate today |
| --- | --- | --- |
| `increment(ns, by?)` becomes `increment(ns, by?, label?)` | yes | refused |
| `increment(ns, by?)` becomes `increment(ns, by: number)` | no | refused |

The first row is the whole item: a change every consumer survives is refused exactly as hard as one that breaks them, and the operator reads the same sentence for both.

| | Digest, today | Assignability |
| --- | --- | --- |
| `unit.json` per member | 7 characters | the declaration the app was built against |
| `promote` | needs no compiler | needs a `tsc` run |
| a widening change | refused | allowed |
| a narrowing change | refused | refused |

NOT obviously worth building. Widening is rare here, and the cost is `promote` gaining a compiler — the exact property that let §11 move this check into a running server, where no compiler exists. Decide before writing any of it.

Source: `amboss-mededu/ui-amboss#12771`, read 2026-08-30, which states the relation and never computes it. A source for the idea, not for a mechanism.

### 24. A runtime identity check on the shared runtime

Also from `#12771`: `assertSingleReact(runtime)` throws when the unit's React is not the host's object, and names the import map entry to look at.

`build.ts` already refuses a sub-app bundle carrying its own Preact, by reading the specifiers in the emitted bytes. What that cannot cover is the browser: an import map resolving wrongly at serve time gives a second copy from a bundle that was clean when built. Measured 2026-08-28 by removing the build guard — the panel reads `Cannot read properties of undefined (reading '__H')` with a Mount again button, and nothing names the cause.

**Why it is not free.** A sub-app can only compare against something the shell hands it, so the shell would pass its own Preact — a vendor VALUE in a surface that deliberately holds types only. That is the cost §9 spent effort avoiding, for a named error.

`PLAN.md` raises the stakes: three sub-apps share one runtime instead of one.

## Open questions

None. The last one — do apps need migrations — was scoped on 2026-09-10 into `PLAN.md` steps 2, 3, 14, 15 and 16. The persistence is IndexedDB, and the answer to "what does a shell do when it meets data from a newer shell" is the requirement step 16 writes.

## Done

Titles and dates only. The full text of each is in git history; `TODO.md` at `f7d2318` is the last version that carries it. These numbers are kept because 119 references outside this file point at them.

| § | Done | What it was |
| --- | --- | --- |
| 1 | | The suite runs on Playwright, through `playwright-bdd` |
| 3 | 2026-08-30 | A second region, and each machine reads its own |
| 5 | 2026-08-30 | A superseded build is kept 90 days, and the sweep will not take it early |
| 7 | | A `throw` control and a boundary that catches it |
| 8 | | The direction of a surface change is read at mint |
| 9 | | Compatibility is read from what a sub-app USES, not from one hash over the surface |
| 10 | 2026-08-30 | A contract can be marked as going away, and nothing is refused for it |
| 11 | | The server-to-shell surface has one declaration and a reading, not a hash |
| 12 | 2026-08-30 | A reading of which compositions are being handed out |
| 13 | 2026-08-30 | The argument survives losing the compiler, and the fourth schedule is real |
| 14 | | One `VIEWS`, exported, and checked against the units at build time |
| 15 | | Shared state stays in `api.ts`, and the rule is written where it applies |
| 16 | | The shell is compiled against the sub-app half |
| 17 | | A sub-app's files are warmed before its view is opened |
| 18 | | Sub-apps are components, and the store is injected |
| 19 | | The shared store is proved from this tree, not only from the deploy |
| 20 | 2026-09-10 | The live switcher check reports what it cannot decide |
| 22 | 2026-08-29 | The 28 surviving mutants are gone, and 23 of them were real |
| 25 | 2026-08-31 | One record of every published unit |
| 26 | 2026-08-31 | What is inside the service, and what is going away |
| 27 | 2026-08-31 | What the service offers, and who reads which field |
| 28 | 2026-08-31 | A `falsify` mutation that proved nothing |
| 30 | 2026-09-10 | A pull request gets a URL |
| — | 2026-09-10 | The version switcher is removed, and the page it was on |
