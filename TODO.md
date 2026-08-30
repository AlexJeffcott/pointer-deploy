# TODO

Open items and what is done. Read this first after a context clear.
The README carries the design, the traps and the conventions.

## Where things are

| | |
| --- | --- |
| Live | <https://pointer-deploy.fly.dev/> |
| Fly app | `pointer-deploy`, one machine, region `ams` |
| Store | Tigris bucket `pointer-deploy-assets`, public, CORS set |
| Channels | `qa`, `prod` for visitors; `test-qa`, `test-prod` for the live suite |
| Contract | `e0160a6` |
| Schema 2 fixture | `legacy/schema-2/2d429c02/`, kept. Named by `features/support/fixtures/schema-2.json` |
| Secrets | `.env.local`, gitignored |

`prod` has no hostname. Reach it with `curl -H "Host: prod.pointer-deploy.test"`.

```sh
bun run build && bun run publish
bun run promote qa --from-build          # everything just built
bun run promote qa --app alpha=<id>      # one sub-app. Same command rolls it back
bun run e2e                              # the one that proves the feature works
```

`e2e`, `verify:live` and `falsify` all overwrite `dist/`, so build clean
immediately before any real promote. A promote to `qa` or `prod` now refuses a
build this tree did not make — a harness build, another commit, or an
uncommitted tree — and `--no-source-check` overrides the last two.

## Open

Numbers are stable identifiers - other sections point at them - so a gap means
that item moved to Done, not that anything was renumbered.

### 2. A browser-reachable `prod`

Needs a domain and a certificate. The domain substitutes in three places:
`src/server/origins.ts`, `fly certs add`, `features/support/world.ts`.

### 3. Second region

`fly scale count 1 --region iad`. Needs `manifests/us/<channel>.json` published
or the US machine answers 503.

### 4. CI

`verify:live` needs live credentials, and a bucket write key is the
production-origin execution key. Needs a second Tigris key scoped to non-prod
paths first.

### 5. Asset retention

Nothing is deleted, so nothing dangles. If a policy is added, keep every build
90 days, or a tab opened before a deploy breaks on its next lazy fetch. Exempt
`legacy/schema-2/`: the rollback scenarios point a channel at what is there,
and a retention sweep would delete the fixture rather than expire it.

`scripts/sweep-superseded.ts` (`bun run sweep`) is half of this already: it
lists what no channel can serve, refuses to run if anything under `legacy/`
reaches the delete set, and changes nothing without `--delete`. What it does NOT
have is a policy - it removes what is superseded now, with no 90-day floor, so a
tab opened before the last promote would break on its next lazy fetch. Add the
floor before it runs on a schedule.

### 6. `verify:live` fails intermittently in a full run

Both leads are refuted by measurement, and the lagging hop is named. The
experiment the item ended on has been run, and it found a mechanism that
produces exactly the reading the last occurrence gave. The item stays open
because the next live occurrence, not this fix, is what closes it.

**The store is not the lagging hop.** Overwriting a key and reading it back:
the new bytes reached a signed GET in 151 ms, a public GET in 305 ms and a
`no-cache` GET in 465 ms, under `immutable` and under `max-age=5` alike. No
response carried an `age` header. Read from inside the ams machine rather than
from here, 1.46 s. So "an immutable claim that is rewritten" is not a caching
fault.

**Propagation does not accumulate over repeated promotes.** Eight consecutive
rewrites of `test-qa`'s pointer reached the origin in 1047, 10360, 10716,
10286, 10704, 10423, 10325 and 10438 ms. The 10 s is the server's own
`MANIFEST_TTL_MS`, and it does not grow with the number of promotes. The
image's server, run locally against the real store with the machine's
settings, followed 20 rewrites in a row: median 10536 ms, max 10660 ms, no
failed refresh.

**The failure is the origin, and it is not slowness.** A full run on
2026-08-27 reproduced it:

```
the prod origin did not serve the whole composition after 30520 ms.
Still wrong: shell: 5329b397 != e4599956, ...
the store's pointer names ... shell=e4599956, composed 31 s ago
```

The pointer moved at once. The origin served the composition before it for
three TTLs, with not one failed refresh in the machine's log.

**One mechanism found and fixed.** `now() - checkedAt < ttlMs` reads a clock
that has moved BACKWARDS as freshness: the difference is negative, which is
smaller than any TTL, so the entry never expires and the origin serves a
composition nobody promoted for as long as the skew lasts - silently, because
no request is ever made to fail. `fly.toml` sets `auto_stop_machines =
"suspend"`, and a guest resumed from a snapshot can come back with its clock
behind. Two unit tests and a falsify mutation hold it.

**Run, and it does not explain the failure.** `scripts/probe-resume-skew.ts`
suspended the machine for 120 s, moved the pointer while it slept, and resumed
it with a request. The first answer after the resume was the OLD marker, so the
process survived the suspension with its cache intact - and the origin caught up
in 2220 ms, far inside the 10 s TTL. The guest's clock read 0 ms outside the
3299 ms round trip that measured it. A clock 120 s behind would have made
`now() - checkedAt` about zero and frozen the entry; instead it expired at once.
Fly corrects the guest clock on resume.

So rule 9 closes a real hole and is NOT the diagnosis. One sample, and
`fly machine suspend` may not be what `auto_stop_machines = "suspend"` does on
its own.

**The machine does not stop on its own, and the restarts in the logs are the
suite's.** Corrected on 2026-08-28: the restarts through a run were read as
Fly's automatic cycle, and they are not. `features/steps/shell.steps.ts:46` runs
`fly machine stop` for "A visitor arriving at a suspended server receives the
current build" - one per run, which is exactly the five seen across the batch of
five. Left alone for 30 minutes the machine restarted ZERO times and its
`updated_at` did not move: `min_machines_running = 1` holds it up.

So a resumed process is not a routine state here at all.
`auto_stop_machines = "suspend"` is configured and was never observed to fire.
Rule 9 stays correct - a negative age reads as fresher than any TTL - but the
condition it was written for is rarer than the guard's own comment claims.

**What is left**, with the store, the load, the repeated promotes and the resume
all measured out: a Tigris overwrite the MACHINE's read path sees late, for tens
of seconds, rarely. That read was sampled once, at a quiet moment, and it was
1.46 s. Nothing here can force it. The deployed headers settle it on the next
occurrence - an age under the TTL with the wrong composition is the store's
answer, an age far above it is the origin.

**Runs since the fixes: 7 of 7 green** - 196 scenarios, 0 curl retries fired,
0 failed refreshes logged. Five of them ran back to back on 2026-08-27 between
21:20 and 21:49 UTC, 4m35s to 6m33s each, with the propagation budgets used
running 4304 to 9741 ms of 15000. The machine restarted five times inside that
window - once per run, from the scenario that stops it - and no run noticed.

