# pointer-deploy

A Preact single-page app whose server holds none of its files.
Deploying it writes one JSON file.

Live: <https://pointer-deploy.fly.dev/>

## What this demonstrates

A normal single-page app pipeline treats the app and the thing that serves it as
one artefact. Change a button label and you build a container image, push it to
a registry, and roll out new machines. Rolling back means doing all of that
again with an older commit.

They do not have to be one artefact. The server can do routing and templating
only, and read which version of the app to serve, per request, from a file.

| On every app change | Normal pipeline | Here |
| --- | --- | --- |
| Build the app | yes | yes |
| Build a container image | yes | no |
| Push it to a registry | yes | no |
| Restart or replace machines | yes | no |
| Change what visitors get | the rollout | one JSON write |
| Roll back | redeploy an older image | write the older JSON back |
| A preview environment | a whole stack | one more JSON file |
| Ship one panel of the page | the whole page ships | one field in that JSON |

So a deploy is this, and nothing else:

```sh
bun run promote qa --app alpha=9b855c4b
```

That moves alpha. The shell and the other three sub-apps stay exactly where
they were, and rolling alpha back afterwards leaves alone whatever was deployed
in between.

### The page is five bundles that agree with each other

The shell owns the state — a name, a colour, and a map of namespaced counters.
Four sub-apps read and write it. Two appear on the counters view, two on the
totals view, and the second pair reads counters the first pair created without
the two pairs ever being on screen together.

Each sub-app is its own **unit**: its own bundle, its own stylesheet, its own id,
published and promoted on its own and fetched when its view first needs it. That
is in tension with sharing state: a sub-app carrying its own Preact would have
its own signals runtime, and the shell's counters would silently stop
re-rendering it. So exactly one thing is shared, and the manifest carries it:

| | How |
| --- | --- |
| Shell, store, and one entry per shared specifier | One `Bun.build` with splitting, so Preact lands in a single chunk every entry reaches |
| Each sub-app | Its own `Bun.build` with those specifiers `external` |
| Joining them up | The manifest's `imports` becomes the page's import map |

`build.ts` refuses a sub-app that imports anything the import map does not name,
or that stopped importing `preact` and `@pointer/shell` by name. Either means it
bundled its own copy.

That this matters was measured, not assumed. Bundling Preact into each app turned
4 of the 6 browser scenarios red when it was tried.

### What happens on a request

```mermaid
sequenceDiagram
    participant B as Browser
    participant S as Bun server, one image
    participant T as Object store

    B->>S: GET / with Host qa.example.com
    Note over S: Host picks the channel
    S->>T: GET manifests/eu/qa.json
    T-->>S: which unit is live, per unit
    S-->>B: HTML naming each unit's own files
    B->>T: GET units/shell/43ca0019/index-3wgagyzf.js
    B->>T: GET units/shell/43ca0019/index-rc565c4j.css
    B->>T: GET units/alpha/9b855c4b/alpha-z9ev874b.js
    B->>T: GET units/bravo/483316f3/bravo-4vf0ywmv.js
```

The server never holds a script or a stylesheet. It is asked which units are
live, and it writes an HTML page pointing at each of them. Promoting a different
unit changes one answer to that question, so the next visitor gets a different
app from the same running machine — and only the part that moved is different.

Note the last two lines. Alpha and bravo come from different directories,
written at different times. **One `assetBase` per unit is the whole feature.**
Schema 2 had one base for the entire page, so every file had to come from one
build directory, which is what made the five bundles deploy and roll back
together.

### What it costs

| | |
| --- | --- |
| A visitor waits for a manifest read | No. It is cached 10 s and served stale while it refreshes |
| A deploy is instant | No. 7.1 – 10.2 s measured, because two caches sit in front of it |
| The store is on the critical path | Only for a cold start. A running server survives an outage on its last good answer |
| Old units can be deleted | No. A tab opened before the deploy still fetches its own files |
| A unit can be composed with any other | No. `promote` refuses a composition with no contract in common |
| Anyone who can write the JSON | can serve an older composition, or break the page. Running their own code on the origin is closed: see below |

### Compared with

`../ajt-web-app-experiment` is the same app deployed the usual way: ArgoCD to six
clusters, six complete copies of the Kubernetes object set, roughly 79% of the
lines repeated, and a new image for every commit.

## Deploying

