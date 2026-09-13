# What happens on a first visit

**Read on 2026-09-10, against a composition with one sub-app in it.** `PLAN.md`
step 0 then took the application to the frame alone and step 1 put `list` back
on `/`, so the sub-app half of this walkthrough is live again — against `list`
rather than `hello`. The counts below carry the frame-alone reading beside it,
because that is the shape the two views placing no unit still have. It was four at step 1 and three at step 4; step 5 finished the slate, so two is the number it stays at.

| | With one sub-app, as measured | The frame alone, `PLAN.md` step 0 |
| --- | --- | --- |
| Store requests | 11 | **7** — `index.js`, `index.css` and five `shared-*.js` chunks |
| `<script id="__APPS__">` | present, naming one app | **absent**: `renderShell` writes it only when the manifest names an app |
| `<link rel="modulepreload">` / `preload` | one of each | **none** |
| Views | 2 | **5**, and not one of them places a unit |

The frame-alone reading was taken in Chrome against a local server serving
`test-qa` from the real store, by counting every request the page made. It is
the same reading the `@browser` scenario in `serving-the-shell.feature` takes,
one step further on: that scenario counts what a WALK of the whole sidenav costs
after the load, and the answer is zero.


## 1 · The HTML request

1. The browser sends `GET /` with `Host: pointer-deploy.fly.dev`.
2. The server checks the fixed paths first: `/healthz`, `/compositions`, `/units`, `/assets*`. None match (`src/server/index.ts:101-121`).
3. `resolveTarget` reads the `Host` header against a table. `pointer-deploy.fly.dev` → channel `qa`. `FLY_REGION=ams` → region `eu`. A host not in the table is a 404 (`src/server/origins.ts:8`).
4. The server builds one URL: `https://pointer-deploy-assets.fly.storage.tigris.dev/manifests/eu/qa.json`. The two halves come from different places. `qa` came from this request's `Host`, so it can differ from one request to the next. `eu` came from the machine's own `FLY_REGION`, read once at boot into a module constant and passed into every request unchanged (`src/server/index.ts:34,124`). One machine serves one region for its whole life; no request can move it.
5. `manifests.get()` — **the pointer is already cached, even here**. Every channel's pointer and history, the catalogue and the service's version list are read at boot, and the port stays shut until they land (`src/server/index.ts:66-74`). A cold process serves its first request with `x-manifest-age` in the hundreds of milliseconds: the age of the boot read, not of a read this request made. This request waits on the store only where that boot read found nothing, because a prime that finds nothing leaves no trace. Fetch timeout 3 s, hard deadline 6 s (`src/server/manifest.ts:229-232`).
6. Tigris answers the pointer. It carries `cache-control: public, max-age=5`, so the edge may hand back a copy up to 5 s old (`scripts/store.ts:294`).
7. `parseManifest` turns those bytes into a value or throws (`src/server/manifest.ts:81`). **The manifest is this same pointer file** — `manifest` is the name the code uses for it. Its top-level `schema` field names the layout, and three are accepted:
    - **1** — `entry: { js, css }`: one bundle, one stylesheet, no sub-apps. Nothing in the repo writes one; it lives in the parser and its tests.
    - **2** — `shell { js, css }`, one `imports` map, one `apps` record, and **one `assetBase` shared by every unit**, so the units cannot move separately. One test channel points at a fixture kept permanently in `legacy/schema-2/`, because whether such a page still renders is only observable in a browser (`scripts/publish-schema-2-fixture.ts`).
    - **3** — each unit carries its own `unitId`, `assetBase`, `integrity` and `marker`, and the file carries a `contract` and a `composedAt`. Both real channels serve this, and it is the only schema under which one unit can move alone.

    Any other value throws `unsupported manifest schema`. A parse failure keeps the last good value and writes the reason into `x-manifest-refresh`; no value at all is a 503 (`src/server/index.ts:129`). `units/catalogue.json` and `<channel>.history.json` carry a `schema` field of their own, numbered separately — a `schema: 1` in those files is not this schema 1.
8. From here the handler is a branch, not a line (`src/server/index.ts:136-172`). Four gates decide the rest of this section. A plain first visit passes A and B and stops at C:

    | Gate | Test | A failure means |
    | --- | --- | --- |
    | A | `manifest.schema === 3` | no override is possible; straight to step 12 |
    | B | the channel's history `peek`s non-null, merged with `units/catalogue.json` | the same as A. It fails only where the boot read found nothing, because `peek` never makes a visitor wait on the store |
    | C | some `?<unit>=<id>` in the query names an id different from the live one | `overridden = false` and `served` stays the pointer as read |
    | D | `refuseComposition` finds nothing to refuse | **400**, `that composition cannot be served: <reason>` |