An eighth run followed 30 minutes of idle: green, 28 scenarios, 0 retries,
propagation 8976 and 6703 ms. It did NOT reach the condition it was built for -
the machine never stopped - so it measured a machine that had been up and quiet,
not one resumed from sleep.

Before the fixes, four runs the same day each failed one or two scenarios. The
comparison is observational, not controlled: the code changed, the image was
redeployed, and the machine was exercised constantly instead of being left idle
between runs. One of the two known failure modes was fixed - the dropped
connection - and the other was not: 30520 ms of a superseded composition, cause
unknown. So the reading is that the observed rate has moved, and not that the
second fault is closed.

**One more occurrence, on 2026-08-28, and its diagnostic was lost.** The run
straight after the store sweep failed one scenario: the shell served `52ebe495`
where the scenario had just published `e34bccf3`. Both `test-qa` and `test-prod`
served `e34bccf3` minutes later with an age of 107 ms and 382 ms, so it arrived
late rather than never. The `x-manifest-age` at the MOMENT of the failure - the
one reading the table below exists to give - was not captured, because the run
was put in the background and only its tail was kept. Run `verify:live` with the
whole output kept, or the next occurrence costs another run.

Run times around it, with the sweep in the middle: 5m46s before, 13m46s for the
failing run, 9m05s for a green re-run of 33 of 33 with propagation at 8585 and
5674 ms of 15000. The failing run was 2.4x the one before it and came
immediately after 2849 deletes. Whether the deletes slowed the store is
UNMEASURED - one green re-run does not settle it either way.

**The reading was captured on 2026-08-28, and it is row 2.** A full
`verify:live` failed one scenario - "Visitors return to the previous build when
it is promoted back", 33 scenarios, 1 failed, 7m37s - with the whole output
kept this time:

```
the qa origin still served "27a65b5c" after 25255 ms; expected "b36d61ba".
the store's pointer names ... shell=b36d61ba, composed 26 s ago.
the origin rendered from a manifest 27464 ms old, last refresh ok
```

An age of 27464 ms against `MANIFEST_TTL_MS = 10000`, with `lastError` null. So
this is NOT the store answering with the old document, which is what had been
assumed: `x-manifest-age` is measured from `fetchedAt`, which only a SUCCESSFUL
refresh advances, so a store that kept serving the superseded pointer would
have shown a small age and a fresh `fetchedAt`. And it is not a failing refresh,
because a failure sets `lastError` and that is what the header would say.

What is left is the row the table names: for 27 s, no refresh COMPLETED at all -
neither succeeding nor failing - on an entry whose TTL is 10 s.

That is a mechanism this code can be read against rather than guessed at.
`refresh` fetches under `AbortSignal.timeout(timeoutMs)`, and
`MANIFEST_TIMEOUT_MS` is NOT set in `fly.toml`, so the deployed timeout is the
3000 ms default. A refresh should therefore settle within about 3 s, one way or
the other, and `beginRefresh`'s `finally` should clear `e.inflight`. An entry
that goes 27 s without a completed refresh means that promise did not settle,
so `e.inflight` stayed non-null and every later request took the
stale-while-revalidate path and returned at once - silently, and with `ok`
beside it, because nothing failed.

**The experiment was run on 2026-08-29, and the mechanism is real.** Three unit
tests in `src/server/manifest.test.ts`, driving a `fetchImpl` that answers
neither the request nor its own abort. All three failed against the code as it
stood:

| What was asserted | What happened |
| --- | --- |
| a later read starts a new refresh | it made no request at all, and served the old document |
| the state names the stuck refresh | `lastError` stayed null |
| a cold read gives up | it never returned. The test needs a race to fail rather than hang |

So `e.inflight` does survive a fetch that never settles, and one hung request
freezes an entry for the life of the process with nothing to show for it.

**The fix is a deadline the fetch cannot decline.** `bounded` in `manifest.ts`
races the whole attempt - the body read and the parse included - against a timer
at twice `timeoutMs`, which is 6000 ms deployed. The loser is abandoned, never
cancelled: a late answer is dropped rather than written, because a newer attempt
owns the entry by then. `AbortSignal.timeout` keeps its job, and at twice the
budget a fetch that honours it always reports its own error rather than this
one. Rule 11 in the header, three unit tests and a falsify mutation hold it.

**What this does NOT prove.** Nothing recorded whether a refresh was in flight
during the 2026-08-28 occurrence. So this is a mechanism that existed and
produced exactly that reading, and not a diagnosis of that failure. The item
stays open, and it closes on the next occurrence rather than on this change.

**Deployed, and the run after it is green.** Image version 12 on 2026-08-29 at
10:59Z, then `verify:live` 36 of 36 in 10.3 min, propagation 8634 and 7808 ms of
15000. The machine logged no failed refresh.

The attempt before that one is NOT evidence, and it must not be read as this
item's intermittent. Five scenarios failed on THIS machine's resolver:
`curl: (28) Resolving timed out`, with name lookup here measuring 169 ms a
minute later and every origin answering `refresh: ok` at an age of 129 ms and
346 ms. That run was also killed at 12 minutes, before Playwright printed its
failure detail, so no other cause was ever named.

The in-flight reading the item asked for is NOT being built. With the deadline
in place no entry can stay in flight past 2 x `timeoutMs`, so a "refresh in
flight since" header could only ever report a number under 6 s, and the age
beside `lastError` already separates the three causes.

The next failure says which hop it is without another investigation. Every
shell now carries `x-manifest-age` and `x-manifest-refresh`, and the suite
quotes both beside what the store holds:

| The origin says | What it means |
| --- | --- |
| age under the TTL, wrong composition | the store answered with the old document |
| age far above the TTL, refresh `ok` | the origin stopped refreshing. Rule 9 |
| a named error | the refresh is failing and the last good build is being kept |

Row 2 is narrower than it was. A refresh that never settles now names itself at
6 s, so an age far above the TTL with `ok` beside it means the clock and
nothing else.

Row 3 of the old table - `Republishing reported 0 of 5 units unchanged` - did
not reproduce and is not explained. Its assertion now carries publish's whole
output, which names which of contracts, digests or provenance moved.

### 21. Pin the vendor types the contract references, or stop claiming to

Was §9's second half. NOT built, and the decision is open.

`subapp.ts` says `import type { ComponentType } from "preact"`, and the emitted
`subapp.d.ts` carries that line rather than inlining the type - measured on
2026-08-28. So a matrix cell resolves `preact` from `node_modules` at HEAD, and
a retained contract's hash covers a type whose meaning can change under it.

The fix §9 named was to copy Preact's own `.d.ts` into each contract directory
and point the cell's `paths` at the copy. Three readings taken on 2026-08-28 and
2026-08-29 bear on whether to:

