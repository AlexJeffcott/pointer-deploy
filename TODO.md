# TODO

Open items and what is done. Read this first after a context clear.

| File | What it carries |
| --- | --- |
| `PLAN.md` | What is being built on the slate, and in what order |
| `README.md` | The design, the traps and the conventions |
| `first-steps.md` | What happens on a first visit, step by step |
| this file | What is open, and a one-line index of what is closed |

**Cut back on 2026-09-10.** Every closed item's full text — its measurements, its refuted leads and its reasoning — is in git history, and `TODO.md` at `f7d2318` is the last version that carries it. The index at the bottom keeps every `§N` resolvable, because 119 references to those numbers live in `scripts/`, `src/`, `api/`, `README.md` and `PLAN.md`.

**The slate was cleared on 2026-09-10.** Two units remained and the object store was rewritten from one build. `PLAN.md` step 0 then removed `hello`; step 1 added `list` on 2026-09-11 and step 2 put the planner in IndexedDB the same day, so **two** units remain: the shell draws five views, `/` places `list`, and the tasks are in a database the shell owns. A unit name in the index below is a name that was true at the time.

## Where things are

| | |
| --- | --- |
| Live | <https://pointer-deploy.fly.dev/> |
| Fly app | `pointer-deploy`, two machines since §3: `ams` started, `iad` stopped under `auto_stop_machines`. `min_machines_running = 1` holds `ams` up, and the stopped machine's check reads `the machine hasn't started`, which is that and not a fault |
| Store | Tigris bucket `pointer-deploy-assets`, public, CORS set |
| Channels | `qa`, `prod` for visitors; `test-qa`, `test-prod` for the live suite. `prod` is still on step 0's composition and is refused every promote of this surface until `hello` is dropped — §39, and the runbook is in `PLAN.md` |
| Units | two: `shell` and `list`, the second placed on `/` at `PLAN.md` step 1. `hello` is gone; its published units are still in the store and still promotable |
| Service | `pointer-deploy-api`, its own `fly deploy`. One resource, `greeting`, over `GET` and `POST /v1/greeting`. `API_SERVES` and `API_DEPRECATED` are its two operator switches |
| Contract | `1c4a120` (`planner-stored-2026-09`), minted at step 2 and **additive** over `15ed669` (`planner-2026-09`), so nothing published against step 1's surface breaks and no channel is stranded by it. `9d1b0a3` (`hello-2026-09`) is retained beside both and no unit this tree builds compiles against it |
| Unit catalogue | `units/catalogue.json`, written by every publish. `bun run units` |
| Planner | IndexedDB `pointer-planner`, version 1, owned by the shell: `tasks` keyed on `id`, `meta` keyed on `key`. Opened at a fixed version until `PLAN.md` step 16 - which is what gives step 15 a `VersionError` to show. §40 is the write window a reload can beat |
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
bun run e2e                              # one unit deploys and rolls back without moving the other
bun run shoot --out <dir>                # the pictures, into the directory promote opened
bun run changelog                        # the archive as CHANGELOG.md. Run it whenever a record is added
bun run pr                               # the review URLs and both sets of shots
```

**A surface change can strand a channel, and `--drop` is the way off it.** `PLAN.md` step 1 removed `greeting` from `ShellStore`. `test-prod` still carried `hello 72e6a6f4`, which uses four of the members that went, so `promote` refused every merge into that channel and named the unit and all four members — and four `verify:live` scenarios failed in their Background rather than in an assertion. That is §9's gate working at the boundary it exists for, and the first time it has refused a composition nobody manufactured for it. One command puts the channel back in reach: `bun run promote test-prod --from-build --drop hello`. Removal is said, never inferred, so a channel a surface change strands stays stranded until an operator says what leaves.

`e2e`, `e2e:members`, `verify:live` and `falsify` all overwrite `dist/`, so build clean immediately before any real promote. A promote to `qa` or `prod` **with `--from-build`** refuses a build this tree did not make — a harness build, another commit, or an uncommitted tree — and `--no-source-check` overrides the last two. A promote naming ids (`--shell`, `--app`) takes none of those three checks, which is deliberate: naming an id is how a rollback is made, and the tree it is made from is not the tree that built the unit. The sentence used to claim all three commands were covered.