9. Past gate B. The query string is read once per unit — `?shell=`, `?hello=`. Each parameter naming a different id goes into `chosen` and sets `overridden`. A plain visit names none, so `chosen` is the live set and gate C stops here.
10. Past gate D. `compose` rebuilds the manifest around `chosen`, taking each named unit out of the merged history and choosing the newest contract every unit in the new set supports.
11. Always, whichever gate stopped. `blockRefusal` and `apiRefusal` compare the shell's recorded surface against `blocks.provides.json` (read once at boot) and the service's `serves` list. That surface comes from the history, so a stop at gate A or B leaves it undefined and both headers read `unread` (`src/server/composition.ts:157-181`).

## 2 · The HTML that comes back

12. One document, `cache-control: no-store, must-revalidate`. It contains, in order (`src/server/html.ts:221-233`):
    - `<link rel="stylesheet">` — the shell's CSS in the store, with its sha384.
    - `<script type="importmap">` — the shell unit's own `imports` map, served as recorded with every file resolved against the **shell's** directory (`src/server/html.ts:83-92`). The server names no specifier, so the count is whatever that shell build wrote. This build writes five: `preact`, `preact/hooks`, `preact/jsx-runtime`, `@preact/signals` and `@pointer/shell` (`build.ts:268-274`). The map's `integrity` section is assembled separately and covers every `.js` file the shell and each app declare, not only the mapped specifiers — the shell's entry, its shared chunks and each panel's bundle, 14 entries in the build measured below (`src/server/html.ts:100-110`).
    - `<div id="app">`.
    - `<script id="__BUILD__">` — buildId, commit, publishedAt, channel, region, a `units` entry for the shell and every app the manifest carries, each with its id, commit and marker (`src/server/html.ts:17-22`), the contract hash, and `apiBase`. Four units here.
    - `<script id="__APPS__">` — each sub-app's JS URL, CSS URL and CSS digest.
    - `<script type="module" src="…units/shell/<id>/index-<hash>.js" integrity="sha384-…">`.
    - `<link rel="modulepreload">` for **every** sub-app the manifest carries, and `<link rel="preload" as="style">` for each of those that declares a stylesheet (`src/server/html.ts:190-205`). Three and three in this composition. `list`'s pair warms nothing that is not about to be fetched anyway, because this route mounts it. The other two pairs are the ones that buy something: this route mounts neither, and a visitor who later opens `/board` or `/week` gets the panel 762 to 779 ms sooner (`scripts/measure-preload.ts`, four arms of nine runs, 2026-09-13). A further sub-app in the pointer produces a further pair from the deployed binary, unrebuilt - which is what `week` did at `PLAN.md` step 5.
13. The `content-security-policy` header: `default-src 'none'`; `script-src` = the store origin plus the **sha256 of the import map's own bytes**; `style-src` = the store origin; `connect-src` = the service origin and nothing else; `base-uri`, `form-action`, `frame-ancestors` all `'none'`.
14. Four reading headers: `x-manifest-age`, `x-manifest-refresh`, `x-shell-blocks`, `x-shell-api`.
15. `handedOut.record()` adds this composition to what `GET /compositions` reports.

## 3 · The browser parses

16. The CSP applies to everything below it.
17. The shell stylesheet is fetched from the store, checked against its sha384, and blocks the first paint.
18. The import map is read. It must be parsed before any module import.
19. The parser reaches the end of `<body>` and starts two more store fetches for each sub-app the manifest carries, the bundle and its stylesheet — six in this composition, and four of them are for a panel this route does not mount. All are `public, max-age=31536000, immutable`.
20. The shell module is fetched and checked. Its imports of `preact` and the rest resolve through the map to more files in the shell's directory, each checked against the map's integrity entry.
21. Any file whose bytes do not match its digest is **not executed**. That is the only place the refusal is observable.

## 4 · The shell runs

22. `index.tsx` finds `#app`, or throws.
23. `createStore()` builds the shared signal store with built-in defaults.
24. `readApiBase()` reads `apiBase` back out of `__BUILD__`.
25. `store.setService(awaiting(base))` runs **before** the render, so the first paint says which service is being read and that it has not answered.
26. `render()` mounts `<ShellBoundary><Shell/></ShellBoundary>`.
27. `Shell.tsx` reads `__APPS__` at module scope, once.
28. The route is `location.pathname` = `/`. That view names `list`. `/board` names `board` and `/week` names `week`, and nothing on this route imports either — their files are warm and neither module has run. The `/service` and `/backup` views name no unit at all: the frame draws them, and neither ever gets one.
29. First paint: the title, the fixed sidenav, the view's own heading and note, and one empty slot marked `data-app-loading`.

## 5 · The panel