| Reading | Value |
| --- | --- |
| The matrix under preact 10.29.8 | 5 cells pass against `e0160a6` |
| The matrix under preact 11.0.0-rc.1 | 5 cells pass against `e0160a6` |
| Vendor types a pin must copy | 255 kB (preact src, hooks, jsx-runtime, signals) |
| A contract directory today | 12 kB |

So the pin would have caught nothing across the one major step available, and
any HASHED pin mints a contract on every Preact patch, because the identity
moves with the copied bytes. The three ways:

- record the resolved vendor versions on `ContractRecord`, unhashed, and warn
  when `node_modules` differs from what a retained contract was minted at. No
  growth, no churn, and the gap becomes visible rather than invisible. It does
  NOT restore `tsc` as the oracle;
- copy the types into each contract directory and hash them, as §9 said. The
  oracle is restored. 255 kB a contract, a mint per patch, and old contracts
  cannot be retrofitted because their hash would move;
- copy once into `contracts/vendor/preact@<version>/` and have each contract
  hash a reference to it. Same oracle, no duplication, one more concept.

§9's member gate narrows the question: a member's digest covers the text of its
declaration, so the vendor gap is now scoped to the members that name a vendor
type, which is `SubApp` alone.

### 23. Compatibility rather than equality on the member gate

From `amboss-mededu/ui-amboss#12771`, read on 2026-08-30. That PR loads
self-contained React units, and its host-to-unit boundary declares what the UNIT
NEEDS rather than what the host has: the host passes `Card: typeof Card`, the
real design-system component, and the unit declares
`Card: ComponentType<{ title?: string; children?: ReactNode }>`. The relation
between the two is structural assignability.

**It is stated and never computed.** The two declarations sit in workspaces that
cannot import each other, and both files say so - "deliberately looser, so the
two are not checked against each other anywhere" and "change one and change the
other". That is §11's fault written down rather than reached by accident, so the
PR is a source for the IDEA and not for a mechanism.

**The idea lands on a real defect here.** `uses` records a member path to the
digest of its declaration, and `memberRefusal` refuses when the digest moved. A
digest cannot tell a widening from a narrowing:

| Change to a member an app calls | Every caller still compiles | The gate today |
| --- | --- | --- |
| `increment(ns, by?)` becomes `increment(ns, by?, label?)` | yes | refused |
| `increment(ns, by?)` becomes `increment(ns, by: number)` | no | refused |

The first row is the whole item. A change every consumer survives is refused
exactly as hard as one that breaks them, and the operator is told the same
sentence for both.

**What the fix costs**, and it is the same trade as §21 one layer down:

| | Digest, today | Assignability |
| --- | --- | --- |
| `unit.json` per member | 7 characters | the declaration the app was built against |
| `promote` | needs no compiler | needs a `tsc` run |
| a widening change | refused | allowed |
| a narrowing change | refused | refused |

NOT obviously worth building. A widening change is rare here, and the cost is
`promote` gaining a compiler it does not have - which is exactly the property
that let §11 move the same kind of check into a RUNNING server, where no
compiler exists at all. Decide before writing any of it.

### 24. A runtime identity check on the shared runtime

Also from `#12771`: `assertSingleReact(runtime)` throws when the unit's React is
not the host's object, and names the import map entry to go and look at.

`build.ts` already refuses a sub-app bundle that carries its own Preact, by
reading the specifiers in the emitted bytes. What that cannot cover is the
browser: an import map that resolves wrongly at serve time gives a second copy
from a bundle which was clean when it was built. Measured on 2026-08-28, by
removing the build guard: the panel reads
`Cannot read properties of undefined (reading '__H')` with a Mount again
button, and nothing names the cause.

The store is handed to a sub-app as a prop, so its identity is already
guaranteed. Preact's is not.

**Why it is not free.** The only way a sub-app can compare is against something
the shell hands it, so the shell would pass its own Preact - a VENDOR VALUE in
a surface that deliberately holds types only. `api.ts` says why: a signal in
the surface would put `@preact/signals` into the contract hash, and
`ComponentType` in `subapp.ts` is already the one vendor type that costs §21.
So this buys a named error for a cost §9 spent effort avoiding.

### 10. A deprecation dynamic

`ContractRecord` in `scripts/contract.ts` is the one record per contract, so a
`deprecated` field on it — a reason and a date — is the smallest version.
`contract:matrix` prints it; `promote` warns when the contract it chose carries
one, and names what to move to. A promote whose ONLY option is deprecated is
the state the warning exists to prevent.

A FIELD is the harder half and the hash cannot express it: one identity over
the whole surface has no room for "this member is going away". `@deprecated` in
a docstring is the obvious carrier and `emitSurface` strips comments on
purpose — `removeComments: true`, so a docstring edit does not mint a
contract. Invisible to the hash by design, which is right; invisible to the
consumer too, which is not. Deciding what carries it is most of the work.

Nothing can actually be REMOVED without §12.

### 12. A reading of which compositions are in use

Two readings, and only one is free.

**What is handed out.** The server already knows: every response names its
composition, and the shell is `no-store`, so every navigation reaches the
origin. A counter on the read path in `src/server/index.ts` needs no new route.

**What is still running.** A tab opened before a promote keeps its composition
and never asks again — exactly the population a sunset has to worry about.
Only the page can say, and that needs a route that accepts a write.

The second breaks two rules the server holds now: `index.ts` refuses every
method that is not GET or HEAD, and the image holds no state. A beacon needs a
store write, and a bucket write key on the production origin is the same key
§4 already refuses to give CI.

So the smallest honest version is the read-path count, in memory, on a route
the suite can read — with what it does not answer written beside it. A durable
reading waits on §4.

Trap: `min_machines_running = 1` holds one machine up, but an in-memory count
is lost whenever the machine is replaced. Good enough for a reading of live
traffic, not for a sunset decision.

## Open questions

One left. What was scoped became §7 to §19 above; §8, §13, §14, §15, §17 and
§19 are now under Done, §14 and §15 having been answered by reading what the code
already does, and §16 was a defect that reading found.

### Do apps need migrations?

**Out of scope for now, on 2026-08-28. To be revisited.** Not closed: deferred,
with the reading below so it can be picked up without repeating it.

Nothing persists. There is no `localStorage`, `sessionStorage`, `indexedDB` or
cookie anywhere in `src/`, `features/`, `scripts/` or `build.ts`. `user` and
`counters` live in memory and die with the tab, so the question has no instance
in the code and there is no answer already true to write down.

It belongs to a family the project now has three of - a surface the contract
hash does not cover:

| Surface | What is on the other side | Item |
| --- | --- | --- |
| server to shell, through the DOM blocks | a deployed image | §11 |
| a sub-app to a service it calls | a separate deploy schedule | §13 |
| a unit to its own persisted state | the past | this |

