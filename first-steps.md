# What happens on a first visit

## 1 · The HTML request

3. The browser sends `GET /` with `Host: pointer-deploy.fly.dev`.
4. The server checks the fixed paths first: `/healthz`, `/compositions`, `/units`, `/assets*`. None match (`src/server/index.ts:79-99`).
5. `resolveTarget` reads the `Host` header against a table. `pointer-deploy.fly.dev` → channel `qa`. `FLY_REGION=ams` → region `eu`. A host not in the table is a 404 (`src/server/origins.ts:8`).
6. The server builds one URL: `https://pointer-deploy-assets.fly.storage.tigris.dev/manifests/eu/qa.json`. The two halves come from different places. `qa` came from this request's `Host`, so it can differ from one request to the next. `eu` came from the machine's own `FLY_REGION`, read once at boot into a module constant and passed into every request unchanged (`src/server/index.ts:34,124`). One machine serves one region for its whole life; no request can move it.
7. `manifests.get()` — **the pointer is already cached, even here**. Every channel's pointer and history, the catalogue and the service's version list are read at boot, and the port stays shut until they land (`src/server/index.ts:67-75`). A cold process serves its first request with `x-manifest-age` in the hundreds of milliseconds: the age of the boot read, not of a read this request made. This request waits on the store only where that boot read found nothing, because a prime that finds nothing leaves no trace. Fetch timeout 3 s, hard deadline 6 s (`src/server/manifest.ts:229-232`).
8. Tigris answers the pointer. It carries `cache-control: public, max-age=5`, so the edge may hand back a copy up to 5 s old (`scripts/store.ts:294`).
9. `parseManifest` turns those bytes into a value or throws (`src/server/manifest.ts:81`). **The manifest is this same pointer file** — `manifest` is the name the code uses for it. Its top-level `schema` field names the layout, and three are accepted:
    - **1** — `entry: { js, css }`: one bundle, one stylesheet, no sub-apps. Nothing in the repo writes one; it lives in the parser and its tests.
    - **2** — `shell { js, css }`, one `imports` map, one `apps` record, and **one `assetBase` shared by every unit**, so the six cannot move separately. One test channel points at a fixture kept permanently in `legacy/schema-2/`, because whether such a page still renders is only observable in a browser (`scripts/publish-schema-2-fixture.ts`).
    - **3** — each unit carries its own `unitId`, `assetBase`, `integrity` and `marker`, and the file carries a `contract` and a `composedAt`. Both real channels serve this, and it is the only schema under which one unit can move alone.

    Any other value throws `unsupported manifest schema`. A parse failure keeps the last good value and writes the reason into `x-manifest-refresh`; no value at all is a 503 (`src/server/index.ts:130`). `units/catalogue.json` and `<channel>.history.json` carry a `schema` field of their own, numbered separately — a `schema: 1` in those files is not this schema 1.
10. From here the handler is a branch, not a line (`src/server/index.ts:138-175`). Four gates decide the rest of this section. A plain first visit passes A and B and stops at C:

    | Gate | Test | A failure means |
    | --- | --- | --- |
    | A | `manifest.schema === 3` | no switcher and no override; straight to step 14 |
    | B | the channel's history `peek`s non-null, merged with `units/catalogue.json` | the same as A. It fails only where the boot read found nothing, because `peek` never makes a visitor wait on the store |
    | C | some `?<unit>=<id>` in the query names an id different from the live one | `overridden = false` and `served` stays the pointer as read — the switcher's options are still built |
    | D | `refuseComposition` finds nothing to refuse | **400**, `that composition cannot be served: <reason>` |

11. Past gate B. The query string is read once per unit — `?shell=`, `?alpha=` … Each parameter naming a different id goes into `chosen` and sets `overridden`. A plain visit names none, so `chosen` is the live set and gate C stops here.
12. Past gate B. `optionsFor` marks every id the channel has served and every published id as current / live / disabled, and computes each one's `since` from the entry below it. Past gate D, `compose` rebuilds the manifest around `chosen`.
13. Always, whichever gate stopped. `blockRefusal` and `apiRefusal` compare the shell's recorded surface against `blocks.provides.json` (read once at boot) and the service's `serves` list. That surface comes from the history, so a stop at gate A or B leaves it undefined and both headers read `unread` (`src/server/composition.ts:160-183`).

## 2 · The HTML that comes back

14. One document, `cache-control: no-store, must-revalidate`. It contains, in order (`src/server/html.ts:230-243`):
    - `<link rel="stylesheet">` — the shell's CSS in the store, with its sha384.
    - `<script type="importmap">` — five bare specifiers, `preact`, `preact/hooks`, `preact/jsx-runtime`, `@preact/signals` and `@pointer/shell`, all mapped to files in the **shell's** directory. The map's `integrity` section covers every file the page may import, not only those five: the shell's entry, its shared chunks and each panel's bundle — 15 entries in the build measured below.
    - `<div id="app">`.
    - `<script id="__BUILD__">` — buildId, commit, publishedAt, channel, region, all six unit ids and markers, the contract hash, and `apiBase`.
    - `<script id="__APPS__">` — each sub-app's JS URL, CSS URL and CSS digest.
    - `<script id="__VERSIONS__">` — the switcher's options, one entry per unit. Present here, because gate B passed.
    - `<script type="module" src="…units/shell/<id>/index-<hash>.js" integrity="sha384-…">`.
    - `<link rel="modulepreload">` for **all five** sub-app bundles, and `<link rel="preload" as="style">` for their five stylesheets.
