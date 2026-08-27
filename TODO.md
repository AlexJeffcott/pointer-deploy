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

**Still unrun: whether that is what happened.** It needs `fly machine suspend`,
a pointer rewrite while it sleeps, a resume, and the guest's clock read against
this one. `scripts/` has no artefact for it yet.

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

## Open questions

Not scoped, not ranked. Each one is a hole in the model that a demonstration
would close.

### Contracts against an external API

The contract covers the type surface between the shell and the sub-apps.
Nothing covers the surface between a sub-app and a service it calls. Add a
small REST API and drive the values already on the page from it — the user
name and the counts — so the same hash-set argument can be tried against a
service the units do not build alongside.

### A version switcher on the page

Every unit deployed to a channel should be selectable from a `select` in the
shell and in each sub-app, listing the deployed ids. Ids whose contract sets do
not intersect the current composition are disabled rather than hidden — the
refusal is already computed in `promote`, so the same rule has to reach the
browser.

### Who chooses which apps appear, and where

Undecided. The shell currently renders whatever the manifest names. Placement
and selection have no owner.

### Differing dependency versions

Each app carrying everything it needs is the simple answer, and it breaks for
singletons — Preact and Signals must be one instance or the page stops agreeing
with itself. Facades enforcing a stated contract are one candidate. Note that
vendor majors are currently recorded and warned about, never enforced.

### Sharing the same signal instance

Two apps sharing a value is solved. Two apps sharing the *identity* of a signal
is not, and it is the harder case.

### Build-time warnings for backwards-incompatible changes

The contract hash already changes when the type surface changes. It does not
say whether the change was additive. A build that could name the difference
would warn before a promote refuses.

### A deprecation dynamic

A way to mark a contract, a unit or a field as going away, so consumers see it
before it is removed rather than after.

### Analytics on which build sets are in use

No reading exists of which compositions visitors are actually running. Needed
before anything is sunset: without it, removing a deprecated field is a guess.

### Do apps need migrations?

Open. If a sub-app carries persisted state, rolling it back moves the code and
not the data.

## Done

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