The third is the only one where a rollback is asymmetric. Code rolls back by
moving a pointer. Data written by the newer version is still there and nothing
can redeploy it away. That is a limit the project has not shown.

What makes it expensive, and why it waits: `~/projects/CLAUDE.md` requires every
scenario to start from the cold state a fresh visitor sees - empty
`localStorage`, empty IndexedDB. Adding persistence puts a clear step in all 196
scenarios, and any scenario that misses it becomes order-dependent.

The demonstration when it is picked up: persist `counters`, publish a shell that
stores one shape and a shell that stores another, roll back with the newer data
present, and watch it break. Then decide the fix - a version stamp on the stored
document and a migration owned by the shell, which §15 says is where shared
state lives.

## Done

- **The argument survives losing the compiler, and the fourth schedule is
  real.** Was §13, done on 2026-08-30. `pointer-deploy-api` is a second Fly app
  with its own image, its own `fly deploy` and its own version number. Nothing
  in `api/` imports anything from `src/`, and neither image carries the other.

  **What replaces `tsc`.** Every other surface here has both halves built from
  one commit, so a mismatch is a build failure and the matrix enumerates every
  pair. This one has none.

  | | |
  | --- | --- |
  | the response shape | checked at the boundary by `src/web/shell/service.ts`, which DECLARES the types and never imports them from `api/`. Importing them would put the compiler back in the loop and prove nothing |
  | the version set | the shell records `api: ["v1"]`, the service publishes `GET /versions`, and the two are intersected |
  | a slow or absent service | the page renders from the store's defaults and hydrates afterwards. A different page, never a blank one |

  **The item said "intersect at promote", and that is wrong** for §11's reason
  one step further out: a promote runs in a working tree and cannot see which
  service is deployed. The RUNNING server compares, reading the discovery
  document through `createDocumentStore` - the same cache, the same peek-never-
  wait rule, the same "nothing read yet is undecidable" answer. `x-shell-api`
  reports `ok`, the version named, or `unread`.

  **A version set is coarse and there is nothing better available.** The member
  gate takes a digest of a declaration; a service has no declaration to take
  one of. Saying that beats pretending otherwise.

  **Which versions a deploy answers is `API_SERVES` in its environment**, and
  the routes are gated on the same list - so the document cannot claim one thing
  while the service answers another. Dropping v1 is a thing an operator does on
  a Tuesday, to shells published long before that Tuesday.

  **`bun run e2e:api` moves the fourth schedule and reads what this origin
  says.** Two shells promoted to `test-qa`, then `API_SERVES=v2` on the other
  app, with no unit rebuilt and no image deployed. 12 of 12:

  ```
  the origin names the version the service no longer answers
  a visitor still receives the page
  the switcher no longer lets either shell be chosen
  choosing one of them is refused, naming the version
  ```

  Two shells, because only an OVERRIDE is refused. A channel's own pointer never
  is: taking the site down over a fourth deploy is worse than the fault it would
  be reporting. Both halves are asserted.

  **Two faults the running found.** `fetch` with a `Host` header fails TLS
  verification in Bun before the request leaves - "unknown certificate
  verification error" - so every live check carrying one uses `curl`, which is
  what the rest of the harness already did. And the first run left the deployed
  service answering only v2 for 35 minutes: `fly secrets set` returned
  `unauthorized` on a machine update and the restore in the `finally` hit the
  same. The restore now retries, reads the live document before deciding, and
  prints the command a person runs if it still fails.

  Also found: the service was running two machines, which is wrong for state
  held in memory - two machines hold two states. One now.

  What this does NOT do: persistence (the deferred question below), a member-
  level reading of the service's surface, and any check at promote time.

- **The 28 surviving mutants are gone, and 23 of them were real.** Was §22,
  opened and closed on 2026-08-29. `bun run mutate` now reports 750 of 750
  killed across all five files: `composition.ts` 267, `manifest.ts` 264,
  `html.ts` 174, `origins.ts` 42, `provides.ts` 3.

  The reading that opened it was 757 mutants with 28 survivors, all in what the
  member gate and the blocks reading had just added. The README claimed 0
  survivors, which had been true at 417 mutants and before that work.

  | Where | Survivors | What they were |
  | --- | --- | --- |
  | `provides.ts` | 3 of 3 | no test at all. Two tests |
  | `composition.ts` | 23 | 18 real gaps, 5 unreachable and excluded in place |
  | `html.ts` | 2 | the preload block. One test |

  **`provides.ts` was the sharp one.** It is what the RUNNING server judges
  every shell against, and all three mutants - a wrong file name, an emptied
  body, `??` turned into `&&` - made it read `{}`. An empty reading refuses
  nothing, so the blocks gate would have allowed exactly the shell it exists to
  refuse, and the page would still have rendered. `blocksWritten` now takes the
  file as an argument so the missing-file reading can be tested at all.

  **What the other gaps were, and they are the transferable part:**

  | The gap | What no test asserted |
  | --- | --- |
  | a guard nothing exercised | An app entry with no reading is skipped. Remove the guard and the gate THROWS rather than falling back, which is the rollback path |
  | which half refused | Both halves of the member gate name the member, so `toContain` on the name passed when the wrong branch fired |
  | the separator | `join("; ")` between two problems. A `toContain` of one problem cannot see it |
  | `some` against `every` | No fixture carried a sub-app with two SubApp halves, so needing ALL of them looked the same as needing one |
  | the preload block | Six tests read one tag each. None could see an extra entry in the list or the string joining them |

  Five were unreachable and are excluded in place with the reason: two guards
  whose next line does the same skipping, and two `?? []` fallbacks whose key
  came from `Object.keys` of the same record.

