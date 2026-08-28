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
| Contract | `9e79879` |
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

### 19. Nothing proves the shared store from this tree

`features/shared-state.feature` carries `@browser` and NOT `@test-channel`, so
`originFor("qa")` returns the live address and the scenarios read the DEPLOYED
composition. That makes them a check on the deploy, which is worth having, and
it means no scenario proves the shared store from the working tree: a change to
`createStore` is caught only after it is published and promoted.

Found on 2026-08-28 by misreading those scenarios as proof of a change that was
not deployed yet. They passed, against the old build.

The fix is a second, `@test-channel` copy of the two scenarios that matter - a
count raised in one sub-app read by another, and the name reaching every panel -
not moving the existing ones, which would trade a deploy check for a code check.

### 1. Port the suite to `playwright-bdd`

The `.feature` files do not change; the bindings and runner do. Buys traces,
screenshots on failure, parallelism. Costs ~400 lines across five step files.
Trap: the non-browser suites spawn a Bun server and shell out to
publish/promote, so they must move too or the project runs two runners.

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

Both leads are refuted by measurement, and the lagging hop is named. What is
left is one unrun experiment.

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

The next failure says which hop it is without another investigation. Every
shell now carries `x-manifest-age` and `x-manifest-refresh`, and the suite
quotes both beside what the store holds:

| The origin says | What it means |
| --- | --- |
| age under the TTL, wrong composition | the store answered with the old document |
| age far above the TTL, refresh `ok` | the origin stopped refreshing. Rule 9 |
| a named error | the refresh is failing and the last good build is being kept |

Row 3 of the old table - `Republishing reported 0 of 5 units unchanged` - did
not reproduce and is not explained. Its assertion now carries publish's whole
output, which names which of contracts, digests or provenance moved.

### 8. A build-time reading of whether a contract change is additive

The hash changes when the type surface changes and says nothing about the
direction. `tsc` answers it with the machinery already in `scripts/contract.ts`
— two generated probes, compiled the way `cell()` compiles a matrix cell,
between a new surface and each retained contract:

| Half | Who consumes it | The probe |
| --- | --- | --- |
| `shell.d.ts` | sub-apps | `const o: typeof import("<old>/shell.d.ts") = <new module>` |
| `subapp.d.ts` | the shell | `const s: New.SubApp = <an old SubApp>` |

The direction reverses between them because sub-apps CONSUME the shell API and
PRODUCE a `SubApp`. Both compile: additive. Either fails: `contract:mint`
names which half broke and for whom, before a promote refuses on an empty
intersection.

Measured on 2026-08-28, not assumed. Against a scratch pair of surfaces, the
shell probe passed on an added export and failed on both a removed one
(`TS2741`) and a narrowed parameter (`TS2322`). The sub-app probe failed on a
required member added to `SubApp`, which is the change that breaks every
sub-app already published.

A warning and never a refusal. A breaking change is a legitimate thing to
mint; the promote's intersection rule is what stops it reaching a channel.

Trap, and it reproduced: `subapp.d.ts` exports a type and no value, so
`typeof import(...)` gives an empty module shape and the module-level probe
PASSES on a `SubApp` that gained a required member. The sub-app half must name
the type, never the module.

Second trap: `bun test` runs `src/server` and `features/support`. A script has
no test home, so this needs the `test` script extended.

### 9. Measure what a vendor major mismatch actually breaks

`scripts/promote.ts:332` warns when a sub-app was built against a different
major from the shell's, and the comment beside it gives the reason for not
refusing. The undecided part is not the refusal. It is what breaks.

So: publish one sub-app against a second Preact major, promote it past the
warning, and read the page. The import map resolves every bare specifier
against the SHELL's base — `importMap` in `html.ts` joins against
`m.shell.assetBase` whichever unit a sub-app came from — so a second copy only
reaches the page when that sub-app stops treating the specifier as external
and bundles its own. That is the state to reach: two signals runtimes, and
counters that stop agreeing.

Both outcomes are worth writing down. Either the page holds and the warning is
noise, or it splits and the refusal at `promote.ts:332` has a measured reason
instead of a guessed one. Facades are the next question and not this one.

Trap: this is a deliberately broken publish. `test-qa`, never `qa`.

**Second half, added by §18: pin the vendor types the contract REFERENCES.**
Once `subapp.ts` says `import type { ComponentType } from "preact"`, the emitted
`subapp.d.ts` carries that line and nothing more - measured on 2026-08-28, the
type is referenced and not inlined. So a matrix cell resolves `preact` from
`node_modules` at HEAD, and the hash claims a coverage it does not have: a
Preact release could change what `ComponentType` means with every retained
contract keeping its hash.