```sh
bun run build                                 # five units into dist/units/
bun run publish                               # uploads only what changed. Affects nobody
bun run promote qa --app alpha=9b855c4b       # the deploy
bun run promote qa --app alpha=36226fb9       # the rollback. Same command
bun run promote qa --shell 43ca0019           # the shell alone
bun run promote qa --from-build               # everything just built
```

`fly deploy` is not in that list, and `deploying-by-pointer.feature` asserts it:
the machine ids and their `updated_at` timestamps are identical before and after
a promotion. The image is rebuilt when the *server* changes, which is a
different and much rarer event.

`publish` writes each unit's `unit.json` **last**, after every file it names is
readable. `promote` refuses any unit with no `unit.json`, so a channel cannot
point at a half-uploaded unit.

`promote` reads the channel's current composition, applies only what you named,
and writes the result. That merge is the feature: without it every promote
replaces all five units, and "deploy alpha" silently rolls the other four back
to whatever the operator last had on disk. `falsify.ts` breaks the merge and
requires a scenario to go red.

### A unit id is a hash of that unit's output, and nothing else

The commit is deliberately not in it. It used to be — `<source>-<content>` — and
under per-unit publishing that is wrong: one commit touching only alpha would
change all five ids and republish all five, which removes the point. The commit
identifies the source, not the artefact, so it lives in `unit.json` as
provenance and reaches the served page in the `__BUILD__` block.

The consequence is that publishing is idempotent per unit:

```
$ bun run publish
  shell   43ca0019  unchanged
  alpha   9b855c4b  uploaded 3 files
  bravo   483316f3  unchanged
  charlie 8511a387  unchanged
  delta   d728f064  unchanged
```

## What stops a rollback breaking the page

Composing units means composing combinations that nothing has ever typechecked.
`tsc --noEmit` at HEAD proves the HEAD combination; rolling one unit back is
precisely how you get one it never saw. A shell that renamed an export, put in
front of a six-week-old alpha, is a page where one panel renders an error.

So each unit declares **which contracts it compiles against**, and `promote`
refuses a composition whose sets do not intersect.

A contract is the type surface a sub-app is built against — `@pointer/shell`
and `SubApp` — and **its identity is the content hash of that surface**, never a
number. A number is a claim somebody has to remember to raise, and nothing stops
an edit to a published contract from silently breaking every unit that claimed
the old one. A hash is derived, so that edit produces a different identity
instead, which no unit claims, and the composition falls back to the contract
they do share. `verifyRegistry` re-derives every stored hash from its own files
and refuses a mismatch.

Support is a **set**, not a range or a floor. A set can say "supports the one
from June and the one from August, not the one in between", which is what
support genuinely is.

The sets are generated, never written:

```
$ bun run contract:matrix
         9e79879  571be5c
shell       fail     pass
alpha       pass     fail
bravo       pass     fail
charlie     pass     fail
delta       pass     fail
```

That is one `tsc` per cell, with `@pointer/shell` and `@pointer/subapp`
re-pointed at that contract's `.d.ts` files — the same `paths` mechanism
`tsconfig.json` already uses to point them at the sources. Two adapter files
carry the halves the call sites cannot prove on their own:
`src/web/shell/contract.ts` (the shell provides at least the contract) and
`src/web/apps/<name>/contract.ts` (the app provides `mount`).

Three consequences, and they are why the matrix is worth its cost:

| | |
| --- | --- |
| Nobody can claim a contract they did not compile against | The set is generated output. There is no hand-written claim to get wrong, so it stops being a thing to test and becomes a property |
| An additive change costs nothing | Every adapter still compiles against the new hash, so it joins every set with no new file and no decision. Adding an export to `api.ts` does not force four republishes |
| A breaking change appears as a `fail` column | In the unit that has to move, immediately, rather than in a browser weeks later |

The table above is the real output of making `increment(ns, by = 1)` require
`by`. The shell stops satisfying the old contract; the four apps, which all call
`increment(NS)` with one argument, stop satisfying the new one; the intersection
is empty and `promote` refuses.

`build.ts` refuses to run when the surface at HEAD hashes to something the
registry does not hold, and names the command:

```sh
bun run contract:mint --name counters-2026-08
```

The directory name is for people reading a listing. The hash is the identity.

### What the contract does not cover