- **The server-to-shell surface has one declaration and a reading, not a
  hash.** Was §11. A hash over the blocks was the item's idea and is not what
  this needed: the two parties are a PUBLISHED unit and a DEPLOYED image, so an
  identity they must share would refuse every rollback the moment either moved.
  §9's rule fits instead - the shell reads PART of what the server writes, so
  the gate is per field.

  **The cause, counted:** each block's shape was declared twice, once on each
  side, and nothing compared them. `AppAssets` in `html.ts` and `loader.ts`,
  `VersionOption` in `composition.ts` and `versions.ts`, `BuildInfo` in
  `html.ts` and `ShellBuildInfo` in `world.ts`. Three blocks, six declarations,
  no two checked against each other - which is exactly how renaming `deployed`
  to `live` reached a channel.

  **Part one: one declaration.** `src/server/blocks.ts`, reached by
  `@pointer/blocks`, imported by both sides and by the harness. A renamed field
  is now a compile error on whichever side did not move. It sits under
  `src/server` because the image copies that and nothing else, and every import
  of it is type-only so nothing resolves the specifier at runtime.

  **Part two: the reading, because part one holds only while both sides compile
  together.** The same removal prober, on this surface:

  | | |
  | --- | --- |
  | written by the server | 19 members |
  | read by this shell | 10 |
  | read by no current shell | `BuildInfo` and its seven fields, and `VersionOption.deployed` |

  `VersionOption.deployed` is the retained field from 2026-08-28. It is now
  measured rather than asserted in a comment.

  **How it travels, and who compares it.** The server cannot derive its own
  reading - the image has a Bun and no tsc - so `bun run blocks:record` commits
  `src/server/blocks.provides.json` and `build.ts` refuses a stale one. The
  shell records what it reads in `unit.json`. The comparison is made by the
  RUNNING server, not by `promote`: a promote executes in a working tree and
  cannot see which image is answering requests. That is the piece the item
  called unresolved, and this is the answer - it was never `promote`'s question.

  | Situation | What happens |
  | --- | --- |
  | a chosen shell reads a field this server does not write | 400, and the option was already disabled in the `select` |
  | the channel's own pointer names such a shell | served, with `x-shell-blocks` naming the field |
  | a shell that records nothing | judged by nothing. The append-only rule is all that protects it |

  The middle row is a decision. Refusing a channel's own pointer would take the
  site down over a control that misbehaves.

  **Two @live scenarios and four mutations, and writing them found three more
  fixture faults.** *Choosing a shell this server cannot feed is refused* passed
  with the gate disabled, for two different wrong reasons: its fixture shared no
  contract, so the older rule refused it; and it asked before the origin's
  history had caught up, so the refusal was *not one this channel has served*.
  The fixture now inherits the served shell's contracts and members and the step
  waits for the id to be known. Two more were mine from earlier in the session:
  an id built from the pid AND the clock stopped matching the one
  `versions.steps.ts` derives from the pid alone, so the published fixture and
  the recorded one became two different things while the scenario went on
  passing; and making `recordInHistory` inherit the served entry's surface gave
  the CONTRACT-fallback fixture a member reading, which let the member gate
  allow it - the one failure in an otherwise green live run, and the only one
  of the four that a check caught rather than a mutation.

  36 @live green in 8.9 min, 31 of 52 mutations caught with none surviving,
  `bun test` 235. The two
  readings cost about 10.5 s of tsc in every build.

- **Compatibility is read from what a sub-app USES, not from one hash over the
  surface.** Was §9, and the second half went a different way than the item
  said - the vendor pin is now §21, unbuilt.

  **First half: measured on 2026-08-28, against `test-qa`. The page holds, and
  the warning at `scripts/promote.ts:332` is noise.** Preact 11.0.0-rc.1
  installed, everything rebuilt, the shell promoted beside four sub-apps
  recorded at 10.29.8.

  | What was run | Reading |
  | --- | --- |
  | build at preact 11 | shell `ff144709` → `b5a80c68`. **All four sub-app unit ids unchanged** |
  | `publish` | shell uploaded, four apps `unchanged` |
  | `promote test-qa --from-build` | the WARNING, four times |
  | the page, in Chrome, through `src/server/index.ts` | four panels render, alpha 6 + bravo 1 = charlie's total 7, delta's shares agree, 0 page errors |

  A sub-app cannot be built against a second major in any way the store can
  see: every Preact specifier is external, so its bundle carries no Preact bytes
  and its id does not move. Only the SHELL's version can differ, and the warning
  then fires for every app at once. The item's picture had it the other way
  round.

  The state that does break was reached by removing the guard in `build.ts`, not
  by changing a version. bravo bundled its own Preact (2.2 kB → 13.8 kB) and its
  panel came back as `Cannot read properties of undefined (reading '__H')` with
  a Mount again button, caught by the shell's boundary, the other three
  untouched. It THROWS on first render rather than quietly failing to
  re-render, which is what that guard's comment used to claim; the comment now
  says what was measured.

  **Second half: the question changed.** The hash asks whether two units were
  built against the SAME surface. What an operator needs is whether a sub-app
  needs anything this shell does not have. Two of `ShellStore`'s eight members
  are called by no sub-app, so the set intersection refused a removal that cost
  nothing - and it refused it because a PUBLISHED app's contract set is fixed at
  its build time and cannot name a contract minted after it.

  **Use is measured by removal, never parsed.** Cut one declaration out of the
  surface and recompile the consumers against the rest; still compiling means
  not used. Two `tsc` runs per member - one for the cut surface, one for all
  four apps at once - 11 members in about 4.3 s, in `build.ts` beside the
  matrix. `unit.json` carries `provides` on the shell and `uses` on each app,
  member path to the digest of its declaration, and `promote` needs no compiler.

  | Change to the shell | Set intersection | Member gate |
  | --- | --- | --- |
  | a member added | allowed | allowed |
  | a member removed that no app uses | refused | allowed |
  | `reset` removed | refused | refused, naming bravo and `ShellStore.reset` |
  | a parameter narrowed | refused for all four | refused for the apps that use it |

  The digest is what keeps a same-name signature change covered. The half `uses`
  cannot see - `subapp.d.ts`, which the shell requires whole - keeps its own
  identity: each unit records `subapps`, the sub-app halves of its contracts,
  and those must intersect. The contract sets remain as the FALLBACK for any
  pair where either side carries no reading, which is what keeps a rollback onto
  an old unit working. `promote` and the switcher call one function.

  **Proved end to end**, `bun run e2e:members`, 16 checks green against the real
  store: `reset` removed, the shell published alone, the four apps untouched.

  ```
  bravo uses ShellStore.reset, which this shell does not have. Nothing was changed.
    shell   0523e568  10 members provided
    alpha   e34063ba  6 members used
  ```

  The contract sets in that run were `4cdfc87` and `e0160a6` - disjoint - so the
  old rule refused alpha, charlie and delta too, none of which called `reset`.

  **Five falsify mutations cover the new rule, and writing them found two
  faults in the checks themselves.** Both were mutations that SURVIVED and were
  then fixed:

  | Fault | What it was |
  | --- | --- |
  | the scenario's assertion was too loose | It read the member's name, and both halves of the gate - `held === undefined` and `held !== digest` - name the member. Disabling one branch left the other producing a message the assertion accepted. It now reads the exact half |
  | a `find` string matched two places | `"if (refusal !== null) {"` also matches `sourceRefusal`'s branch, so the mutation patched the wrong `if` and the scenario went red for a reason nobody aimed at. `falsify` now REFUSES a `find` that matches more than once, which is the general form of the fault |

  34 @live green in 6.9 min when this landed, `bun test` 227. Both counts moved
  again under §11; the current ones are in that entry.
  `bun test` now names `scripts` for `falsify` too.