The fix is to copy Preact's own `.d.ts` into each contract directory and point
the cell's `paths` at that copy, the way `shell.d.ts` and `subapp.d.ts` are
already pointed. Then the hash covers it.

`scripts/contract.ts:16-21` gives the reason vendors were excluded: folding
their versions in would force every app to republish on a patch bump. §15
measured that and it is not so - an additive type change mints a new contract,
the old one stays retained, and every published unit stays promotable. So the
stated reason no longer holds and the exclusion should be revisited with the
measurement in hand.

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

### 11. A hash over the server–shell surface

Three blocks — `__BUILD__`, `__APPS__`, `__VERSIONS__` — written by
`src/server/html.ts` and parsed by `Shell.tsx`, `loader.ts` and `versions.ts`.
The contract hash covers `api.ts` and `subapp.ts`, which is the shell's surface
with its sub-apps. This one is the shell's surface with the SERVER, and nothing
covers it — the server is not a unit, so `promote` has nowhere to look.

Demonstrated on 2026-08-28, not hypothetically: renaming `deployed` to `live`
in `__VERSIONS__` broke shell `606c1c3c`, which the switcher offers. It read
`deployed`, got undefined, and pinned the query parameter where it should have
cleared it. The page rendered and the composition worked. The field is retained
and the rule is written down — these blocks are append-only — but a rule in a
comment is what the contract exists to replace.

The shell reads JSON out of the DOM, so there is no type surface `tsc` emits.
Two ways:

a. A hand-written declaration file both sides import — the server's writers
   typed against it, each shell parser returning it. `tsc` proves each side and
   the file's hash travels with the shell unit. Cheap, and it holds only while
   both sides keep importing it.
b. `src/server/blocks.ts` exporting the three block types, with the surface
   emitted the way `emitSurface` already emits the other one. The same
   tsc-as-oracle argument, one layer out.

Then the piece the design has no slot for: `promote` compares the shell unit's
block hash against the SERVER's, and the server is deployed by `fly deploy`
and carries no unit id. `/healthz` reporting its block hash, read by `promote`,
is one way. Unresolved, not solved.

Proof is already written: the 2026-08-28 rename is the falsify mutation, and
the promote must refuse it.

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

### 13. A contract against an external API

Stated under Open questions. Add a small REST API and drive the values already
on the page from it — `user` and `counters` in `src/web/shell/api.ts` — so the
hash-set argument can be tried against a service the units do not build
alongside.

What makes it different: both halves of the current contract are compiled from
this repo at one commit, so `tsc` is the oracle and the matrix is complete. A
service deploys on its own schedule and its surface is not a TypeScript file.
The demonstration is whether the argument survives losing the compiler:

- the response shape has to be checked at runtime, at the boundary, because
  nothing compiles what the service actually returns;
- the API versions a unit works against are a second set to intersect at
  promote, beside the contract set;
- the service is a fourth deploy schedule, so "which combinations were ever
  tested" is the same question one dimension larger.

Where it goes is a decision to make before writing any of it: `src/server` is
copied into the runtime image by the Dockerfile and holds the shell's
templating only. A second Fly app, or a second route here.

The largest of these. §8 and §12 come first — one gives the additive reading
this needs per API version, the other says when a version can go.

### 14. One `VIEWS`, checked against the manifest

Decided on 2026-08-28: the shell owns placement. That was already true and had
never been written down. `scripts/contract.ts:29` names the units, `build.ts`
emits what that names, and `Shell.tsx:7` decides which of them appear, on which
route, in what order. The manifest names bundles and chooses nothing.

Three things follow. The first two are the price of the answer and are accepted:

- a layout change is a shell publish and a promote, so alpha cannot move from
  `/` to `/totals` by pointer;
- rolling the shell back rolls the layout back with it, because they are one
  unit;
- the layout is written down twice - `Shell.tsx:7` and
  `features/steps/shared-state.steps.ts:9` - with nothing tying the copies
  together. That is the harness holding its own copy of what it checks.

Work: export `VIEWS` from the shell, have the step definitions import it, and
check at build that every app the manifest names is placed by some view and
every placed app is in the manifest. An app the manifest names and no view
places is fetched never and nothing reports it; the opposite case is already
reported, by `Slot`.

What the check does NOT cover: the ROUTE. Moving charlie from `/totals` to `/`
leaves the set identical, so only a scenario catches it.

Trap: the harness importing `VIEWS` from the working tree does not remove the
coupling to the deployed shell - a `@live` scenario runs against a PUBLISHED
shell that may place apps differently. It removes the drift between two copies
in one tree, which is a smaller claim than it looks. The build check is what
covers the published pair, because it runs on the bytes being published.