| Limit | Why |
| --- | --- |
| A same-name signature change | Covered. This is the case a list of exported *names* would have missed, and hashing the declaration surface catches it |
| A Preact major that breaks an old bundle | **Not covered.** Vendor types resolve from `node_modules` at HEAD, so a cell testing an old app against an old contract compiles against head Preact anyway — the vendor half would be identity with no verification behind it. Folding versions into the hash would instead force all four apps to republish on every patch bump. `unit.json` records the resolved versions and `promote` **warns** on a major mismatch |
| A change in behaviour behind an unchanged type | Not covered, and not coverable this way |

Measured, on this repository: the surface hash is stable across runs, unchanged
by a reworded and reflowed comment, and changed by `increment(ns, by = 1)`
becoming `increment(ns, by: number)`. Normalisation is `tsc
--emitDeclarationOnly --removeComments`, which is weaker than an API report
would give; a reformat that survives that would mint a contract everything still
supports, which costs one registry entry and no false refusal.

## Measured

| | Value |
| --- | --- |
| Promotion to every visitor seeing it | 4.7 – 10.2 s across eight runs, against a 15 s window |
| Propagation window by construction | 15 s: 5 s Tigris pointer cache + 10 s server cache |
| First request to a fully stopped machine | 4.59 s (wake, boot, cold manifest read) |
| First request to a running machine | 0.32 s |
| Runtime image | 40 MB, no `node_modules`, no `dist/` |

The 4.59 s is a `fly machine stop`, which is the worst case. `auto_stop_machines
= "suspend"` should wake faster; that was not measured.

## Layout

| Path | What it is |
| --- | --- |
| `src/server/origins.ts` | `Host` → channel, `FLY_REGION` → region. Pure |
| `src/server/manifest.ts` | Cached fetch: 10 s TTL, stale-while-revalidate, single-flight |
| `src/server/html.ts` | The shell template |
| `src/server/index.ts` | Three routes and nothing else |
| `src/web/shell/` | The frame: the store (`api.ts`), routing, and the loader that fetches a sub-app |
| `src/web/apps/<name>/` | One sub-app. Its own bundle, its own stylesheet, shares nothing with the others |
| `src/web/shell/subapp.ts` | `SubApp`, alone in its own file because it is half the contract |
| `src/web/shell/contract.ts` | The shell's conformance, in one file the matrix can compile |
| `src/web/apps/<name>/contract.ts` | That app's conformance to `SubApp` |
| `src/web/vendor/` | One re-export per shared specifier. These are what the import map points at |
| `contracts/<name>/` | One retained contract: `shell.d.ts`, `subapp.d.ts`, and the hash of the two |
| `build.ts` | Five `Bun.build`s → `dist/units/<name>/`, plus the contract matrix. Records `dist/build.json` |
| `scripts/contract.ts` | Surface emit, the hash, the registry, and the matrix |
| `scripts/store.ts` | SigV4 by hand: Bun's `S3Client` cannot set `Cache-Control` |
| `scripts/publish.ts` | `dist/units/<n>/` → `units/<n>/<id>/`. `unit.json` last, and only what changed |
| `scripts/promote.ts` | Read the composition, merge what was named, test the intersection, write |
| `scripts/e2e-independent-deploy.ts` | The three behaviours, end to end, read off the rendered page |
| `features/support/world.ts` | The harness: local stub vs live store, and the suite's own channels |
| `scripts/setup-store.ts` | One-off bucket CORS. See below |
| `scripts/publish-schema-2-fixture.ts` | One-off. The kept schema 2 manifest a rollback scenario points a channel at |
| `features/support/fixtures/schema-2.json` | That manifest, committed. Nothing rebuilds it |
| `scripts/falsify.ts` | Breaks the server and the deploy scripts 25 ways; each break must turn one check red |
| `stryker.config.json` | Mutation testing over the server logic |
| `features/` | The specification and the acceptance suite, in one artefact |
| `TODO.md` | Open items and what is done. Read it first after a context clear |

## Two failure rules, on purpose

`origins.ts` fails **closed** on an unrecognised `Host` — host parsing is the
only thing separating prod from qa, so an unknown host gets a 404 and never a
channel. It fails **open** on an unknown `FLY_REGION` — the machine is running
somewhere, and refusing all traffic is worse than one wrong region. The miss is
logged.