- **The live switcher check reports what it cannot decide.** Was §20. Option
  three, as the item recommended: the render comparison now has three states
  rather than two. It reports UNDECIDED — the way `falsify` reports a mutation
  nobody ran rather than counting it as passing — and it stays a FAILURE when
  the check above it did not pass. That check, the page fetching the chosen
  unit's own file, is what establishes which unit ran; without it an identical
  page is a switcher that ignored the choice. Bytes were not compared, because
  comparing them stops proving that the running code differs and only proves
  the file did.

  | Run on 2026-08-28 against `qa` | Result |
  | --- | --- |
  | alpha, bravo, charlie, delta | SUCCESS, 1 undecided each, exit 0 |
  | the fetch check forced red, same identical render | FAILED, exit 1 |

  **A second non-fault was found while verifying the first, and it blocked the
  check entirely.** The first run reported *no switcher at all* and told the
  operator to publish a change and promote it. The history is read with `peek`
  and never `get`, so the first request after a server starts has no switcher
  and the next one does — by design, and the README already said so. The page
  carried two generations of all five units at that moment. The script now
  reloads once before calling an absent switcher a fault, and names which of
  the two causes it saw when the switcher is still absent after that.

- **The direction of a surface change is read at mint.** Was §8. The hash says
  a surface changed and says nothing about which way, so `tsc` is asked, out of
  the machinery the matrix already had: two generated probes, compiled the way
  `cell()` compiles a matrix cell, between the new surface and each retained
  contract. The direction REVERSES between the halves, because a sub-app
  consumes the shell API and produces a `SubApp`. Both compile: additive.
  Either fails, and `contract:mint` names the half, says whom it breaks, and
  prints what `tsc` said. A warning and never a refusal — `promote` refusing an
  empty intersection is what stops a breaking change reaching a channel.

  Measured on 2026-08-28, against generated pairs of surfaces and against the
  two contracts this repository has actually published:

  | Change | shell half | sub-app half |
  | --- | --- | --- |
  | nothing | pass | pass |
  | an export added | pass | pass |
  | a second prop on `SubAppProps` | pass | pass |
  | an export removed | `TS2741` | pass |
  | a parameter narrowed | `TS2322` | pass |
  | a required member added to `SubApp` | pass | `TS2322` |
  | a type export renamed | pass | `TS2305` |
  | `9e79879` → `e0160a6` | `TS2740` | `TS2322` |

  **Both traps the item named reproduced, and a third one was found.** A
  module-level probe reads the sub-app half as additive whatever happens,
  because `subapp.d.ts` exports a type and no value and its module shape is
  empty; the sub-app half names the type. A script had no test home, and `bun
  test` now names `scripts` beside `src/web`.

  The third was invisible from the item: **`skipLibCheck` hid the type-only
  half of the surface.** A module shape carries values, so a removed or renamed
  TYPE export read as additive — the `TS2305` lands inside a `.d.ts` and is
  skipped, and both `SubApp`s then degrade to something permissive. The probes
  turn it off, which is the `TS2305` row above; on this project it raises no
  error from `node_modules`.

  Cost: about 1.2 s a comparison, against 0.3 s with `skipLibCheck` on. One
  comparison at a mint. Eight in `scripts/contract.test.ts`, which is about
  15 s of a 19 s `bun test` — the probes load no ambient package (`types: []`),
  which took that from 26 s.

- **The suite runs on Playwright, through `playwright-bdd`.** Was §1. Not one
  `.feature` file changed: `playwright-bdd` supports a cucumber-style world, so
  `this` is still the `PointerWorld` and the Gherkin parameters are still the
  arguments. One runner, not two - the @local and @live scenarios moved with the
  browser ones, which was the trap the item named.

  **It still runs on Bun, and how the runner is STARTED decides that.** Measured
  in a scratch project before any of this was written, because the difference is
  invisible until the harness fails to import itself:

  | Command | The workers run under |
  | --- | --- |
  | `bun x playwright test` | Node. No `Bun` global, no `bun:test` |
  | `bun node_modules/@playwright/test/cli.js test` | Bun, `process.versions.bun` set |

  The second is what the scripts use, the same long form `verify` already used
  for cucumber's own bin. Had it been the first, the port would not have been
  ~400 lines of bindings: it would have meant taking `world.ts`, `http.ts`,
  `stub-store.ts`, `scripts/store.ts` and `scripts/contract.ts` off Bun, and
  those last two are the files `build`, `publish` and `promote` run.

  **Of the three things this was expected to buy, two arrived.** Traces and
  screenshots are retained on failure. PARALLELISM is not available and that is
  not a configuration away: the live scenarios promote to two channels the suite
  shares and `world.ts` keeps one module-level map of build name to unit ids, so
  two at once would race on the pointer and the failure would read as
  propagation. `workers: 1`, with the reason written at the setting. Making
  @local parallel is possible - each starts its own stub store and server on
  port 0 - and it is its own piece of work.

  **It found a defect in the deploy tripwire.** Playwright reports a failed
  `beforeAll` against the first test of its FILE and carries on with the other
  files. A dropped connection while reading the baseline therefore left the
  guard with nothing recorded, 15 scenarios ran unguarded, and `AfterAll`
  compared `undefined` against what the channels served and printed *the live
  suite moved 2 real channels. That is a deploy* - the most alarming sentence
  this suite can produce, about a run that deployed nothing. Three changes: a
  missing baseline is its own message and is not called a move; the baseline is
  taken by every live scenario's own `Before` rather than once; and
  `pointerBuildId` retries a request that gets no answer, the way the suite's
  other live requests already do.

  **It found a second thing, and this one had been true all along.** Playwright
  sets `FORCE_COLOR` for its workers, Bun colours `console.error` when it sees
  it, and `run` in `features/support/http.ts` passed `process.env` to every
  child process the suite spawns - then parsed what came back. So
  `"  alpha  f4ba63c3  uploaded 3 files"` arrived as
  `"\u001b[0m\u001b[31m  alpha ..."`, which trims to an escape sequence rather
  than to a unit name. ONE assertion broke, the one reading the first word by
  position; every other reader used `includes` and went on passing against
  output it could no longer parse, which is the worse half of the same fault.
  A child process whose output the suite reads now gets `FORCE_COLOR=0` and
  `NO_COLOR=1`, in `run` and in `spawnServer`.

  `falsify` drives the new runner too, and its check got stricter on the way: it
  used to accept any output carrying a scenario count, and it now refuses a
  title that matches NO scenario - which would have reported a mutation as
  caught by a scenario nobody ran. A Scenario Outline matching several examples
  is legitimate and the count is printed.

  21 @local in 7.9 s, 18 @browser in 1.1 min, 33 @live in 6.3 min, 26 of 44
  falsify mutations - all green on the new runner. The browser suite is about
  half what it was: the browser launches once per worker and each scenario gets
  a page, where the harness used to launch a Chrome per scenario.