## Open

Numbers are stable identifiers, so a gap means the item is in the index below and not that anything was renumbered.

**`PLAN.md` step 2 landed on 2026-09-11** and opened two items of its own: §41, a first-paint requirement no composition could reach, and §40, the write window a reload can beat. Six mutations were added with it and all six are caught, the sixth only after §41's arrangement was built.

**Read cold on 2026-09-11, on the step 1 branch.** Twelve defects. Two are open and have numbers of their own — §38, a harness publishing into the operator's catalogue with no marker, and §39, `prod` frozen behind a removal. Ten were fixed on the branch:

| What it was | What holds it now |
| --- | --- |
| A visitor could not type a second tag. The tag input's `value` was `task.tags.join(", ")`, so a comma round-tripped through `tagsFrom` and Preact wrote the text back without it | The draft text is the panel's own state. Two `@browser` scenarios type it one key at a time, and a `falsify` mutation puts the old control back |
| The scenario drove that input with `page.fill`, which sets the whole string in one event and cannot see a control that rewrites itself between keystrokes | `pressSequentially`, and a scenario that appends to a task that already has a tag |
| `bun run promote qa --drop list` died on an uncaught `TypeError`: a loop over `UNITS` read a manifest for the unit it had just excluded | `composedApps` in all three loops, and `bun run e2e` drops `list` from `test-qa` and puts it back |
| `--from-build --drop list` said `list is named by both --app and --drop` when `--app` had named nothing | `--from-build` skips a dropped unit rather than filling it in and then objecting |
| The history writer iterated `UNITS`, so a promote carrying a sub-app this tree no longer builds silently retired every older id of it | The same `composedApps` set the composition was built from |
| `membersIn` could not see an exported `const`: a `VariableStatement` has no name of its own, so `NO_SERVICE` was never probed and `DEFAULT_GREETING` never had been | The declarators are read, a multi-declarator cut takes its comma with it, and `members.test.ts` holds both |
| `bun run verify:browser` was in no checklist, so nothing documented ran `keeping-a-list-of-tasks.feature` or `Moving between views draws each one and fetches nothing` | A row in `CLAUDE.md`'s table, and a sentence saying why it is there |
| `firstSeenCommit` was `git rev-parse HEAD` at mint time, when the new surface is in the working tree and HEAD is the commit before it. Both records were off by one — `planner-2026-09` named `de60d9eb`, whose surface hashes to `9d1b0a3` | Measured at four commits and corrected. `contract:mint` takes `--at <commit>`, and records `mintedDirty` when it cannot say |
| `readData` called `client.greeting()` behind a parser requiring `greeting.text`, so a service answering `v1` correctly put a parse error on `data-api` — under a doc comment saying the reading is whether the version answers | `ServiceClient.data()`: the status and the `Sunset` header, nothing out of the body. `setGreeting`, `parseGreeting` and `ApiGreeting` are gone, which `PLAN.md` had already claimed |
| Four documents contradicted the code: `TODO.md` called the `build failed` guard unbuilt, `README.md` presented a pair as breaking on both halves, `build.ts` said `APPS` was empty, `members.ts` said `ShellStore` had eight members | Each corrected against a reading taken the same day |

**And running the skipped mutations found three more.** `FALSIFY_LIVE=1 bun run falsify --only ...` over the thirteen mutations step 1 added, measured on 2026-09-11: **ten caught, two not caught, one refused.** Every one of the three had been in the array since step 1 and none had ever run.