`/healthz` reads no manifest. If health depended on the store, a store outage
would make the platform kill machines that were serving visitors correctly.

## Verifying

```sh
bun test src/server        # 63 unit tests
bun run verify             # 19 @local scenarios, stub store, ~6 s
bun run contract:matrix    # 5 units x retained contracts, ~0.8 s
bun run verify:live        # @live scenarios against Fly and Tigris
bun run verify:browser     # 12 @browser scenarios in a real Chrome
bun run falsify            # 30 architectural mutations, each must turn a check red
FALSIFY_LIVE=1 bun run falsify   # including the ten that need the real store
bun run e2e                # deploy one app, deploy another, roll the first back
bun run mutate             # Stryker over the server logic
```

An `@live` scenario about **server** behaviour cannot be falsified by a source
edit, because it runs against the deployed image. Two mutations that break
`html.ts` therefore point at unit tests instead, and `falsify.ts` says so at the
mutation. The three live ones that do work break `publish.ts` and `promote.ts`,
which run locally.

`bun run e2e` is the one that answers the question the feature was built for,
and it is the only one that can. The unit tests construct compositions by hand.
The `@live` scenarios read unit ids out of the served HTML, which is the
manifest talking about itself. `e2e` drives the documented commands and then
reads the **rendered DOM** — the marker each sub-app painted — because that is
the only place "alpha moved and bravo did not" is a fact about the application
rather than a fact about a JSON file. It writes only `test-*` channels.

One thing in it is not the deployed machine, and the script says so at the top.
`Host` is forbidden to `setExtraHTTPHeaders` and Fly routes on SNI, so no
browser can reach a `test-*` channel on Fly — the trap this README already
records, met again from the other side. So the browser half runs
`bun src/server/index.ts` locally against the real store, and `origins.ts`
carries `test-qa.localhost` for it, development only. Everything else is real,
and the machine fingerprint is compared before and after.

`@browser` uses `playwright-core` against the Chrome already on the machine, so
nothing downloads a second browser. Seven of those twelve scenarios cover what
nothing else can see: five separately published bundles agreeing about one
store. The other five cover the schema they would agree about after a long
rollback, and what the page is allowed to load — see below.

Two kinds of mutation testing, and they cover different things. **Stryker**
mutates operators and literals in the pure logic — 91.98% killed, with
`manifest.ts` at 100%, `html.ts` at 87.33% and `origins.ts` at 68.09%. It found a
real gap: every entry in `FLY_TO_REGION` returned `"eu"`, the same as the
fallback, so deleting the lookup left every test green. **`falsify.ts`** makes
the architectural changes Stryker cannot generate — removing single-flight,
making the health check read the manifest, unsharing the store. Neither replaces
the other.

A survivor is one of three things, and only the first is chased:

| | |
| --- | --- |
| A real gap | Something the tests never asserted. Write the test |
| Wording | A log sentence, the default log sink, a request header the store does not negotiate on. A test that killed it would pin a choice nothing depends on |
| Unreachable | No input distinguishes the mutant from the original |

The second and third are excluded in place, with the reason on the line above
them, so the next reader gets the argument rather than the number. `manifest.ts`
has one of the third kind: a single-flight guard whose only caller cannot
violate the invariant it checks, kept because it states what a second call site
would have to keep.

Reaching 100% on `manifest.ts` changed the shape of its assertions, and that is
the transferable part. `toThrow("apps.alpha")` passes on ANY throw carrying that
text — including the TypeError from one line further in, which is exactly what a
deleted guard produces. The tests now assert the parser's own message, anchored,
naming the field: `^manifest field apps\.alpha `. The trailing space is what
pins the depth. Without it a failure one field deeper, at `apps.alpha.js`,
satisfies the same assertion, and a guard that stops rejecting malformed apps
passes.

Two tests were also green for the wrong reason. The non-2xx case sent a body
that could not parse, so the refresh failed on the body and the status check
could be deleted with nothing noticing; it now sends a VALID manifest with a 500.
And every timing test named its own `ttlMs` and `timeoutMs`, so the defaults a
server actually starts with were never run — a default timeout that is not a
number aborts every request before it is sent, and the store looks dead while
sitting there healthy.

`@local` covers only what needs an injected failure — an unreachable store, a
corrupt manifest, a counted read. Everything that publishes or promotes is
`@live` against the real store, because a stub that reimplemented those could
pass while the real path was broken.

