# TODO

Open items and what is done. Read this first after a context clear.

| File | What it carries |
| --- | --- |
| `PLAN.md` | What is being built on the slate, and in what order |
| `README.md` | The design, the traps and the conventions |
| `first-steps.md` | What happens on a first visit, step by step |
| this file | What is open, and a one-line index of what is closed |

**Cut back on 2026-09-10.** Every closed item's full text — its measurements, its refuted leads and its reasoning — is in git history, and `TODO.md` at `f7d2318` is the last version that carries it. The index at the bottom keeps every `§N` resolvable, because 119 references to those numbers live in `scripts/`, `src/`, `api/`, `README.md` and `PLAN.md`.

**The slate was cleared on 2026-09-10.** Two units remain and the object store was rewritten from one build. A unit name in the index below is a name that was true at the time.

## Where things are

| | |
| --- | --- |
| Live | <https://pointer-deploy.fly.dev/> |
| Fly app | `pointer-deploy`, two machines since §3: `ams` started, `iad` stopped under `auto_stop_machines`. `min_machines_running = 1` holds `ams` up, and the stopped machine's check reads `the machine hasn't started`, which is that and not a fault |
| Store | Tigris bucket `pointer-deploy-assets`, public, CORS set |
| Channels | `qa`, `prod` for visitors; `test-qa`, `test-prod` for the live suite |
| Units | two: `shell` and `hello` |
| Service | `pointer-deploy-api`, its own `fly deploy`. One resource, `greeting`, over `GET` and `POST /v1/greeting`. `API_SERVES` and `API_DEPRECATED` are its two operator switches |
| Contract | `9d1b0a3` (`hello-2026-09`), and it is the only one the registry holds |
| Unit catalogue | `units/catalogue.json`, written by every publish. `bun run units` |
| Schema 2 fixture | `legacy/schema-2/649ca22b/`, kept. Named by `features/support/fixtures/schema-2.json` |
| Deploy records | `deploys/<taken>-<channel>/`, written by `bun run shoot`. The shots, the pointer bytes for every region, and one hand-written line |
| Secrets | `.env.local`, gitignored |

`prod` has no hostname. Reach it with `curl -H "Host: prod.pointer-deploy.test"`.

```sh
bun run build && bun run publish
bun run promote qa --from-build          # everything just built
bun run promote qa --app hello=<id>      # one sub-app. Same command rolls it back
bun run units                            # which ids there are to name
bun run e2e                              # the one that proves the feature works
bun run shoot --note "..."               # what the channel serves now, into deploys/
```

`e2e`, `verify:live` and `falsify` all overwrite `dist/`, so build clean immediately before any real promote. A promote to `qa` or `prod` refuses a build this tree did not make — a harness build, another commit, or an uncommitted tree — and `--no-source-check` overrides the last two.

## Open

Numbers are stable identifiers, so a gap means the item is in the index below and not that anything was renumbered.

### 34. The deploy record is half written

`bun run shoot` files the images, the pointer bytes for every region and one hand-written line, gated so that no shot can be filed under a composition it is not a picture of. Three parts are not built, and each has a consequence rather than a gap.

| Missing | What it costs |
| --- | --- |
| `promote` writes no record of its own | Nothing says which command was run, what it refused, or which units it carried rather than moved. `shoot` reads the result and cannot read the act |
| No `CHANGELOG.md` | The records are a directory listing, and the one line in each `notes.md` is gathered nowhere. Generate the index from `deploys/*/shots.json`, so the hand-written half is written once and the machine half cannot drift |
| Nothing checks a record | A test over every `deploys/*/shots.json`: the unit ids are in the catalogue, every named shot exists, and the region manifests agree apart from `composedAt`. One `falsify` mutation removes the pointer gate and a named check must go red |

`prod` is not shot at all, and that is §2 rather than this.

### 31. Claims that need a second unit

Clearing the slate to one sub-app took the subject away from four readings. None is wrong; each has nothing to measure. `PLAN.md` steps 1, 4 and 5 restore the first three, and step 9 restores the fourth.

| Claim | Where it was | What holds it now |
| --- | --- | --- |
| A dropped member refuses the app that used it **and nothing else** | `scripts/e2e-member-gate.ts` | `scripts/members.test.ts`, which asserts a member no app calls shows as used by none |
| Warming an off-screen unit's files buys something | two `@browser` scenarios, one `falsify` mutation, `scripts/measure-preload.ts` | `html.test.ts` holds the tags' shape. Nothing measures the benefit; every unit is on the route a visitor lands on |
| Two independently deployed sub-apps share one signals runtime | `shared-state.feature`, five panels | The frame and the panel share it, held by the same feature and by the `peek` mutation in `falsify` |
| A published pair reads as not additive | `scripts/contract.test.ts` | Nothing. The registry holds one contract, and the reading needs two |

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