| Mutation | What it did instead |
| --- | --- |
| `promote replaces the composition instead of merging into it` | It drops a CARRIED sub-app from the manifests a promote reads, and it named `Deploying a sub-app leaves the frame where it was` — where the sub-app is the unit being NAMED and the SHELL is what is carried. A no-op in that scenario. Re-aimed at `Deploying the frame leaves the sub-app at its new version` |
| `the task accessor reads the store without subscribing to it` | `tasks.peek()` and `A task added through the panel is drawn by the list` stayed green: `add` calls `setTitle("")` in the same handler, so the panel re-renders from its own state whether or not it subscribed and reads the new task on the way through. Re-aimed at `A task taken off the list leaves, and the rest stay`, the one write in the panel with no local state change beside it |
| `the tag box is drawn from the store between keystrokes` | Cutting the `value` expression left `drafts` unused, `noUnusedLocals` failed the build, and §35's guard refused the reading rather than counting it — which is that guard's first real use. Re-aimed at the WRITE: the draft is not recorded, the box falls back to the store, and the behaviour is identical |

Re-run after the three were fixed: **3 of 3 caught.** This is §7 of the cold read making its own case — a mutation nobody runs is an entry in an array — and two of the three were wrong in a way only running them could show.


### 42. An interrupted live suite leaves a channel refusing every promote

**Measured on 2026-09-11.** `bun run verify:live` was killed by a signal at scenario 9 of 46. The `After` hook that puts a moved region back never ran, so `test-qa` was left with `list f1fdb597` in `eu` and `4a8fa04b` in `us`. The next run failed **41 of 46**, every one of them in its Background, on

```
eu and us serve different compositions: list f1fdb597 != 4a8fa04b.
Writing both would replace one with a composition nobody chose for it.
Name one with --region <eu|us>. Nothing was changed.
```

That refusal is §3's region rule working correctly - it is the whole point of refusing a split - and the reading it does not give is **why** the channel is split. A person meeting 41 red scenarios reads it as a code failure, and the recovery is one command: `bun run promote test-qa --region us --shell <id> --app <name>=<id>`, naming what the other region already serves.

| | |
| --- | --- |
| What is missing | Nothing detects a split at the START of a run. The suite discovers it one Background at a time, 41 times |
| The cheap fix | A `BeforeAll` that reads both regions of every test channel and fails with one message naming the recovery command, rather than letting every scenario fail on its own |
| The fuller fix | The same check restores parity itself, the way `restoreRegionParity` does at the end of a scenario. It knows both compositions and which region is the base |
| Not a fix | Making the promote write both regions anyway. That is exactly what §3 refuses, and for the right reason |

This is distinct from §6, which is a superseded composition inside a healthy run.

### 41. A first-paint requirement that no composition can reach

**Measured on 2026-09-11.** `PlannerReport.state` starts at `unread` and `list` draws neither the list nor "No tasks yet" until it moves, so that a panel never tells a visitor with a full planner that it is empty. The mutation that removes that guard **stayed green**: `list` is a separately published bundle, fetched and imported after the shell paints, and IndexedDB opens in a few milliseconds - so the panel's first render always happens after the read. The state the requirement is about did not occur.

The scenario now arranges it: `the planner is slow to open` delays the first `indexedDB.open` by 1500 ms. With that, 6 of 6 of step 2's mutations are caught. What is open is the general case, not this scenario.

| | |
| --- | --- |
| The guard is not dead code | `PLAN.md` step 4 preloads a unit off the landing route, so a panel will mount sooner. Step 6 pulls a snapshot, which is a slower read than a local open. The margin closes on its own |
| The arrangement is a harness fact, not a visitor's | 1500 ms is chosen to be longer than a bundle fetch, not measured from anything. A visitor on a slow disk or a cold profile is the real case and nothing here measures how often it happens |
| The class is wider than the planner | Any "before X lands" requirement in this shell has the same shape: the panel that would show it is fetched after the shell paints. `data-api` has the same margin and no scenario about its first paint at all |

### 40. A reload inside the commit window loses the last change

**Measured on 2026-09-11 against `test-qa`.** A task is added, the write starts in the click handler, and the page is reloaded about ten milliseconds later: the task is gone. Three scenarios in `keeping-the-planner-in-the-browser.feature` failed on it and a fourth passed, and which one passed is the reading - `Tags survive a reload` spends 150 ms typing tags before it reloads and closes the window by accident. The browser aborts a transaction that is still open when it takes the page away, and the transaction needs a few milliseconds.

