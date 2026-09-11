# What is being built on the slate

The slate was cleared on 2026-09-10 and holds two units. This is what goes on it, in what order, and why each step is a step. The process is the subject, so the order is part of the specification and not a schedule.

The `.feature` files remain the requirements and the acceptance suite. This file names which one each step writes; it does not paraphrase them.

---

## The application

A **personal planner**. One person, one browser. Tasks, drawn three ways.

Every task lives in IndexedDB in the visitor's own browser. Nothing leaves it unless the visitor asks. Two ways to ask: write a JSON file to disk, or push a snapshot to the service, which puts it in object storage and hands back an address. Another browser pulls that address and gets the same planner.

| | |
| --- | --- |
| Who it is for | One person, on a desktop browser |
| Where the data lives | IndexedDB, in that browser |
| How it is backed up | Export one JSON file, or push a snapshot to the service |
| How it moves between browsers | Pull a snapshot. A total overwrite, never a merge |
| What the service holds | Nothing. It holds a bucket key, and the bucket holds the snapshots |
| What the server holds | The HTML, as now. No unit files, no data |

### Why this application

Three views over one collection is the strongest available subject for the claim the project exists to make. The same tasks are drawn by three bundles that were built, published and deployed on three different days, and a visitor moving a task on the board watches the list reorder. Nothing about that is arranged for the demonstration; it is what the application is.

It also supplies state that persists across a deploy, which is the surface §11's family has been missing: a unit against its own past, where a rollback is asymmetric because code moves back and data does not.

---

## The units

| Unit | Route | Draws | First fetched |
| --- | --- | --- | --- |
| `shell` | the frame | title, fixed sidenav, routing, the store, IndexedDB, export, import, push, pull | always |
| `list` | `/` | every task: add, rename, tag, complete, delete | on the landing route |
| `board` | `/board` | one column per fixed column, and a task moves between them | preloaded, imported when the route is opened |
| `week` | `/week` | seven days, and every task that has a due date | preloaded, imported when the route is opened |
| — | `/service` | what the service holds and what it retires. The frame draws it | never |
| — | `/backup` | export, import, push, pull, and what IndexedDB currently holds. The frame draws it | never |

Two of the five routes name no unit, so the claim that such a view is legitimate keeps its subject. Two of the three units sit off the landing route, so the claim that preloading an off-screen unit buys something gets its subject back — §31 row 2.

**The shell owns export, import, push and pull**, rather than a fourth sub-app. All four move the same document, and that document carries the schema version for the whole planner. §15 puts shared state in the shell.

---

## The contract surface

```ts
export type Column = { id: string; label: string };

export type Task = {
  id: string;
  title: string;
  column: string;            // a Column.id
  due: string | null;        // YYYY-MM-DD
  tags: readonly string[];
  createdAt: string;
};
```

Which unit uses which member. This table is a design constraint and not a description: each sub-app must hold at least one member no other unit touches, or the member gate has nothing to refuse.

| Member | `list` | `board` | `week` | the frame |
| --- | --- | --- | --- | --- |
| `tasks()` | ✓ | ✓ | ✓ | |
| `columns()` | | ✓ | | |
| `addTask(title)` | ✓ | | | |
| `moveTask(id, column)` | | ✓ | | |
| `setDue(id, due)` | | | ✓ | |
| `setTags(id, tags)` | ✓ | | | |
| `removeTask(id)` | ✓ | | | |
| `goingAway(path)` | ✓ | | | |
| `service()` | | | | `/service` |
| `storage()` | | | | `/backup` |
| `exportDocument()` | | | | `/backup` |
| `importDocument(json)` | | | | `/backup` |
| `push()` / `pull(address)` | | | | `/backup` |

Dropping `moveTask` refuses `board` and nothing else. Dropping `setDue` refuses `week` and nothing else. That is the reading §31 row 1 lost when the slate went to one sub-app.

There is no "done" flag. A task is done when it is in the `done` column, so the board and the list cannot disagree about what done means.

---

## The service

`pointer-deploy-api` keeps its shape, its discovery document and its version machinery, and changes its subject. `greeting` goes.

**Its whole job is to be the only thing that may write to a bucket.** A browser cannot hold a bucket write key — TODO §4 already records that a bucket write key is a production-origin execution key — so the service holds it and the browser asks the service.

The service itself becomes **stateless**. Nothing is in memory between requests, so `api/fly.toml` can stop saying that auto-stop is off because the state is in memory.