15. The `content-security-policy` header: `default-src 'none'`; `script-src` = the store origin plus the **sha256 of the import map's own bytes**; `style-src` = the store origin; `connect-src` = the service origin and nothing else; `base-uri`, `form-action`, `frame-ancestors` all `'none'`.
16. Four reading headers: `x-manifest-age`, `x-manifest-refresh`, `x-shell-blocks`, `x-shell-api`.
17. `handedOut.record()` adds this composition to what `GET /compositions` reports.

## 3 · The browser parses

18. The CSP applies to everything below it.
19. The shell stylesheet is fetched from the store, checked against its sha384, and blocks the first paint.
20. The import map is read. It must be parsed before any module import.
21. The parser reaches the end of `<body>` and starts ten more store fetches: five sub-app bundles and five stylesheets. All are `public, max-age=31536000, immutable`.
22. The shell module is fetched and checked. Its imports of `preact` and the rest resolve through the map to more files in the shell's directory, each checked against the map's integrity entry.
23. Any file whose bytes do not match its digest is **not executed**. That is the only place the refusal is observable.

## 4 · The shell runs

24. `index.tsx` finds `#app`, or throws.
25. `createStore()` builds the shared signal store with built-in defaults.
26. `readApiBase()` reads `apiBase` back out of `__BUILD__`.
27. `store.setService(awaiting(base))` runs **before** the render, so the first paint says which service is being read and that it has not answered.
28. `render()` mounts `<ShellBoundary><Shell/></ShellBoundary>`.
29. `Shell.tsx` reads `__APPS__` and `__VERSIONS__` at module scope, once.
30. The route is `location.pathname` = `/`. That view names **alpha and bravo only**. Charlie, delta and echo were preloaded and are not mounted.
31. A layout effect sets `data-dark` on `<html>` before paint, so the page never shows one theme then the other.
32. First paint: masthead, name and colour inputs, tabs, the version row, and two empty slots marked `data-app-loading`. `Versions()` renders nothing where `__VERSIONS__` is empty, which is the gate A or B page (`src/web/shell/Shell.tsx:54-56`).

## 5 · The two panels

33. Each panel's effect calls `loadApp(name, assets)`.
34. `loadApp` appends a `<link rel="stylesheet">` with the panel's digest and **waits for it to load**, then `import()`s the bundle. Both are usually already in cache from the preload.
35. A module with no function default export is rejected by name: "alpha has no default export, so it is not a sub-app".
36. The panel renders inside the shell's tree with the store passed as a prop. A throw is caught by that panel's own boundary, which offers "Mount again". The other panel is untouched.

## 6 · The service, in parallel with all of the above

37. Three reads start together, right after `render()`, and none blocks the paint (`src/web/shell/index.tsx:58-74`).
38. `readService` → `GET /versions` on `pointer-deploy-api.fly.dev`. Not under a version prefix, because asking at a version needs the answer first.
39. `readSettings` → five requests at once: `/v1/limits`, `/v1/labels`, `/v1/flags`, `/v1/stats`, `/v1/motd`. `allSettled`, so whatever answers is kept. What did not is written to `data-settings` on `<html>`.
40. `hydrate` → `GET /v1/user` and `GET /v1/counters` together. It then sets the name, colour and theme, registers each namespace, and applies each count.
41. Every response's `Sunset` header is remembered and folded into the report. It arrives only because the service sends `access-control-expose-headers`.
42. `data-api` on `<html>` becomes `ok` or the error text.
43. Client timeout is 5 s per call.
44. The page repaints with the real values. Everything before step 44 was defaults.

## 7 · What does not happen

| | |
| --- | --- |
| The server reads no unit file | It reads one pointer, and `peek`s two more small JSON files |
| The page never calls `GET /units` | The switcher's options are rendered into the HTML. `connect-src` forbids the page's own origin |
| Nothing is fetched from the page's own origin after the HTML | Every script and style URL is the store; every `fetch` is the service |
| No unit file is ever refetched | Content-hash paths, immutable for a year |
| Nothing waits on the service | The paint happens first, from defaults |

## The shape

Three distinct request fans, not one chain: **1 request to the server**, then **19 to the store**, then **10 to the service**.

| Fan | Count | What |
| --- | --- | --- |
| Server | 1 | The HTML |
| Store | 19 | 9 shell files — `index.js`, `index.css`, five `shared-*.js` chunks, `preact/hooks`, `preact/jsx-runtime` — and 10 panel files, one JS and one CSS each |
| Service | 10 | The 8 the shell asks for at steps 38-40, plus `/v1/counters/alpha` and `/v1/counters/bravo` from the two panels that mount |

Only the 9 shell files are needed to paint. Of the 10 panel files, 6 belong to charlie, delta and echo, which the `/` view never mounts.

Counted in a real Chrome against a six-unit composition, one cold page load. Two numbers move with the build rather than with the design: the five `shared-*.js` chunks are this build's chunking, and `preact` and `@preact/signals` are mapped but never fetched, because nothing the page reaches imports those two specifiers.