Nothing available makes the window zero. IndexedDB has no synchronous commit; `pagehide` cannot flush a transaction, only start one that is aborted the same way; and `navigator.sendBeacon` sends bytes to a server, which is step 6 and a different claim. What is built instead is a reading: `PlannerReport.pending` is true while a change has not reached the database, and `they load the page again` waits for it to clear. **So no scenario measures this window, by construction** - the step that would have is the one that waits.

| What would close it | What it costs |
| --- | --- |
| Say it on the page: draw "saving…" while `pending` is true | A visitor who is about to close a tab is told. Two lines in `list`, and `PlannerReport.pending` already carries the reading |
| Hold the last change in `localStorage` as well, and reconcile on open | `localStorage` is synchronous, so the window really is zero. The cost is a second place a task can be, and a reconciliation rule when the two disagree - the merge `PLAN.md` refuses for import and pull, arriving by the back door |
| Leave it | A task typed and a tab closed in the same instant is lost. A person who types and then reloads within ten milliseconds is doing something no visitor does on purpose |

Not decided. The first row is cheap and is probably right; the second is the only one that removes the window and it contradicts a rule `PLAN.md` states.

### 34. What the deploy record does not reach

`bun run promote` opens `deploys/<composedAt>-<channel>/` on a real channel and writes the act and the pointer bytes into it; `bun run shoot --out <dir>` fills in the pictures, gated so that no shot can be filed under a composition it is not a picture of; `bun run changelog` gathers the archive into a gitignored `CHANGELOG.md`; `bun run pr` puts two links and two columns of pictures in a pull request body. What is not built, and what each gap costs.

| Missing | What it costs |
| --- | --- |
| `scripts/record.ts` scores 81.12% under mutation | **Measured 2026-09-10, and this is the row that was avoiding the number.** Widening the scope is two lines, not the difficulty this row used to claim: `commandRunner.command` becomes `bun test src/server api scripts/record.test.ts` and `scripts/record.ts` joins `mutate`. Run that way, `record.ts` kills 850 and 198 survive - 103 `StringLiteral`, 54 `ConditionalExpression`, 15 `MethodExpression`, 14 `EqualityOperator`, 11 `Regex` and 10 `LogicalOperator` - and the whole tree falls from 96.51% to 89.35%, under `thresholds.break: 96`. So the scope is unchanged and the reason is now a number rather than a claim about difficulty. The 54 conditionals are worth reading first: that is where the real gaps were in `composition.ts`. Note the runner cannot be `bun test scripts`, because two tests in `changelog.test.ts` read the real archive and the mutation sandbox has no `deploys/` |
| `bun run pr` cannot be run twice | It replaces the `<!--REVIEW` marker with the table it generates, so a second run finds no marker and refuses by name: "no way to know where a previous run's section ended". Every promote made after the first run - which is the normal order, because a promote is what fills the production column - needs the template pasted back by hand first. Met twice on 2026-09-11. The fix is to leave a machine-readable end marker after the generated block, which is what the refusal says is missing |
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

### 39. `prod` is frozen behind a removal nobody has made

Measured on 2026-09-11. Both regions of `prod` serve `shell c2601912` and `hello 3bba892b` at contract `9d1b0a3`; `hello 3bba892b`'s `uses` names `ShellStore.greeting`, `ShellStore.setGreeting`, `Greeting.text` and `Greeting.audience`, and `PLAN.md` step 1's surface has none of them. `promote` loads every CARRIED unit's manifest and hands the whole composition to `compositionRefusal`, so every promote naming the new shell on `prod` is refused by name until `hello` is said to leave.

This is §9's gate working exactly as designed, on the one channel where the recovery cannot be watched: `prod` has no hostname, `bun run shoot` refuses it, and the record of the promote will have a `promote.json` and no pictures. §2 is what changes that.

**The runbook is in `PLAN.md`, under "Deploying `PLAN.md` step 1 to `prod`".** Four commands, `--drop hello` among them, and a row saying why `--app hello=<older>` is not an alternative: every published `hello` was built against `9d1b0a3` and none of them composes with this shell.