30. Each panel's effect calls `loadApp(name, assets)`.
31. `loadApp` appends a `<link rel="stylesheet">` with the panel's digest and **waits for it to load**, then `import()`s the bundle — in that order, so an unwarmed panel pays two cross-origin round trips in series. Both are already in cache from the warm: measured on 2026-09-12, each file carries exactly one resource timing across the whole visit, taken at 5 ms, and the import adds none.
32. A module with no function default export is rejected by name: "list has no default export, so it is not a sub-app".
33. The panel renders inside the shell's tree with the store passed as a prop. A throw is caught by that panel's own boundary, which offers "Mount again". The frame is untouched.

## 5b · The planner, in parallel with the panel

33a. Right after `render()`, the shell opens IndexedDB `pointer-planner` at version 1 and reads the `tasks` store (`src/web/shell/planner.ts`). It does not block the paint.
33b. Until that read lands, `PlannerReport.state` is `unread` and the panel draws neither the list nor "No tasks yet" - it says it is reading. A first visit reaches `stored` with an empty list a few milliseconds later; a browser that refuses IndexedDB reaches `unstored` and the panel says the tasks are kept in this page alone.
33c. From then on every change to the tasks starts a write, and `PlannerReport.pending` is true until it commits. On a first visit the database is CREATED by this open, so the `onupgradeneeded` that builds `tasks` and `meta` runs exactly once per browser.

## 6 · The service, in parallel with all of the above

34. Two reads start together, right after `render()`, and neither blocks the paint (`src/web/shell/index.tsx:57-66`).
35. `readService` → `GET /versions` on `pointer-deploy-api.fly.dev`. Not under a version prefix, because asking at a version needs the answer first.
36. `readData` → `GET /v1/greeting`. The body is not kept OR PARSED — no unit draws it since step 0 — and the RESPONSE is the point: whether the version this shell calls answers, which goes on `data-api`, and the `Sunset` header it carried. It went through a parser requiring `greeting.text` until 2026-09-11, which made a service answering `v1` correctly report a parse error on `data-api`.
37. Every response's `Sunset` header is remembered and folded into the report. It arrives only because the service sends `access-control-expose-headers`.
38. `data-api` on `<html>` becomes `ok` or the error text.
39. Client timeout is 5 s per call.
40. The page repaints with the real values. Everything before it was defaults.

## 7 · What does not happen

| | |
| --- | --- |
| The server reads no unit file | It reads one pointer, and `peek`s two more small JSON files |
| The page never calls `GET /units` | The server judges an override itself, so the page needs no catalogue. `connect-src` forbids the page's own origin |
| Nothing is fetched from the page's own origin after the HTML | Every script and style URL is the store; every `fetch` is the service |
| No unit file is ever refetched | Content-hash paths, immutable for a year |
| Nothing waits on the service | The paint happens first, and the planner is in this browser rather than in the service |
| Nothing waits on the planner either | The paint happens before IndexedDB is open. What the page must not do is claim the planner is EMPTY before that read lands, which is why `unread` is a state rather than an absence |

## The shape

Three request fans in sequence, not one chain: the server, then the store, then the service. One of the three counts is fixed. The server fan is always **1**. The store fan is the shell's own files plus two per sub-app, and the service fan is what the shell asks for. Measured in this composition: **1**, then **15**, then **2**.

| Fan | What sets the count | Here | What |
| --- | --- | --- | --- |
| Server | always 1 | 1 | The HTML |
| Store | the shell's own files, plus one JS and one CSS for each sub-app the manifest carries | 15 | 9 shell files — `index.js`, `index.css`, five `shared-*.js` chunks, `preact/hooks`, `preact/jsx-runtime` — and 2 panel files each for `list`, `board` and `week` |
| Service | the 2 this shell asks for at steps 35-36 | 2 | `GET /versions` and `GET /v1/greeting` |

Only the shell's own files are needed to paint — 9 of them here. Of the six panel files, `list`'s two are fetched AND run, because that unit is on the route a visitor lands on. The four belonging to `board` and `week` are fetched and never imported: neither module has executed, and a visitor who opens neither view pays four requests for nothing. What that buys the visitor who does open one is 762 to 779 ms, over four arms measured on 2026-09-13 - two per unit, nine runs each, the click taken ten seconds after this view settles. About 430 ms of that baseline is not the two fetches and nothing has said what it is, and neither has anything said why the warm arm scatters between 43 and 125 ms while the control arm holds between 807 and 850 - TODO §47. `scripts/measure-preload.ts` takes it with a control, and `--unit` says which of the two to measure.

Counted in a real Chrome against `https://pointer-deploy.fly.dev/`, one cold page load, 2026-09-13. It read **13** at three units on 2026-09-12 and **11** with the two-unit composition of 2026-09-10. Two numbers move with the build rather than with the design: the five `shared-*.js` chunks are this build's chunking, and `preact` and `@preact/signals` are mapped but never fetched, because nothing the page reaches imports those two specifiers.

That reading was taken while the deployed service still answered the previous slate's surface, so `GET /v1/greeting` returned 404. The count is the same either way — the page makes the call and draws the default when it fails, which is the behaviour, not a fault in the measurement.