`falsify` exists because a check that has only ever been green is not evidence.
It found three that proved nothing:

- a "malformed manifest" case whose document was invalid JSON, so manifest
  validation could be deleted and no test noticed;
- a burst test whose 25 requests never overlapped, because the stub answered in
  1 ms;
- and that same burst test after it was made to overlap, which then went red on
  only two runs in five. How many times the server fetches is not observable to
  a visitor, and measuring it through the network measured Bun's connection
  pooling: with one response held open, later fetches queue on the pooled
  connection and never reach the store. The scenario is gone and the unit test,
  which counts an injected fetch directly, catches the same mutation six times
  in six.

## Two channels without a domain

Fly gives one free hostname per app, and `.fly.dev` is Fly's namespace, so a
second channel cannot have a resolvable name until a real domain points here.
Fly forwards the `Host` header to the app untouched, so the channel works today
for anything that can set one:

```sh
curl https://pointer-deploy.fly.dev/                                  # qa
curl -H "Host: prod.pointer-deploy.test" https://pointer-deploy.fly.dev/   # prod
```

Both are answered by one machine, and `channel-selection.feature` asserts that.
`.test` is IANA-reserved and never resolves, which keeps it obvious that no
browser reaches prod yet. A domain is needed for a browser-reachable prod URL,
not for the behaviour.

## The suite deploys, so it deploys somewhere else

`verify:live` publishes throwaway builds and promotes them, because a stub
standing in for `promote` could pass while the real promote path was broken.
Promoting is the deploy. Pointed at `qa` and `prod`, the suite therefore
deployed a scenario's build every time it ran, and the application served a
build marked `alpha` or `beta` until someone promoted a real one.

There are four channels now. Two the application is served from, two the suite
owns:

| Channel | Host | Written by |
| --- | --- | --- |
| `qa` | `pointer-deploy.fly.dev` | an operator |
| `prod` | `prod.pointer-deploy.test` | an operator |
| `test-qa` | `test-qa.pointer-deploy.test` | `verify:live` |
| `test-prod` | `test-prod.pointer-deploy.test` | `verify:live` |

The `.feature` files still say "qa" and "prod": which channels the harness uses
is not part of the specification, so `features/support/world.ts` maps them and
nothing else changes. Two checks stand behind the mapping — `world.promote`
refuses any live target not prefixed `test-`, and the run records what `qa` and
`prod` point at before the first scenario and fails if either moved by the end.
The second repairs nothing on purpose: a restore hook that fails leaves the
channel wrong and reports success.

Seven of the twelve `@browser` scenarios load `pointer-deploy.fly.dev`, so they
read the real `qa` channel — no browser can be made to send a `Host` header.
They write nothing. Promote a build to `qa` before running them, or they check
whatever was last deployed.

The five `@test-channel` scenarios do write, because what they are about is a
channel pointing somewhere no promote would put it. They take the same way out
`e2e` does — `bun src/server/index.ts` locally against the real store, reached
at `test-qa.localhost` — write `test-qa`, and put the exact bytes back
afterwards. `world.pointChannelAtDocument` refuses any channel not prefixed
`test-`, the same tripwire `promote` carries.

## The bug that only a browser found

The first deployment passed every check — unit tests, both suites, `curl`
returning correct HTML with the right asset URLs — and rendered a blank page.

The document and the bundle are on different origins by design. A cross-origin
`<script type="module">` is fetched in CORS mode, and Tigris sets no
`Access-Control-Allow-Origin` by default. The stylesheet loaded, because `<link>`
is not CORS-restricted, so the background painted and nothing else appeared.
`flyctl` has no CORS flag, so `scripts/setup-store.ts` sets it through the S3
API.

`publishing-a-build.feature` now carries a scenario for it. It was confirmed to
go red with the bucket restricted to another origin, and green again after.

## The bug the clean tree found

Build ids were the git short SHA. Publishing two builds from one commit — the
same source with different build-time configuration — gave both the same id.
The second overwrote the first and both channels served one bundle. Without
`--force` the second would instead have been refused as already published,
which is equally wrong.

An id names an artefact, and the commit does not identify the artefact. It became
`<source>-<content>`, and then, when publishing moved to units, `<content>`
alone: keeping the commit in a *unit* id meant one commit touching only alpha
changed all five ids and republished all five. The same argument, taken one step
further than it was the first time. The suite refuses two scenario builds that
publish to one shell id, because without that guard every promotion scenario
passes by accident: the channel already serves the id being promoted to it.