**A reading, not a decision.** `PLAN.md` carries it in full: the mint did not have to remove the four declarations, keeping them would have left `prod` promotable, and what the removal bought was one test row that a scratch mint produces on demand. Re-minting to undo it is the owner's call. Nothing on this branch has promoted `prod`.

### 38. A harness that forgets its marker publishes into the operator's catalogue

`bun run e2e:members` cut `goingAway` out of `ShellStore`, ran `bun run build` and `bun run publish shell` with no `BUILD_MARKER`, and published the result to the production asset bucket as an ordinary build. `bun run units` hides a unit only when its marker is non-empty, so on 2026-09-11 the table an operator reads to decide what to deploy opened with

```
shell  5569c9df  2026-09-11  de60d9eb+dirty  31 members provided
```

and printed `bun run promote qa --shell 5569c9df` underneath it. Thirty-one members where HEAD has thirty-two, from a tree no commit holds. A promote naming an id takes no source check, by design, so the only thing that would have refused it is the member gate — and the member gate fired only because `list` happened to use the member this probe cuts. A probe aimed at a member no unit uses would have been promotable.

**Two fixes, both made.** The probe sets `BUILD_MARKER` on every build and reads the marker back off the published `unit.json` rather than trusting the environment it set; and `bun run units` never SUGGESTS a unit built from a dirty tree, because such a build's bytes came from source no commit holds. The dirty rows stay listed — rolling a channel back onto what it once served is what the table is for, and a channel has served a dirty build before.

**What is not built.** Nothing checks that a harness sets a marker. `publish` cannot know it is being called by one, and an unmarked build reaching a `test-*` channel is the ordinary edit-build-look loop as well as a harness, so `promote` cannot refuse it either. The two candidates, neither taken: `promote` warns on an unmarked `--from-build` to a `test-*` channel, which would fire on the normal loop; or a test asserts that every `scripts/e2e-*.ts` sets one, which reads the source rather than the act.

**`5569c9df` was deleted on 2026-09-11**, and the decision is worth the paragraph. `bun run sweep --floor-days 0 --delete` is the only sweep that reaches an object published an hour ago, and measured against the live store that day it reached **71 unit directories** — 54 harness builds, 13 `interrupted-*` part-uploads, two ordinary published units (`shell ca633985`, `hello 29dac25b`), and `units/catalogue.json`, which `groupOf` treats as a group of its own and which nothing would have rebuilt. That is a lot of irreversible deletion to remove one object, and the floor's reason — a visitor's tab still fetching files — was never true of this one: it was served by `test-qa` for about a minute and by no real channel. So `sweep` gained `--only <prefix>`, which narrows the candidate set and changes neither reading, and

```sh
bun run sweep --only units/shell/5569c9df --floor-days 0 --delete
```

removed 24 objects and two `test-qa` history entries. The same run had published a second unmarked unit nobody had named - `list 654bde56`, `de60d9eb+dirty`, 13 members used, its `goingAway` call rewritten - and four more objects went the same way. `bun run units --rebuild` then read seven published units, the newest shell being `e27ad5ff`, which is what `qa` serves. Two `+dirty` rows remain and are staying: `shell ca633985` and `hello 29dac25b` came from an operator publishing during the 2026-09-10 recovery, not from a harness, and the `+dirty` column plus the suggestion rule is what the table owes a reader about them.

### 37. A scenario measures machine state it does not arrange

`features/steps/shell.steps.ts:186` — "both origins are served by one machine" — reads `fly machine list` and asserts exactly one machine is `started`. Nothing in the scenario puts the other one to sleep. It passes only while `iad` happens to be suspended under `auto_stop_machines`, which is most of the time and is not a fact the scenario establishes.

Seen on 2026-09-11: `bun run verify:live` was 37 of 38, and the failure was this. `iad` was `started` because a single `curl -H 'fly-prefer-region: iad'` — taken minutes earlier to check that `us` was healthy after the step 0 deploy — woke it. Reading the deployment made the suite red.