- **The shared store is proved from this tree, not only from the deploy.** Was
  §19. `features/shared-state.feature` is three Rules now, and which composition
  a scenario reads is the difference between them: the first reads the DEPLOYED
  bundles at the live address, the second builds and promotes from the working
  tree and reads those. Two scenarios copied, never moved - trading a deploy
  check for a code check would have lost what the first Rule is good at.
  Two falsify mutations, and the second measurement is the one that matters.
  `snapshot` returning zero for every namespace, and `user()` reading `peek()`
  instead of `.value` so nothing subscribes, each redden their @test-channel
  scenario. Run against the DEPLOYED copies of the same two scenarios, the
  `peek` mutation left both GREEN - which is section 19's claim, measured
  rather than argued.
- **One `VIEWS`, exported, and checked against the units at build time.** Was
  §14. `src/web/shell/views.ts` holds the table; `Shell.tsx` draws its tabs and
  its panels from it, and `features/steps/shared-state.steps.ts` imports it
  instead of keeping a second copy of the paths and the app lists.
  `placementProblems` runs in `build.ts`, on the bytes being published, and
  refuses a build where a unit is emitted that no view places, or a view places
  an app nothing builds. Seen refusing: dropping charlie from `/totals` stops
  the build and names charlie. Six unit tests, one falsify mutation, and a test
  home - `bun test` now names `src/web`, which is what §8 needs too.
  NOT covered, and asserted so it is not mistaken for coverage: the ROUTE. The
  two sets are equal whichever route each app sits on, so a move from `/totals`
  to `/` is invisible to this and only a scenario catches it.
- **Shared state stays in `api.ts`, and the rule is written where it applies.**
  Was §15. The rule is in `api.ts` itself: shared state is declared there, a
  sub-app publishes none, and an addition is additive and cheap. The two
  overstatements are corrected in `versions.ts` and in the switcher entry
  below, and the same sentence was carried by the README, which is corrected
  too. What is NOT covered is written beside the rule: nothing stops two
  sub-apps agreeing through `window`, `localStorage`, an event or a `data-`
  attribute, `specifiersIn` reads imports and nothing else, and a scan for
  those could warn and could never prove.
- **A sub-app's files are warmed before its view is opened.** Was §17.
  `renderShell` emits `<link rel="modulepreload">` per app script and
  `<link rel="preload" as="style">` per stylesheet, from `appUrls(served)` and
  `moduleIntegrity(served)` - the SERVED composition, so an overridden unit
  warms the file that page will really fetch. Never a background `import()`:
  that would EVALUATE a sub-app the visitor never opened, and when a module's
  top-level code runs is a behaviour a sub-app can notice.
  All four checks measured, none assumed, by `bun run measure:preload` - which
  runs the server from this tree against the real store, drives a real Chrome,
  and repeats itself with the tags removed as a control:

  | Check | Reading |
  | --- | --- |
  | The policy | No refusal. `script-src` and `style-src` are already derived from the same origins, so a modulepreload and a style preload need no change |
  | The digest | Each off-screen bundle and stylesheet fetched exactly ONCE across the navigation. The import reuses the preloaded response |
  | The composition | From `served`, held by a unit test that overrides a unit and asserts the preload follows it |
  | The cost | 4 modulepreload and 4 style preload tags per load. The extra over doing nothing is the other view's two bundles and two stylesheets |

  One scenario was written, measured, and DELETED before it was trusted:
  "opening a view costs no further request for its bundles" is green with the
  preload tags and green without them, because the control shows the count after
  the navigation is 1 either way. It discriminated nothing. The question it was
  asking needs a control, so it lives in the script and not in the suite.
  What survives in the suite is the reading the control does move: the bundles
  for a view nobody has opened have been fetched, and no sub-app on that view
  has run. One falsify mutation drops the tags and reddens it.
- **Sub-apps are components, and the store is injected.** Was §18. A sub-app
  default-exports a Preact component taking one prop and no longer exports
  `mount(el)` or imports the store. Three measurements drove it, none argued:
  the shell could not catch a sub-app's later render throw - it reached
  `window.onerror`, and the same boundary caught it once the sub-app was a child
  of the shell's tree; a Provider in the shell reached nothing inside a separate
  root, because Preact context travels down the vnode tree; and a module-level
  store cannot be substituted.
  No backwards compatibility, by decision. Contract `9e79879` is unretained and
  every unit is republished at `e0160a6`; the old contract's directory is kept
  as the record of what was.
  The surface carries no signal types: every `ShellStore` accessor reads a
  signal's `.value` inside itself, which subscribes the rendering component, so
  `@preact/signals` never enters the hash. `ComponentType` is the one vendor
  type left and it is REFERENCED, not inlined - §9 is where that gets pinned.
  `SHARED` drops `@pointer/shell`, because a runtime import of it could only be
  a call to `createStore()` and a sub-app rendering against a store nobody else
  can see is the bug this design removes. `build.ts` requires
  `preact/jsx-runtime` instead of `preact`.
  One thing the refactor changed and the suite caught: `mount(el)` called
  `register(NS)` synchronously before the first render and a component cannot,
  so a panel listing every namespace drew one short for a frame.
  `useLayoutEffect` lands it before paint and the assertion waits for the set to
  converge. Found by a real scenario against a promoted composition, not by
  reading.
  21 local, 33 live, 16 browser scenarios and 184 unit tests green; `e2e` green;
  25 of 38 falsify mutations run and caught, 13 skipped without `FALSIFY_LIVE`.
  `src/server` is untouched, so its 100% mutation score stands.
  The store sweep is done: `bun run sweep --delete` removed 2849 objects no
  channel could serve, on 2026-08-28. It still has no 90-day floor, which is
  what section 5 is waiting for before it runs on a schedule.
- **A `throw` control and a boundary that catches it.** Was §7. One per sub-app
  and one on the frame, each throwing during render - a throw from a click
  handler reaches no boundary at all and a control that proved the wrong thing
  would be worse than none. A sub-app's throw costs one panel and offers "mount
  again", which resets the boundary and remounts; it does NOT re-fetch, because
  a browser will not evaluate a module URL twice, and the control says so. The
  frame's boundary offers a page reload, because the code that would draw
  anything smaller is the code that threw.
  Three `@browser @test-channel` scenarios, and the tag matters: their
  Background builds and promotes from this tree, because the boundary lives in a
  CLIENT bundle and a browser reading a composition this run did not build would
  load the unmutated file and stay green for the wrong reason. Two falsify
  mutations, each verified to turn its scenario red.
- **The shell is compiled against the sub-app half.** Was §16. `loader.ts` took
  `SubApp` from a relative path, so no file in `src/web/shell` resolved
  `@pointer/subapp` and the matrix re-pointed a specifier the shell never used -
  a required prop could be added, used by the shell, and every published sub-app
  stayed promotable. Measured: adding `name: string` to `SubApp` and reading it
  in the shell left both cells passing. `loader.ts` and `shell/contract.ts` now
  import the specifier, and `contract.ts` asserts the props the shell passes.

