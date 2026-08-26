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

So a deploy is this, and nothing else:

```sh
bun run promote qa e7598eb-6fa04f32
```

### What happens on a request

```mermaid
sequenceDiagram
    participant B as Browser
    participant S as Bun server, one image
    participant T as Object store

    B->>S: GET / with Host qa.example.com
    Note over S: Host picks the channel
    S->>T: GET manifests/eu/qa.json
    T-->>S: which build is live
    S-->>B: HTML naming that build's files
    B->>T: GET builds/e7598eb-6fa04f32/index-bv6en265.js
    B->>T: GET builds/e7598eb-6fa04f32/index-hqysnmvp.css
```

The server never holds a script or a stylesheet. It is asked which build is
live, and it writes an HTML page pointing at that build. Promoting a different
build changes the answer to that question, so the next visitor gets a different
app from the same running machine.

### What it costs

| | |
| --- | --- |
| A visitor waits for a manifest read | No. It is cached 10 s and served stale while it refreshes |
| A deploy is instant | No. 4.7 – 10.2 s measured, because two caches sit in front of it |
| The store is on the critical path | Only for a cold start. A running server survives an outage on its last good answer |
| Old builds can be deleted | No. A tab opened before the deploy still fetches its own files |
| Anyone who can write the JSON | can run JavaScript on the production origin |

### Compared with

`../ajt-web-app-experiment` is the same app deployed the usual way: ArgoCD to six
clusters, six complete copies of the Kubernetes object set, roughly 79% of the
lines repeated, and a new image for every commit.

## Deploying

```sh
bun run build                      # hashed files into dist/
bun run publish                    # -> builds/<id>/ ; prints <id>. Affects nobody
bun run promote qa   <id>          # the deploy
bun run promote prod <id>
bun run promote prod <previous>    # the rollback. Same command
```

`fly deploy` is not in that list, and `deploying-by-pointer.feature` asserts it:
the machine ids and their `updated_at` timestamps are identical before and after
a promotion.

`publish` writes the manifest **last**, after every file it names is readable.
`promote` refuses any build with no manifest, so a channel cannot point at a
half-uploaded build.

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
| `src/web/` | Preact + signals + `*.module.css`, scoped by Bun with no config |
| `build.ts` | `Bun.build` → `dist/` with content hashes, records `dist/build.json` |
| `scripts/store.ts` | SigV4 by hand: Bun's `S3Client` cannot set `Cache-Control` |
| `scripts/publish.ts` | `dist/` → `builds/<id>/`. Manifest last |
| `scripts/promote.ts` | `builds/<id>/manifest.json` → `manifests/<region>/<channel>.json` |
| `scripts/setup-store.ts` | One-off bucket CORS. See below |
| `scripts/falsify.ts` | Breaks the server eight ways; each break must turn one scenario red |
| `features/` | The specification and the acceptance suite, in one artefact |

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
bun test src/server   # 27 unit tests
bun run verify        # 9 @local scenarios, stub store, ~7 s
bun run falsify       # 8 mutations, each must turn its scenario red
bun run verify:live   # 17 @live scenarios against Fly and Tigris, ~2m 15s
```

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

An id names an artefact, and the commit does not identify the artefact. It is
now `<source>-<content>`. The suite refuses two scenario builds that publish to
one id, because without that guard every promotion scenario passes by accident:
the channel already serves the id being promoted to it.

## Not done

| | |
| --- | --- |
| A browser-reachable `prod` URL | Needs a domain pointed at Fly and a certificate. The channel itself works; see above |
| SRI on the script and link tags | `BuildArtifact.hash` is already in hand in `build.ts`. Bucket CORS is set, which SRI needs |
| Content-Security-Policy | One response header |
| Second region | `fly scale count 1 --region iad`. The region is already in the manifest path |
| Asset retention | Nothing is deleted, so nothing can dangle |

Whoever can write `manifests/eu/prod.json` can execute JavaScript on the
production origin. The only writer here is one machine holding the key in a
gitignored `.env.local`. That is fine for an experiment and is not fine once
anyone else uses it: SRI, a CSP, and a scoped write key are the fix.