Seen again on 2026-09-11, at step 2. `bun run verify:live` was **45 of 46** and this was the failure. `iad` was `started` at 14:01:06, part-way through the run: no deploy this time, and nothing anybody typed - the suite's own traffic to the `prod` origin woke it under `auto_stop_machines`. So the scenario is now order-dependent on ITSELF, not only on what somebody did beforehand, and a full live run can red itself. The step that failed is the machine count; every reading about the build, the pointer and the composition passed.

**The assertion is not wrong.** The claim is that ONE server answers two origins, and with two machines up a request can reach either, so the scenario cannot prove it. What is missing is the arrangement: the suite already stops a machine elsewhere (`shell.steps.ts:46`, one per run, §6), so a `Given` that suspends every machine but one is the same mechanism applied where the reading needs it.

Until then a live run is order-dependent on whether anybody has touched `us` recently, which is the §32 shape: a check that reports a different answer depending on what else happened, rather than failing.

### 36. A promote can write a pointer the running image cannot parse

`PLAN.md` step 0 took the application to one unit, so `promote qa --from-build` wrote a pointer whose `apps` is `{}`. The image deployed at the time threw `manifest names no apps` on it. Nothing refused the write; the refusal happened later, in every machine, one at a time.

**What it cost, measured on 2026-09-10.** `ams` was already up: it kept the last manifest it could read, went on serving the previous composition, and put the reason in `x-manifest-refresh` — the degradation working exactly as designed. `iad` was suspended. Waking it primed its cache against a pointer it could not parse, and it answered **503** to every request for `us` until the pointer was put back. Three requests with `fly-prefer-region: iad`, all 503. `deploys/2026-09-10T21-07-27Z-qa/notes.md` is the record.

**It was not a property of the suspended machine, and the first account of it said it was.** `prime` puts `checkedAt` back when a read yields nothing (`manifest.ts:318`), so a COLD entry's first `get` awaits, gets null, and `index.ts` answers 503. `ams` survived by having a value cached, not by being in `eu`. Any restart of it — a `fly deploy`, a host migration, an out-of-memory kill — would have taken `eu` down the same way, and `min_machines_running = 1` does not protect against that. So the true reading is that `qa` was one machine restart from 503 in both regions, which is worse than what was first written here.

`src/server/manifest.test.ts` now holds the state: a cold cache, a store answering perfectly well, and a document this image refuses. `features/store-outage.feature` had both halves and never the product — one scenario pairs a server that has read no manifest with a store that is *unreachable*, another pairs a refused document with a *warm* server. The corner that took a region down was neither.

**Why nothing caught it.** The shell-to-server surface has a gate: the server publishes `blocks.provides.json`, the shell records what it reads, and the origin refuses a shell it cannot feed (§11). The **pointer**-to-server surface has neither. `parseManifest` is the only thing that knows which manifests an image accepts, it lives inside the image, and `promote` runs on a laptop.

| | Gated | By what |
| --- | --- | --- |
| sub-app needs a member the shell has | yes | `uses` vs `provides`, at promote and at the origin |
| shell reads a block the server writes | yes | `blocks` vs `blocks.provides.json`, at the origin |
| **pointer says something the image parses** | **no** | nothing |

**The headline claim does not hold for this change, and that is worth saying plainly.** "A deploy is one JSON write" is true of every change to a unit. This was not a change to a unit: it was a change to what a manifest may say, and it needed a `fly deploy` as well. The project has never had one of those before.

**`bun run verify:live` could not pass until the image was deployed, and that was measured too.** The `@live` suite promotes to `test-qa` and `test-prod` from this tree, so it wrote pointers with `apps: {}` and the deployed image refused those the same way. Read on 2026-09-10: `test-qa`'s pointer named `shell 5b4b3f51` and no app, and the origin answered it with `x-manifest-refresh: manifest names no apps` over a manifest 15,536 s old. The `fly deploy` on 2026-09-11 closed that, and `PLAN.md` step 1 puts a sub-app back in every pointer the suite writes.