## What a real channel will take from `dist/`

`--from-build` is the convenient command and the dangerous one. It promotes
whatever `dist/build.json` describes, and `dist/` is shared: `e2e`, `verify:live`
and `falsify` all overwrite it, and it outlives the tree that filled it. Either
way the manifest written is well-formed and every check downstream stays green,
because nothing about it is malformed — it simply names units nobody meant to
serve. That has happened to `prod` once.

Two guards on the same command, and three ways they refuse:

| What is in `dist/` | The tell | On `qa` or `prod` | On a `test-*` channel |
| --- | --- | --- | --- |
| A build the harness made | `marker`, set only by `BUILD_MARKER` | refused | promoted — this is what the suites do |
| A build from another commit | `source.commit` against `HEAD` | refused | promoted |
| A build from an uncommitted tree | `source.dirty` | refused | promoted |

The second and third have no marker on them at all, which is why the commit had
to be recorded rather than inferred. `build.ts` writes `source` beside the
build; `publish.ts` copies it onto the unit rather than asking git again, because
git at publish time answers a question about the tree and not about the bytes in
front of it — build, commit, then publish, and the unit claims a commit that does
not contain its own source.

A dirty build is refused however the tree looks now: two dirty trees at one
commit are not the same source, so its `commit` names where the work started and
not what it holds. The tree being dirty **now** is deliberately not a refusal. A
clean build at `HEAD` is exactly commit `HEAD` however much has been edited
since, and refusing it would mean stashing to deploy a commit that is already
reviewed.

Deliberately serving an older build is a real operation, so there is an
override. `--no-source-check` promotes anyway and prints what it let through:

```sh
bun run promote qa --from-build --no-source-check
```

Five scenarios hold this, and five `falsify` mutations hold them — one for the
refusal, one for each of the two readings, one for the `test-*` exemption, and
one for the override. They are `@local`, which the conventions reserve for
failures that cannot be forced on the real store: forcing this one means naming a
real channel, and if the refusal were ever removed the run itself would deploy to
visitors. Nothing is stubbed even so. The steps run the real `scripts/promote.ts`
from a temporary git repository holding a `.gitignore` and the `dist/build.json`
under test, with the store pointed at `store.invalid` — so "reached the store" and
"refused for its source" are both positive readings, and removing a guard swaps
one for the other.

## The schema a rollback can land on

A rollback is an older pointer, and a pointer old enough was written by a server
that composed the page differently. Schema 2 shared one `assetBase` across the
whole page and resolved the import map against it; schema 3 gives each unit its
own. Both channels a visitor can reach are schema 3, so no browser had ever
loaded the older shape. `manifest.test.ts` parses a schema 2 document, which
proves the parser and says nothing about the page — and the page is where the
question lives, because whether five bundles fetched from one directory still
share one signals runtime is not something a parser can answer.

`bun run fixture:schema-2` writes one, once: every unit's files into a single
directory under `legacy/schema-2/<id>/`, and a schema 2 manifest naming them.
Both copies are kept — nothing is deleted from the store, and
`features/support/fixtures/schema-2.json` is committed — so the scenario points
a channel at a manifest instead of building one, which is the operation an
operator would perform.

Two `@browser` scenarios read it. The page reports one build id and no
composition, every file it fetched came from that one directory, and a count
raised in alpha is read by charlie two views away. The first of those is what
stops the pair passing on a channel that never moved: schema 3 renders a working
page too, and it is the page the other seven scenarios are already looking at.

`falsify` breaks both halves — the parser's schema 2 branch, and the import map
schema 2 resolves against the shared base — and each turns its scenario red.
These are the only mutations here that falsify a **server** edit through a
scenario, because a `@test-channel` scenario runs `src/server/index.ts` from the
working tree rather than against the deployed image.

## Cold edges

Tigris fills an edge on first request, so the first visitor after a deploy paid
for it — measured once at over 30 s for a file nobody had asked for, which also
showed up as one flaky browser run in four.

`promote.ts` now fetches every file the units it is moving name, **before** it
writes the pointer — 2 files in about 350 ms for one sub-app. Only what moved:
the rest were warmed by the promote that put them there. Warming before the
write rather than after also closes the window in which a visitor could reach a
cold file. Pass `--no-warm` to skip it.

