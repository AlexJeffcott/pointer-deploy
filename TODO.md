# TODO

Working state for `pointer-deploy`. Read this first after a context clear.

## Status

Everything committed. `main` is clean and matches `origin/main`.

| | |
| --- | --- |
| Live | <https://pointer-deploy.fly.dev/> |
| Repo | <https://github.com/AlexJeffcott/pointer-deploy> (private) |
| Fly app | `pointer-deploy`, one machine, region `ams`, org `personal` |
| Store | Tigris bucket `pointer-deploy-assets`, public, CORS set |
| Last commit | `e156d17` |
| Channels | `qa`, `prod` for visitors; `test-qa`, `test-prod` for `verify:live` |

All green as of 2026-08-27:

| Check | Result |
| --- | --- |
| `bun run typecheck` | clean |
| `bun test src/server` | 44 pass |
| `bun run verify` | 9 `@local` scenarios |
| `bun run verify:live` | 18 `@live` scenarios |
| `bun run verify:browser` | 7 `@browser` scenarios |
| `bun run falsify` | 8/8 architectural mutations caught |
| `bun run mutate` | Stryker 70.18% — html 86.67, manifest 64.49, origins 71.11 |

## Running it

```sh
bun run build                      # NODE_ENV=production is set by the script
bun run publish                    # prints the build id; affects no visitor
bun run promote qa   <id>          # the deploy. Warms the store, then reports
bun run promote prod <id>
bun run promote prod <previous>    # the rollback. Same command
```

Secrets live in `.env.local`, gitignored, never committed. `fly storage create`
prints them. The Fly app holds none — the server reads manifests over public
HTTPS and never authenticates to the bucket.

`prod` has no resolvable hostname yet. Reach it with a header:

```sh
curl -H "Host: prod.pointer-deploy.test" https://pointer-deploy.fly.dev/
```

## Open

Ranked. All additions; the channel-bleed defect is fixed, see below.

### 1. Port the suite to `playwright-bdd`

AJT's suggestion. The `.feature` files do not change; the step bindings and the
runner do.

| | |
| --- | --- |
| Buys | traces and screenshots on failure, parallelism, native fixtures |
| Costs | porting roughly 400 lines across five step files to `createBdd()`, swapping cucumber-js for `bddgen` + `playwright test` |
| Trap | the non-browser suites spawn a Bun server, a stub store and shell out to publish/promote. They must move too, or the project ends up running two runners, which is worse than either |

Do it on a green baseline and check the port by comparing scenario counts and
results against the numbers in Status above.

### 2. A browser-reachable `prod`

Needs a domain pointed at Fly and a certificate. The channel already works; only
DNS and TLS are missing. The domain substitutes in three places:
`src/server/origins.ts` (the `DEPLOYED` table), `fly certs add`, and
`features/support/world.ts` (`LIVE_HOSTS`).

### 3. Subresource Integrity, then a Content-Security-Policy

`BuildArtifact.hash` is already in hand in `build.ts`. Bucket CORS is set, which
SRI on a cross-origin script needs. Roughly three lines for SRI and one response
header for the CSP.

This is the standing security objection, stated once and not repeated: whoever
can write `manifests/eu/prod.json` can execute JavaScript on the production
origin. One machine holds that key. Fine for an experiment, not fine once anyone
else uses it.

### 4. Raise the mutation score on `manifest.ts`

64.49%, the lowest of the three and unmoved. Look at the survivors before adding tests —
some will be log strings that no behaviour should catch, and those should be
excluded rather than chased.

### 5. Second region

`fly scale count 1 --region iad`. `FLY_TO_REGION` already maps the US regions
and `origins.test.ts` asserts one. Needs `manifests/us/<channel>.json` published,
or the US machine answers 503.

### 6. CI

Not wired. `verify:live` needs live credentials, and putting a bucket write key
into repository secrets means putting the production-origin execution key there.
The right shape is a second Tigris key scoped to non-prod paths first.