- **A version switcher on the page.** An operator runs an older unit on a
  channel without promoting it: `?alpha=36226fb9`, a `select` per unit in the
  shell, and choosing what the channel already serves removes the parameter so a
  shared link keeps following the channel. `promote` writes
  `manifests/<region>/<channel>.history.json` beside the pointer it already
  owns, so the record has one writer and cannot race a `publish`; the served id
  goes to the head, so the depth cap of 20 prunes from the tail and never takes
  what is live. It is written BEFORE the pointer and never allowed to fail a
  promote. The whole composed unit travels in it with its contract set, so the
  server needs no second fetch and can say which options are impossible. Two
  refusals: an id the channel never served, which is what stops the query string
  serving any object in the store, and a composition with no shared contract -
  the same rule `promote` applies, now in `src/server/composition.ts` because
  the runtime image copies `src/server` and nothing else. An impossible option
  is DISABLED and not hidden. There is no flag: the project exists to show the
  approach, and nothing about the switcher is a way in - an id the channel never
  served is refused, and the shell is `no-store`. The history is read with
  `peek` and never `get`, so a cold one costs the control and never a wait; a
  cold manifest is worth waiting for and a cold history is not. The policy and
  the digests came free. Six scenarios, four falsify mutations, 608 mutants and
  0 survivors.
  `scripts/e2e-version-switcher.ts` drives it on the LIVE site in a real
  browser, which the @browser scenario cannot: that one runs the entry point
  from this tree and proves the CODE, and this proves the DEPLOY. It reads and
  never writes, so it is safe against a real channel at any time.
  One dead end, inherent: the control lives in the shell, so choosing a shell
  published before the switcher serves a page with no control. The options block
  is still in the HTML; the older bundle does not read it. The way back is to
  remove the query parameter, and nothing on the server can fix it - the code
  that draws the control is in the unit being rolled back.
  Not built, on purpose: a `select` INSIDE each sub-app. That needs an export on
  `api.ts` or `subapp.ts`, and the contract hash is taken over exactly those two
  files - so it mints a new contract, and every unit has to be rebuilt before it
  can claim the new one. Corrected on 2026-08-28 by section 15's measurement:
  an ADDITIVE export does not force a republish and does not make any id already
  in a history unselectable. A removal or a narrowing does. A change to make
  deliberately, not a side effect of adding a control.
- A shell unit with no stylesheet now links no stylesheet. `assetUrls` joined
  the shell's base against `css ?? ""`, which is the unit's own DIRECTORY, so
  the page linked a directory listing as its stylesheet and the browser would
  parse it as CSS. `ComposedUnit.css` is `string | null` and nothing `build.ts`
  emits looks like this, so no channel has ever served it - which is why it is a
  unit test and not a scenario. The tag is dropped instead, the same way the
  import map and the app list are. Two unit tests and a falsify mutation hold
  it, and the policy still names the origin the script is fetched from. The
  `if (!url) continue` guard in `assetOrigins` now takes real input and is still
  excluded from mutation: `new URL(null)`, `new URL(undefined)` and `new URL("")`
  all throw into the same catch, which adds no origin either, so removing the
  guard cannot change the answer.
- Per-unit deploy and rollback. Five units publish and promote on their own.
- Manifest schema 3: each unit carries its own `assetBase`.
- Contract hash sets, generated by a `tsc` matrix. `promote` refuses an empty
  intersection.
- `qa` and `prod` both moved onto schema 3.
- The live suite has its own `test-qa` and `test-prod`, so it no longer deploys
  to visitors.
- `promote --from-build` refuses a harness build on a real channel. Three
  scenarios and three `falsify` mutations hold it. 16/16 mutations caught.
- Browser steps match assets by file name, so a schema change does not silently
  match nothing.
- A kept schema 2 manifest in the store, and two `@browser` scenarios that point
  `test-qa` at it and read the rendered page. Two falsify mutations hold them.
  Written by `bun run fixture:schema-2`; nothing rebuilds it per run.
- A digest per file, and a Content-Security-Policy. `build.ts` takes a sha384 of
  every file it emits; the digests travel with the unit through `publish` and
  `promote`, so a rollback keeps its own. Three carriers, because three
  mechanisms fetch the files: the tag for the shell's two, the import map's
  `integrity` section for every other script, and the `__APPS__` block for a
  sub-app's stylesheet. The policy is derived from the manifest, and the import
  map is allowed by the hash of its own bytes rather than `'unsafe-inline'`.
  Five scenarios and seven falsify mutations hold it. 25/25 mutations caught.
  On the deployed image, so the two scenarios that read the served HTML assert
  against it as `@live` and not only `@local`.
- `promote --from-build` refuses a build this working tree did not make. Two
  readings: the build came from another commit, or from an uncommitted tree.
  Neither carries a marker, so the harness guard could not see either. `build.ts`
  records the source beside the build and `publish` copies it onto the unit
  rather than asking git a second time — asking at publish time answers a
  question about the tree and not about the bytes, so build, commit, publish
  used to leave a unit claiming a commit that does not hold its own source.
  `--no-source-check` overrides the refusal and prints what it let through.
  A tree that is dirty *now* is deliberately not a refusal: a clean build at
  HEAD is exactly commit HEAD however much has been edited since. Five
  scenarios and five `falsify` mutations hold it. 30/30 mutations caught.
  Still not held by anything: `publish` upgrading a dirty record when a clean
  tree later produces the same bytes. Staging it needs the harness to dirty
  the tree.
- The server logic at a 100% mutation score: 417 mutants, 0 survivors, across
  `manifest.ts` (from 61.86%), `html.ts` (from 87.33%) and `origins.ts` (from
  68.09%). 44 more unit tests. Nine survivors were excluded rather than chased
  and each carries its reason. The gaps that were real: attribute escaping was
  never tested, so a file name carrying a quote could leave its attribute; a
  digest was matched by `.js` anywhere in a name rather than at its end, so a
  source map got one; the policy's origins were never compared in order, so the
  sort could go; six of ten Fly regions had no test, and the six mapping to
  `eu` cannot be told from the fallback by what they RETURN — only by the
  warning the fallback prints. See the README for the three kinds of survivor.
- `manifest.ts` at 100% mutation score, from 61.86%. 33 more unit tests, and a
  changed assertion shape: a rejected manifest must throw the PARSER's error,
  anchored, naming the field an operator has to fix. `toThrow("apps.alpha")`
  passed on any throw carrying that text, including the TypeError one line
  further in that a deleted guard produces. Six survivors were excluded rather
  than chased, each with its reason on the line above it. Two tests were green
  for the wrong reason: the non-2xx case sent a body that was invalid anyway,
  so the status check could be deleted and nothing noticed; and every timing
  test named its own TTL and timeout, so neither default was ever run.