The browser suite's mount wait dropped from 60 s to 20 s as a result. The fix
belongs at the source, not in the timeout.

## What the browser is allowed to load

A pointer names files. Whoever can write one can name any file on the store, and
before this the page would load it and run it. Two mechanisms answer that, and
neither is sufficient alone.

**A digest per file.** `build.ts` takes a sha384 of every file it emits and
records it in `dist/build.json`; `publish.ts` writes it into the unit's
`unit.json`; `promote.ts` copies it into the composition. So the digests travel
with the **unit**, not with the composition — a channel rolled back to an older
alpha gets that alpha's digests, and the check keeps working across a rollback.

`BuildArtifact.hash` is **not** this, despite what an earlier version of this
file said: it is an 8-character content hash Bun uses for `[hash]` in a file
name, and no browser will check it.

Three places carry a digest, because three different mechanisms fetch the files:

| What | Where the digest goes | Why not somewhere else |
| --- | --- | --- |
| The shell's entry and stylesheet | `integrity` on the tag | They are the only two files named by a tag |
| Every other script | The import map's `integrity` section | The shared chunk and every sub-app are fetched by the module loader, which reads no tag, and `import()` takes no integrity argument |
| A sub-app's stylesheet | The `__APPS__` block, and `loader.ts` sets it on the `link` | A stylesheet is not a module and never resolves through the import map |

The middle row is the one that is easy to miss. A digest on the shell's tag
covers `index-*.js` and nothing behind it: the five `shared-*.js` chunks that
entry imports, and the four sub-apps, are all fetched without one.

**A policy.** `content-security-policy` on the shell response, derived from the
manifest rather than configured — which store a composition is served from is
what the manifest is *for*, so a hard-coded origin would refuse a composition
published to a second bucket.

```
default-src 'none'; script-src <the origins the manifest names> 'sha256-<the import map>';
style-src <the same origins>; base-uri 'none'; form-action 'none'; frame-ancestors 'none'
```

The import map is the page's one inline script, allowed by the hash of its own
bytes rather than by `'unsafe-inline'`, so a script injected into this HTML is
still refused. The `application/json` blocks need no allowance: a script element
the browser does not execute is not a script the policy is asked about.

The digest answers a swapped file. The policy answers a manifest naming an
origin of its author's choosing, which no digest can catch — whoever wrote the
manifest wrote the digest beside it. Only the two together close it.

`features/checking-what-the-page-loads.feature` is the evidence. Two scenarios
read the served HTML, which is enough to say what the page *claims* it will
check. Three more drive a real Chrome, because whether a browser **refuses** a
file is not observable to anything else: one digest in the pointer is replaced
with a well-formed one that matches nothing, and the sub-app must not run. Seven
`falsify` mutations hold them, five of which only a browser can catch.

The two that read HTML are `@live @local`, so they check the deployed image as
well as the source — they were `@local` alone until the image carried this, and
an `@live` scenario written before its deploy reports the deploy queue rather
than a defect. The three browser ones are `@test-channel`: a `@browser` scenario
against the deployed image cannot be falsified by an edit here, so it would
prove nothing about its own quality.

Not closed by this: a unit published before digests were recorded carries none,
and `promote` warns rather than refuses. Refusing would make rolling back that
far impossible, which is the operation the whole design exists for.

## Not done

| | |
| --- | --- |
| A browser-reachable `prod` URL | Needs a domain pointed at Fly and a certificate. The channel itself works; see above |
| Second region | `fly scale count 1 --region iad`. The region is already in the manifest path |
| Asset retention | Nothing is deleted, so nothing can dangle |
| Contract pruning | `contracts/registry.json` retains by hand. Pruning is a decision, never automatic |
| Concurrent promotes | `promote` is a read-modify-write with no compare-and-set, so two at once can lose one. One operator. Tigris conditional writes are unchecked; an `If-Match` on the ETag would close it |

Whoever can write `manifests/eu/prod.json` can still point a channel at an older
composition, and can still stop the page working. What they can no longer do is
run their own code on the origin: see above. The remaining hole is the key
itself — one machine holds a bucket write key in a gitignored `.env.local`, and
it is scoped to the whole bucket. A second key scoped to non-prod paths is what
the CI item in `TODO.md` is waiting for.

