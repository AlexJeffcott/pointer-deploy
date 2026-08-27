# TODO

Working state for `pointer-deploy`. Read this first after a context clear.

## Status

Everything committed and pushed. `main` is clean and matches `origin/main`.

| | |
| --- | --- |
| Live | <https://pointer-deploy.fly.dev/> |
| Repo | <https://github.com/AlexJeffcott/pointer-deploy> (private) |
| Fly app | `pointer-deploy`, one machine, region `ams`, org `personal` |
| Store | Tigris bucket `pointer-deploy-assets`, public, CORS set |
| Last commit | `f4d8d03` |

All green as of 2026-08-27:

| Check | Result |
| --- | --- |
| `bun run typecheck` | clean |
| `bun test src/server` | 42 pass |
| `bun run verify` | 9 `@local` scenarios |
| `bun run verify:live` | 18 `@live` scenarios |
| `bun run verify:browser` | 7 `@browser` scenarios |
| `bun run falsify` | 8/8 architectural mutations caught |
| `bun run mutate` | Stryker 69.91% — html 86.67, manifest 64.49, origins 69.77 |

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

Ranked. The first one is a defect, the rest are additions.

### 1. `verify:live` repoints the real channels

Confirmed, not suspected. `Given the qa channel points at build "alpha"` calls
`world.pointAt`, which runs the real `promote.ts`. `channel-selection` does the
same for `prod`. So every run of the live suite leaves both channels pointing at
its own throwaway builds, and the live app serves a test build until someone
promotes a real one. It is how `f4d8d03-6631affd` got onto `qa`.

Fix: give the suite its own channels (`test-qa`, `test-prod`) in `origins.ts`
and the origins table, or record each channel's build in a `Before` hook and
restore it in `After`. The dedicated channel is the better answer — a restore
hook that fails leaves the channel wrong anyway.

### 2. Port the suite to `playwright-bdd`

AJT's suggestion. The `.feature` files do not change; the step bindings and the
runner do.

| | |
| --- | --- |
| Buys | traces and screenshots on failure, parallelism, native fixtures |
| Costs | porting roughly 400 lines across five step files to `createBdd()`, swapping cucumber-js for `bddgen` + `playwright test` |
| Trap | the non-browser suites spawn a Bun server, a stub store and shell out to publish/promote. They must move too, or the project ends up running two runners, which is worse than either |

Do it on a green baseline and check the port by comparing scenario counts and
results against the numbers in Status above.

### 3. A browser-reachable `prod`

Needs a domain pointed at Fly and a certificate. The channel already works; only
DNS and TLS are missing. The domain substitutes in three places:
`src/server/origins.ts` (the `DEPLOYED` table), `fly certs add`, and
`features/support/world.ts` (`LIVE_HOSTS`).

### 4. Subresource Integrity, then a Content-Security-Policy

`BuildArtifact.hash` is already in hand in `build.ts`. Bucket CORS is set, which
SRI on a cross-origin script needs. Roughly three lines for SRI and one response
header for the CSP.

This is the standing security objection, stated once and not repeated: whoever
can write `manifests/eu/prod.json` can execute JavaScript on the production
origin. One machine holds that key. Fine for an experiment, not fine once anyone
else uses it.

### 5. Raise the mutation score on `manifest.ts`

64.49%, the lowest of the three. Look at the survivors before adding tests —
some will be log strings that no behaviour should catch, and those should be
excluded rather than chased.

### 6. Second region

`fly scale count 1 --region iad`. `FLY_TO_REGION` already maps the US regions
and `origins.test.ts` asserts one. Needs `manifests/us/<channel>.json` published,
or the US machine answers 503.

### 7. CI

Not wired. `verify:live` needs live credentials, and putting a bucket write key
into repository secrets means putting the production-origin execution key there.
The right shape is a second Tigris key scoped to non-prod paths first.

### 8. Asset retention

Nothing is deleted, so nothing can dangle. A policy is only needed when the
bucket gets large. If one is added: keep every build for at least 90 days, or a
tab opened before a deploy breaks when it lazily fetches a file.

## Traps, already paid for

Do not rediscover these.

| Trap | What happens |
| --- | --- |
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