```
GET    /versions              the discovery document, unchanged
POST   /v1/snapshots          body: the planner document  →  { snapshot, digest, createdAt }
GET    /v1/snapshots/:id      →  the planner document
POST   /v1/slots              →  { slot, writeKey }
GET    /v1/slots/:slot        →  { snapshot, history }
PUT    /v1/slots/:slot        body: { snapshot }, header: the write key  →  moves the slot
```

### The same mechanism, twice

A snapshot is written under the hash of its own bytes, is never overwritten, and is permanent. A slot is a small JSON file naming one snapshot id. Pushing writes a snapshot and then moves a slot.

| Code | Data |
| --- | --- |
| `units/<name>/<id>/` — content-hashed, immutable | `snapshots/<digest>.json` — content-hashed, immutable |
| `manifests/<region>/<channel>.json` — one id | `slots/<slot>.json` — one id, and the ids it held before |
| `promote` moves the pointer | `PUT /v1/slots/:slot` moves the slot |
| Rolling back names an older unit id | Restoring names an older snapshot digest |

That is the project's own mechanism applied to a second problem, and it is why data rollback is available here and was not before. It also inherits the same known hole: read-modify-write with no compare-and-set, which is TODO's last deliberate limit, now with a second instance.

### Two capabilities, one resource

| Holding | Grants |
| --- | --- |
| the slot id | read the slot, and read every snapshot it names |
| the write key | move the slot |

Sharing a planner is handing over the slot id. It is read-only by construction, and no account, login or user record exists anywhere. Say it on the page in those words: **anyone holding the slot id can read the planner.**

### The bucket

A **second, private bucket**, not `pointer-deploy-assets`, and a **second key**. The asset bucket's key can write the files the origin executes, so a service that held it would turn a service compromise into an origin compromise. The snapshot bucket is private, and the service is its only reader and writer.

### The deprecation, at step 13

v1 returns a snapshot as `{ snapshot, digest, createdAt, tasks }`. v2 wraps it: `{ …, document: { tasks, settings } }`, because a planner stores more than tasks once it stores anything. `snapshot.tasks` is deprecated with a notice period, the discovery document says so, every response carrying it says so in RFC 9745 `Deprecation` and RFC 8594 `Sunset`, and the `list` panel reports it through `store.goingAway("snapshot.tasks")` — with no unit rebuilt and no id moved.

---

## IndexedDB

Database `pointer-planner`, owned by the shell.

| Version | Object stores |
| --- | --- |
| 1 |  | `tasks`, keyPath `id`. `meta`, keyPath `key` — holds `schemaVersion` and `writtenAt` |
| 2 |  | adds index `by-due` on `tasks`; every task gains `tags` |

### Opening it

The shell opens with **no version first**, reads `db.version`, and then decides. Opening at a fixed version against a database that is already newer raises `VersionError`, and the shell must never be in a position to do that.

| Stored version | What the shell does |
| --- | --- |
| equal to what this shell expects | uses it |
| lower | closes, reopens at the expected version, runs the forward upgrade |
| **higher** | closes it, uses no cache, says so on the page, and **leaves every byte untouched** |

The third row is what a rollback produces, and the requirement is that it degrades rather than fails. A shell that meets data from a newer shell is not entitled to read it and is not entitled to delete it.

---

## One document, four doors

Export, import, push and pull all move the same JSON document.

```json
{ "format": "pointer-planner", "schemaVersion": 2, "exportedAt": "…", "tasks": [] }
```

Three of those doors let in data written by a version this shell has never seen, and **one rule covers all three**:

| Door | Who enforces the version |
| --- | --- |
| Opening IndexedDB | the browser, with `VersionError` |
| Importing a file | nothing. The shell must |
| Pulling a snapshot | nothing. The shell must |

| Case | Behaviour |
| --- | --- |
| `format` missing or not `pointer-planner` | refuse, and name the field |
| `schemaVersion` equal to this shell's | accept |
| `schemaVersion` lower | migrate the document forward, then accept |
| `schemaVersion` higher | refuse, and name both versions |
| accepted | **total overwrite** — every existing task is deleted, then the document's tasks are written |

The overwrite is **one IndexedDB transaction**, so an import or a pull that fails part-way leaves the planner exactly as it was.

Neither import nor pull merges. A merge needs conflict rules, and manual sync between two browsers one person owns generates no conflict worth a rule.