## Traps, already paid for

Do not rediscover these.

| Trap | What happens |
| --- | --- |
| An acceptance suite that promotes | Promoting is the deploy. A live suite pointed at a real channel ships its own throwaway build to visitors, silently, on every green run |
| `curl -o -` with no `-D -` | The Response carries a status and no headers, so a scenario asserting `cache-control` reads an empty string and passes on anything |
| `NODE_ENV` not set before the process starts | Bun emits `preact/jsx-dev-runtime`, which the import map does not name, and every sub-app fails to resolve in the browser. `build.ts` refuses to run without it |
| Tigris sets no `Access-Control-Allow-Origin` | A cross-origin `<script type="module">` is blocked and the page renders blank while `curl` returns correct HTML. `bun run setup:store` sets it through the S3 API; flyctl has no flag |
| Bun's `S3Client` cannot set `Cache-Control` | `scripts/store.ts` signs SigV4 directly. The manifest's 5 s cache is what sets the propagation window |
| A build id keyed on the commit alone | Two builds from one commit collide and one silently overwrites the other |
| A *unit* id with the commit in it | One commit touching only alpha changes all five ids and republishes all five, so independence survives only in the pointer. A unit id is the content hash alone |
| A promote that writes what it was given | It replaces all five units, so "deploy alpha" silently rolls the other four back to whatever was last on disk. `promote` reads, merges, then writes |
| One `assetBase` for the whole page | Every unit id in the manifest is right and every sub-app 404s, because they are fetched from the shell's directory. One base per unit |
| A hand-bumped contract version | Somebody has to remember, and an edit to a published contract breaks every unit that claimed it, silently. The identity is the hash of the surface |
| Folding vendor versions into the contract hash | Every Preact patch bump invalidates all four apps and forces four republishes. Versions are recorded and warned about, not enforced |
| A cold Tigris edge | The first visitor after a deploy waited over 30 s once. `promote.ts` warms every file the manifest names before reporting success |
| `curl` and a browser disagree | Only a browser sees a blocked module script or an edge-cached shell. Check user-facing changes in a browser, never with `curl` alone |
| Bun pools HTTP connections per origin | Counting requests a stub store received measures the client, not the server. A scenario built on that went red on two runs in five and was deleted |
| A scenario green on its first run | Not yet evidence. `bun run falsify` exists for this and has found three checks that proved nothing |
| `dist/` treated as the build you just made | `e2e`, `verify:live` and `falsify` all overwrite `dist/build.json`. `--from-build` after any of them promotes a harness build, and every check stays green because the manifest is well-formed and describes the wrong units |
| `dist/` treated as the tree you are looking at | It outlives the tree that filled it. A build from an older commit carries no marker, so the harness guard cannot see it, and `--from-build` days later promotes a commit nobody chose. A build records the source it came from, and `promote` compares it |
| Provenance read at publish time | git then answers a question about the tree, not about the bytes. Build, commit, publish, and the unit claims a commit that does not contain its own source. `publish` copies `source` out of `dist/build.json` |
| A schema the parser accepts and nothing serves | The unit test is green, the rollback onto it is untested, and the page it would produce has never been rendered. Keep a fixture in the store and point a test channel at it |
| A step that matches an asset by its directory | The directory belongs to the manifest schema, not the application. Schema 3 moved `apps/<name>-` to `units/<name>/<id>/`, and three steps silently matched nothing and counted 0 |
| `integrity` on a cross-origin tag with no `crossorigin` | The browser refuses the file rather than checking it. The stylesheet never applies and the page renders unstyled, while every other check stays green |
| `BuildArtifact.hash` read as an SRI digest | It is an 8-character content hash for `[hash]` in a file name. An `integrity` attribute holding one is refused by every browser |
| A digest on the tags alone | The tags name two files. The shared chunks and every sub-app are fetched by the module loader, which reads no tag, so the import map's `integrity` section is the only place they can be declared |

## Conventions

- The `.feature` files are the specification and the acceptance suite at once.
  Never paraphrase one into a separate test.
- `@local` is only for failures that cannot be forced on the real store. Anything
  that publishes or promotes runs `@live`, because a stub reimplementing them
  could pass while the real path was broken.
- Every new scenario must be seen red before it is trusted.
- Commit messages carry no author or contributor references.