**What the recovery actually was, which is the part worth being plain about.** The way back from that pointer was not a command. `--app hello=<id>` exited 1, because `--app` validated its name against `APPS` and this tree no longer built `hello`; `--shell <older id>` writes the same `apps: {}` that caused it. The recovery was **an edit to `scripts/contract.ts` and a promote from a dirty tree** — `deploys/2026-09-10T21-15-37Z-qa/promote.json` records `argv: ["qa","--app","hello=3bba892b"]` with `dirty: true`. In the repository whose front page says a rollback is writing the older JSON back, that is not a runbook.

**Fixed.** A promote composes from the channel's own apps as well as this tree's `UNITS`, so a unit the tree no longer builds is carried and can be named; and removal is now said rather than inferred — `--drop <app>` is the only way a unit leaves a channel, it refuses a name the channel does not serve, and the terminal prints what left and the command that puts it back. Composing from `UNITS` alone was also what made the removal silent: `unitMoves` saw `dropped`, `promote.json` recorded it, and the operator's terminal never said a word.

**The state is closed and the item is not.** A `fly deploy` on 2026-09-11 put the image that accepts `apps: {}` in place, and `deploys/2026-09-11T08-34-02Z-qa` is the promote that then dropped `hello`. What is unfixed is the gap itself: nothing gates what a pointer may SAY against what the image parses, and the next step that narrows a manifest's allowed values meets it again.

**Three ways out of the parse gap itself, none built.**

- The origin publishes what it accepts, the way the server publishes its blocks: a `schemas` field on `/healthz` or `/compositions`, and `promote` reads it before writing a real channel and refuses. Costs `promote` a network read of the origin it is about to change, which it does not currently make.
- `promote` re-reads the pointer through the origin after writing it, and rolls back on a refusal. Catches everything, and only after every visitor in one region has seen it.
- The parser accepts strictly more, forever, and a manifest field is never removed. That is the rule already; what broke is that a field's ALLOWED VALUES narrowed in the image and widened in the tree, which no version number would have caught either.

### 35. `falsify` cannot tell a red scenario from a build that failed

A mutation is reported as caught when the scenario's process exits non-zero. Several scenarios build and publish from this working tree in their Background, so a mutation that does not COMPILE made that build fail, the scenario go red, and `falsify` print `✓ caught by scenario X` — for a reading in which the scenario never ran a step of its own. The guard is built; the item is what the guard cannot reach.

Seen on 2026-09-10 while writing the step 0 mutations. `Shell.tsx`'s `const path = VIEWS[route.value] ? route.value : DEFAULT_ROUTE` was mutated to `const path = DEFAULT_ROUTE`, which narrows `path` to the literal `"/"`; `path === "/service"` two lines down then stops compiling, `bun run build` fails inside the Background, and the scenario is red on `build failed:`. The mutation now in `scripts/falsify.ts` moves the same behaviour into `router.ts`, where it compiles, and says so in a comment.

**What it cost.** Every mutation of a file the matrix compiles was suspect in the same way, and the report gave a reader no way to tell. The ones aimed at `src/server/` are safe — the server is not rebuilt by a scenario — and the ones aimed at `src/web/` were not.

**Built on 2026-09-11, and the item stays open for what it does not reach.** `runScenario` reads the runner's output for `build failed:`, `publish failed:`, `Build failed` and `error: script "build"` and THROWS on any of them, so a mutation that does not compile is refused rather than counted - the same way a `--grep` matching nothing is refused (`scripts/falsify.ts:1385`). What has no test is the guard itself: the state it catches is a compile error, which no committed source can hold, so nothing in the suite produces it on purpose. It was found by writing a mutation into a file that did not compile and watching it pass, and that is still the only way it has been exercised.

### 31. Claims that need a third unit

Clearing the slate to one sub-app took the subject away from four readings, and `PLAN.md` step 0 took it from eight more by removing that sub-app. **Step 1 restored eight of the twelve on 2026-09-11.** What is left below needs a THIRD unit, or a step that has not been built yet, and each row says which.

**Restored at step 1**, with what holds each now:

| Claim | What holds it |
| --- | --- |
| One unit deploys and rolls back without moving the other, read off the rendered page | `bun run e2e`, green on 2026-09-11: `list` deployed, the frame deployed, `list` rolled back, each leaving the other where it was |
| A dropped member refuses the app that used it | `bun run e2e:members`, green on 2026-09-11. The refusal reads `list uses ShellStore.goingAway, which this shell does not have`. Its builds carry a marker since §38, so what it publishes is hidden from `bun run units` and refused on a real channel |
| `promote` merges into the composition instead of replacing it | `Deploying a sub-app leaves the frame where it was`, and the `promote replaces the composition instead of merging into it` mutation — re-aimed on 2026-09-11 at `Deploying the frame leaves the sub-app at its new version`, which is the scenario where a sub-app is actually carried. Measured under `FALSIFY_LIVE=1`; the entry had been in the array since step 1 and `bun run falsify` had never run it |
| A publish uploads only the unit that changed | `Publishing after a change to one unit uploads that unit alone`, the `unit id carries the commit` mutation, and a check inside `bun run e2e` |
| A composition whose units share no contract is refused | `A composition with no contract in common is refused` and `A unit that cannot be composed with the rest is refused`, plus the `composition refusal is removed` mutation |
| A sub-app needing a member the shell does not have is refused | `A sub-app needing a member the shell does not have is refused`, and the `a member the shell does not have is allowed through` mutation |
| A panel that throws costs its panel and not the frame, and can be mounted again | Two `@browser` scenarios in `recovering-from-an-error.feature` and two `falsify` mutations on `AsyncAppLoader.tsx` |
| A sub-app whose script or stylesheet does not match its digest does not run | The `@browser` Scenario Outline in `checking-what-the-page-loads.feature`, and the `a sub-app's stylesheet digest never reaches the loader` mutation. The import-map half stays aimed at a `@local` scenario, so `bun run falsify` runs it on every run |
| Each sub-app is fetched from its own unit's directory | `Each unit's files are served from that unit's own directory`, plus `html.test.ts`'s `loads each sub-app from its own unit's base` |
| A published pair reads as not additive | `scripts/contract.test.ts`: `9d1b0a3` against `15ed669` is not additive on the shell half, and the output names `DEFAULT_GREETING`. The registry holds two contracts now |
| A separately deployed panel and the frame share one store | `keeping-a-list-of-tasks.feature`, nine `@browser @test-channel` scenarios, and the `task accessor reads the store without subscribing` mutation. One bundle short of the row below. Only `bun run verify:browser` runs any of them, which is why that command is in `CLAUDE.md`'s table from 2026-09-11 and was not before |

**Still without a subject**, and what each needs:

| Claim | Where it was | Comes back |
| --- | --- | --- |
| A dropped member refuses the app that used it **and nothing else** | `scripts/e2e-member-gate.ts` | Step 10. It needs two sub-apps and a member only one of them calls. `members.test.ts` holds the nearest reading available: the set `list` uses, and that `service`/`setService` are not in it |
| Warming an off-screen unit's files buys something | two `@browser` scenarios, one `falsify` mutation, `scripts/measure-preload.ts` | Step 4. `list` is on the route a visitor lands on, so the warm costs nothing and buys nothing measurable. What IS measured is the page warming exactly the units its views place, with `falsify` warming a file no view placed to prove the check has teeth |
| **Two** independently deployed sub-apps share one signals runtime | `shared-state.feature`, five panels | Step 4. The frame-and-one-panel half is back, in `keeping-a-list-of-tasks.feature`; a second SUB-APP is what `shared-state.feature` had that this does not |
| A page draws a field the service holds, and a write to the service changes it | `shared-state.feature`, and `bun run e2e:schema`'s panel readings | Step 6. No unit draws a field of the service: `list` draws the planner's tasks, which live in the browser. `e2e:schema` skips those readings and says so per reading rather than dropping them |

**One record this could not keep.** The promote that removed `hello` reads its `before` through `idsInPointer` now, but that fix came after the pointer had moved, so `deploys/2026-09-10T21-07-27Z-qa` does not name `hello` as dropped.

**§29 is still open and nothing in the suite writes to the service.** The only `POST` was a panel's audience input and the panel went at step 0; `list` writes nothing anywhere. What closes §29 is the service changing its subject at step 6 — not a writer losing its keyboard.

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