---

## The steps

Each step is one publish and one promote. Each names the one thing it demonstrates.

| Step | Done | Ships | Demonstrates | Feature file |
| --- | --- | --- | --- | --- |
| 0 | 2026-09-10 | The frame: five routes, three empty, `hello` removed | A view naming no unit is legitimate, and nothing is fetched for it | rewrite `serving-the-shell` |
| 1 |  | `list` on `/`, in memory only | A second unit, published and promoted alone | `keeping-a-list-of-tasks` |
| 2 |  | IndexedDB v1 in the shell | Tasks survive a reload; a fresh browser starts empty | `keeping-the-planner-in-the-browser` |
| 3 |  | `/backup`: export a file, import a file | Total overwrite in one transaction, and a file that is refused | `backing-up-the-planner` |
| 4 |  | `board` on `/board` | A third unit. Preloaded off the landing route, fetched and not imported | `moving-a-task-between-columns` |
| 5 |  | `week` on `/week` | Three bundles, one signals runtime, one store | `seeing-the-week` |
| 6 |  | Service: snapshots in a private bucket | The service holds no data and holds the only key. Push, then pull by digest | rewrite `reading-from-a-service` |
| 7 |  | Slots: a stable address and a write key | Push from one browser, pull in another. A `PUT` changes what a second browser draws, with no deploy | `sharing-a-planner` |
| 8 |  | Slot history and restore | Data rollback, by the same mechanism as the pointer | `restoring-an-older-snapshot` |
| 9 |  | Additive contract change: `setTags` | Nothing republishes. `contract:matrix` stays green | `contract:matrix`, not a scenario |
| 10 |  | Breaking change: drop `moveTask` | `promote` refuses `board` and names it. `list` and `week` are untouched | restores `bun run e2e:members` |
| 11 |  | A new `board` alone | The unit of release is a panel | `deploying-a-unit` |
| 12 |  | `promote --app board=<older id>` | The code rollback is the deploy command. Put beside step 8 | `deploying-a-unit` |
| 13 |  | Service deprecation: `snapshot.tasks` → `snapshot.document` | A field retires with notice. No unit rebuilt, no id moved | rewrite `reading-what-the-service-holds` |
| 14 |  | IndexedDB v2 | A forward migration runs on a planner that already has data | `migrating-the-planner` |
| 15 |  | Roll the shell back with v2 data present | The asymmetry, seen: code moves back and data does not | `rolling-back-onto-newer-data` |
| 16 |  | The fix: open with no version, degrade to no cache | The limit closed, and the data untouched | `rolling-back-onto-newer-data` |

### What step 0 settled, and what it cost

**Five routes, and which three are "empty".** The units table above names five: `/`, `/board`, `/week`, `/service`, `/backup`. It also says two of them name no unit — `/service` and `/backup` — which is the finished application. At step 0 none of the five names a unit, because the tree builds none, so "three empty" is read as the three that are **waiting for one**: `/` at step 1, `/board` at step 4, `/week` at step 5. The frame draws all five and says on each of the three which it is. That is the reading that makes step 1 the smallest next step: build `list`, place it on `/`, and move nothing else.

**That reading is prose and nothing checks it.** `views.test.ts` asserts five routes and zero placed apps, which is true under either reading, so a check that appeared to settle it settles only the count. The other reading — `/backup` is also waiting, for the shell code that draws it at step 3, so four of five are waiting for something — is not refuted here. It is named so that step 1 does not inherit a settled-looking assumption.

**No contract was minted.** Step 0 changes no declaration in `src/web/shell/api.ts` or `src/web/shell/subapp.ts`, so the surface at HEAD still hashes to `9d1b0a3`. That is checked rather than asserted: `build.ts` refuses a build whose HEAD surface the registry does not hold.

**A composition naming no sub-app is now legitimate.** `src/server/manifest.ts` used to refuse one at schema 3, which made the whole application a 503. Schema 2 still refuses one, and the file says why the two differ. `src/server/html.test.ts` now renders a schema-3 manifest with no app — the page every visitor gets from here on, and the one shape `bun test` did not touch: it was covered only through schema 1, which returns `{}` from a different branch.

**What lost its subject.** Going to zero units cost eight checks their subject, on top of the four the previous slate cost. TODO §31 lists every one of them, where it was, and which step brings it back. `bun run e2e` and `bun run e2e:members` exit non-zero rather than passing: a green check that measured nothing is the failure mode `~/projects/CLAUDE.md` exists to name.

