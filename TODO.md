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

Build clean immediately before any real promote. `e2e`, `verify:live` and
`falsify` all overwrite `dist/`.

## Open

### 1. A stale clean build still promotes

The guard catches harness builds, not a clean build from an older commit.
Record the source commit in `dist/build.json` and refuse a mismatch, with an
override for deliberate rollback.

Related, and now fixed: a unit first published from a dirty tree used to keep
`commit` and `dirty` forever, because the id is a content hash and the
unchanged-check skipped the rewrite. `publish` now upgrades a dirty record when
a clean tree produces the same bytes. No scenario and no mutation hold that
rule — staging it needs the harness to dirty the tree.

### 2. Port the suite to `playwright-bdd`

The `.feature` files do not change; the bindings and runner do. Buys traces,
screenshots on failure, parallelism. Costs ~400 lines across five step files.
Trap: the non-browser suites spawn a Bun server and shell out to
publish/promote, so they must move too or the project runs two runners.

### 3. A browser-reachable `prod`

Needs a domain and a certificate. The domain substitutes in three places:
`src/server/origins.ts`, `fly certs add`, `features/support/world.ts`.

### 4. Raise the mutation score on `manifest.ts`

61.36%. Read the survivors first: some are log strings that no behaviour should
catch, and those want excluding rather than chasing.

### 5. Second region

`fly scale count 1 --region iad`. Needs `manifests/us/<channel>.json` published
or the US machine answers 503.

### 6. CI

`verify:live` needs live credentials, and a bucket write key is the
production-origin execution key. Needs a second Tigris key scoped to non-prod
paths first.

### 7. Asset retention

Nothing is deleted, so nothing dangles. If a policy is added, keep every build
90 days, or a tab opened before a deploy breaks on its next lazy fetch. Exempt
`legacy/schema-2/`: the rollback scenarios point a channel at what is there,
and a retention sweep would delete the fixture rather than expire it.

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
  Not yet on the deployed image: `fly deploy` is what puts the header and the
  attributes in front of visitors.