Same test-home problem as §8: this is build-time code and `bun test` runs
`src/server` and `features/support`.

### 15. Shared state stays in `api.ts`, and that is written down

Decided on 2026-08-28. A sub-app cannot publish state for another sub-app. The
shell declares every shared value in `src/web/shell/api.ts`, the contract hash
covers it, and `build.ts:233` refuses any specifier outside `SHARED` - so
app-to-app imports are already impossible, with the reason beside the check.

The premise this was decided against was wrong twice, so both corrections
belong here.

**Signal identity already works.** `user` and `snapshot` are `Signal` objects
imported from `@pointer/shell`. Every sub-app holds the SAME object, because the
import map resolves the specifier to one URL. What was missing is a sub-app
PUBLISHING one, and that is what this decision refuses.

**The price is smaller than the code claims.** Measured on 2026-08-28 by
compiling the shell and alpha against contract `9e79879` with the surface
changed:

| Change to `api.ts` | shell x 9e79879 | alpha x 9e79879 | Promote |
| --- | --- | --- | --- |
| baseline | pass | pass | allowed |
| one export ADDED | pass | pass | allowed |
| one export REMOVED | fail | pass | refused, correctly |

So an additive export does NOT force every unit to be republished and does NOT
make any id in a history unselectable, as long as the old contract stays
retained. `shell/contract.ts:15` already says why - "Extra exports are fine" -
and it holds. `versions.ts:6` and the version-switcher entry under Done both
overstate it and should be corrected.

Work, now that the answer is chosen:

- correct the two overstatements above;
- write the rule in `api.ts` itself: shared state is declared here, a sub-app
  publishes none, and an addition is additive and cheap.

Amended the same day by §18: the store is still DECLARED by the shell, and a
sub-app now receives it rather than importing it. That answers the one real
objection to this decision - a module-level singleton cannot be substituted for
a test - without moving where shared state lives.

What is NOT covered, and is the real hole in "shared state is declared in
`api.ts`": nothing stops alpha writing `window.__alpha` and bravo reading it, or
the two agreeing through `localStorage`, a custom event or a `data-` attribute.
`specifiersIn` reads imports and nothing else. A scan of the emitted bundle for
`window.`, `localStorage` and `dispatchEvent` would warn and could never prove
- a computed property access defeats it. Say that when writing it, or the
warning reads as a guarantee.

Accepted and not fixed: `counters` is one signal holding a map, so there is no
`Signal<number>` per namespace and an app cannot hand "the alpha counter" to
anything taking a signal. `api.ts` gives the reason - the key set has to be
reactive too.

### 17. Load an unrendered app's files in the background

`Slot` calls `loadApp` from a `useEffect`, so a sub-app's bundle and stylesheet
are fetched when its view first appears. Moving from `/` to `/totals` waits on
a network fetch of charlie and delta that could have happened while the visitor
was reading the first view.

The mechanism to prefer is `<link rel="modulepreload">` per app script and
`<link rel="preload" as="style">` per stylesheet, emitted by `renderShell` from
data it already has - `appUrls(served)` and `moduleIntegrity(served)`. It warms
the cache without EXECUTING the module, which a background `import()` would not:
evaluating a sub-app the visitor never sees changes when its top-level code
runs, and that is a behaviour a sub-app can notice.

Four things to check, none of them assumed:

| | |
| --- | --- |
| The policy | `script-src` already lists every asset origin, derived from `appUrls`. A `modulepreload` should be allowed with no policy change. Verify rather than assume |
| The digest | `modulepreload` takes `integrity`, and the import map's `integrity` section covers the same URLs. Confirm the browser does not fetch twice |
| The composition | The URLs must come from `served`, not from the channel's manifest, or an overridden unit preloads the wrong file |
| The cost | Four apps here. Preloading every app on every load is bandwidth a visitor who never navigates does not use. A deliberate list, not "everything" |

`loader.ts` needs no change: `addStylesheet` and the `loading` map still run at
mount, and a preload only warms the HTTP cache.

Proof: a `@browser` scenario that navigates to `/totals` and asserts NO network
request is issued for charlie's bundle. Falsify by dropping the preload tags -
that scenario must go red, and the tag-presence one with it.

## Open questions

One left. What was scoped is now §7 to §18 above; §14 and §15 were answered by
reading what the code already does, and §16 is a defect that reading found.

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
  NOT done: the store sweep. `bun run sweep` reports 2849 objects no channel can
  serve and `--delete` carries it out.
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
  files - so it changes the hash, forces every unit to be republished, and makes
  every id already in a history unselectable until they are. A change to make
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