**It is not one publish and one promote, and that is the finding.** Every other step in this table is. This one changes what a MANIFEST may say, which is the surface between the pointer and the running image, and that surface has no gate and no version. The first promote wrote a pointer with `apps: {}`, the deployed image threw `manifest names no apps` on it, `ams` kept serving what it had, and `iad` answered 503 to every request for `us` until the pointer was put back. TODO §36 carries it, with the readings.

**`iad` did not fail because it was suspended. It failed because it had nothing cached.** `prime` puts `checkedAt` back when a read yields nothing, so a cold entry's first `get` awaits, gets null, and the origin answers 503. `ams` survived by holding a value, not by being in `eu` — and any restart of it would have taken `eu` down the same way. `qa` was one machine restart from 503 in both regions. `src/server/manifest.test.ts` holds that state now; the suite had both halves of it and never the product.

**And the way back was not a command.** `--app hello=<id>` exited 1, because `--app` checked its name against what this tree builds. The recovery was an edit to `scripts/contract.ts` and a promote from a dirty tree, which `deploys/2026-09-10T21-15-37Z-qa/promote.json` records. That is fixed: a promote composes from the channel's own apps as well as this tree's units, so a unit the tree stopped building is carried and can be named, and `--drop <app>` is the only way one leaves. Verified live on 2026-09-10 — `--app hello=3bba892b` from a tree that builds no sub-app, twice, with a record for each.

**So step 0 is deployed as far as the running image allows.** `qa` serves the frame with five views, and the composition still names a `hello` unit that no view places: the page warms two files it never imports. Finishing it is a `fly deploy` of the server, and then `bun run promote qa --from-build`. Until that happens the `@live` scenario `The page names no bundle beyond the frame's own` passes against `test-qa` and would fail against the real `qa`, and `bun run verify:live` cannot pass at all: the suite promotes to `test-qa` from this tree, so it writes the pointer the image refuses.

Steps 1 and 2 are deliberately separate. A planner that forgets everything on reload is not a product, and shipping it first makes persistence a visible increment rather than an assumption nobody watched arrive.

Steps 8 and 12 are the pair to put on one slide: one rolls data back, one rolls code back, and they are the same operation.

Steps 15 and 16 are the pair the persistence question was deferred for on 2026-08-28. 15 must be **seen to break** before 16 is written.

---

## What this costs the suite

`~/projects/CLAUDE.md` requires every scenario to start from the cold state a fresh visitor sees. Persistence puts a clear step in front of every browser scenario, and any scenario that misses it becomes order-dependent.

| | |
| --- | --- |
| The step | `indexedDB.deleteDatabase("pointer-planner")` before the page is opened |
| Where it goes | The browser world's setup, once, so no scenario can forget it |
| The check | One `falsify` mutation removes it, and a named scenario must go red |

That last row is the point. A clear step nothing verifies is a clear step that will be silently dropped.

The live suite gains a second store to clean: snapshots and slots it wrote. They go under a `test-` key prefix, and the existing tripwire pattern covers them.

---

## Deliberate limits

Decisions, not gaps.

| Limit | Why it is accepted |
| --- | --- |
| No account, no login, no user record | The slot id is the permission. Adding identity would add every question identity brings, and this needs none of them |
| Anyone holding a slot id can read that planner | It is a bearer address, unguessable and never listed. The page says so in those words rather than implying otherwise |
| Snapshots are in a second, private bucket under a second key | The asset bucket's key writes files the origin executes. One key, one blast radius |
| One browser profile is one planner | Two browsers are two planners. A slot is the only bridge, and crossing it is a manual act |
| Clearing site data destroys the planner | The export and the snapshot are the backup, and `/backup` says so on the page |
| Import and pull overwrite, and never merge | A merge needs conflict rules, and manual sync between one person's own browsers generates none |
| Two pushes at once can lose one | Read-modify-write with no compare-and-set, the same hole the pointer has. Named twice, fixed once, by `If-Match` on the ETag |
| Snapshots are swept on a floor, never on a deploy | The same rule as the units: a browser holding a digest must still be able to fetch it |
| A week, and no month grid | Seven fixed columns is the whole calendar this needs |
| A task moves by button, not by drag | The button is what the browser suite drives. Drag adds no requirement |
| Desktop only | No breakpoint anywhere in the stylesheet, as now |