### 7. Asset retention

Nothing is deleted, so nothing can dangle. A policy is only needed when the
bucket gets large. If one is added: keep every build for at least 90 days, or a
tab opened before a deploy breaks when it lazily fetches a file.

## Fixed: `verify:live` repointed the real channels

The live suite promotes throwaway builds, and promoting is the deploy. Pointed
at `qa` and `prod` it deployed a scenario's build on every run, and the
application served a build marked `alpha` or `beta` until someone promoted a
real one.

The suite has two channels of its own now — `test-qa` and `test-prod` in
`src/server/origins.ts`, `scripts/promote.ts` and `features/support/world.ts`.
The `.feature` files are unchanged: which channels the harness writes is not
part of the specification, so the World maps `qa` -> `test-qa` and
`prod` -> `test-prod` in live mode only.

Two checks stand behind the mapping, both seen red before they were trusted:

| Check | Mutation | What it reported |
| --- | --- | --- |
| `world.promote` refuses a live target not prefixed `test-` | `LIVE_CHANNELS.qa` back to `"qa"` | `the suite tried to promote to "qa", which is a real channel` — and nothing was written |
| `AfterAll` compares what `qa` and `prod` point at against `BeforeAll` | `REAL_CHANNELS` set to `["test-qa"]`, which the run does move | `the live suite moved 1 real channel(s). That is a deploy: test-qa: ...-6631affd -> ...-1fa9297f` |

The `AfterAll` guard repairs nothing on purpose. A restore hook that fails
leaves the channel wrong and reports success.

One consequence: `verify:browser` loads `pointer-deploy.fly.dev`, so it reads
the real `qa` channel — no browser can be made to send a `Host` header. It
writes nothing, but it checks whatever was last promoted to `qa` rather than
what the run just published. Promote before running it.

The deployed server had to learn the two new hosts, so this fix needed one
`fly deploy` — a server change, which is what `fly deploy` is still for.

## Traps, already paid for

Do not rediscover these.

| Trap | What happens |
| --- | --- |
| An acceptance suite that promotes | Promoting is the deploy. A live suite pointed at a real channel ships its own throwaway build to visitors, silently, on every green run |
| `curl -o -` with no `-D -` | The Response carries a status and no headers, so a scenario asserting `cache-control` reads an empty string and passes on anything |
| `NODE_ENV` not set before the process starts | Bun emits `preact/jsx-dev-runtime`, which the import map does not name, and every sub-app fails to resolve in the browser. `build.ts` refuses to run without it |
| Tigris sets no `Access-Control-Allow-Origin` | A cross-origin `<script type="module">` is blocked and the page renders blank while `curl` returns correct HTML. `bun run setup:store` sets it through the S3 API; flyctl has no flag |
| Bun's `S3Client` cannot set `Cache-Control` | `scripts/store.ts` signs SigV4 directly. The manifest's 5 s cache is what sets the propagation window |
| A build id keyed on the commit alone | Two builds from one commit collide and one silently overwrites the other. The id is `<source>-<content>` |
| A cold Tigris edge | The first visitor after a deploy waited over 30 s once. `promote.ts` warms every file the manifest names before reporting success |
| `curl` and a browser disagree | Only a browser sees a blocked module script or an edge-cached shell. Check user-facing changes in a browser, never with `curl` alone |
| Bun pools HTTP connections per origin | Counting requests a stub store received measures the client, not the server. A scenario built on that went red on two runs in five and was deleted |
| A scenario green on its first run | Not yet evidence. `bun run falsify` exists for this and has found three checks that proved nothing |

## Conventions

- The `.feature` files are the specification and the acceptance suite at once.
  Never paraphrase one into a separate test.
- `@local` is only for failures that cannot be forced on the real store. Anything
  that publishes or promotes runs `@live`, because a stub reimplementing them
  could pass while the real path was broken.
- Every new scenario must be seen red before it is trusted.
- Commit messages carry no author or contributor references.
