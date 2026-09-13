# What is being built on the slate

The slate was cleared on 2026-09-10 and holds four units: the shell and three sub-apps. This is what goes on it, in what order, and why each step is a step. The process is the subject, so the order is part of the specification and not a schedule.

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

Three views over one collection is the strongest available subject for the claim the project exists to make. The same tasks are drawn by three bundles that were built, published and deployed on three different days, and a task added on the list is on the board, tagged on the list, moved on the board, and still one task. Nothing about that is arranged for the demonstration; it is what the application is.

This paragraph said "a visitor moving a task on the board watches the list reorder" until 2026-09-12. Step 4 built the board and the list does not reorder: it draws every task the planner holds, in the order the planner holds them, and says nothing about columns. Moving a task changes where it is and not whether it is, which is the scenario `A task moved on the board is still on the list` reads. The sentence described a list nobody specified.

It also supplies state that persists across a deploy, which is the surface §11's family has been missing: a unit against its own past, where a rollback is asymmetric because code moves back and data does not.

---

## The units

| Unit | Route | Draws | First fetched |
| --- | --- | --- | --- |
| `shell` | the frame | title, fixed sidenav, routing, the store, IndexedDB, export, import, push, pull | always |
| `list` | `/` | every task: add, tag, delete, rename. Completing is `board`'s, through `moveTask` at step 4; renaming is `renameTask` at step 9 - see below | on the landing route |
| `board` | `/board` | one column per fixed column, and a task moves between them | preloaded, imported when the route is opened |
| `week` | `/week` | seven days, and every task that has a due date | preloaded, imported when the route is opened |
| — | `/service` | what the service holds and what it retires. The frame draws it | never |
| — | `/backup` | export, import, push, pull, and what IndexedDB currently holds. The frame draws it | never |

Two of the five routes name no unit now that the slate is finished, so the claim that such a view is legitimate keeps a subject that is finished rather than waiting. Two of the three SUB-APPS sit off the landing route, so the claim that preloading an off-screen unit buys something has its subject back — §31 row 2. The shell warms every unit the composition carries, `list` included, so six files are warmed and four of them are for a view a visitor may never open. Step 4 built the first of those two units and step 5 the second. Both readings are in the sections below.

**The shell owns export, import, push and pull**, rather than a sub-app of their own. All four move the same document, and that document carries the schema version for the whole planner. §15 puts shared state in the shell.

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

It is also the whole surface, so a member the FRAME calls has a row here too. `planner`, `setPlanner`, `setService` and `loadTasks` had none until a cold read on 2026-09-13 put the table beside `members.test.ts` and found `ShellStore.planner` in all three sub-apps' use sets while this table said nobody called it.

| Member | `list` | `board` | `week` | the frame |
| --- | --- | --- | --- | --- |
| `tasks()` | ✓ | ✓ | ✓ | |
| `planner()` | ✓ | ✓ | ✓ | `/backup` |
| `columns()` | | ✓ | | |
| `addTask(title)` | ✓ | | | |
| `moveTask(id, column)` | | ✓ | | |
| `setDue(id, due)` | | | ✓ | |
| `setTags(id, tags)` | ✓ | | | |
| `removeTask(id)` | ✓ | | | |
| `renameTask(id, title)` | ✓ | | | |
| `goingAway(path)` | ✓ | | | |
| `service()` | | | | `/service` |
| `setPlanner(report)` | | | | the frame, after the read |
| `setService(report)` | | | | the frame, after the read |
| `loadTasks(tasks)` | | | | IndexedDB, `/backup`, and step 7's pull |
| ~~`storage()`~~ | | | | **not built.** `planner()`, minted at step 2, is this row under another name |
| ~~`exportDocument()`~~ | | | | **not built.** The frame calls `document.ts` |
| ~~`importDocument(json)`~~ | | | | **not built.** The frame writes through `loadTasks` |
| `push()` / `pull(address)` | | | | `/backup` |

**Three rows were struck out at step 3, and the reason is a design one.** A member that reads a document has to carry the DATABASE's schema version on the surface, where step 14's bump to 2 would mint a contract for a number no sub-app can see. `storage()` is the third row: step 2 already minted `planner()`, `/backup` draws it, and a second report of one fact is two readings that can disagree. Step 3's section below carries the whole reading, including the compiler error that is NOT the reason.

Dropping `moveTask` refuses `board` and nothing else. Dropping `setDue` refuses `week` and nothing else. That is the reading §31 row 1 lost when the slate went to one sub-app; step 1 restores the half that needs one sub-app, and step 10 the "and nothing else" half.

**A member is declared when a unit calls it, and not before.** The table is the finished surface. What `src/web/shell/api.ts` holds at any step is the rows the units built so far use, because a member no unit calls is surface the member gate cannot refuse anything for - which is what `greeting` and `setGreeting` became at step 0, and why step 1 minted a contract that drops them. So step 1 declares `tasks`, `addTask`, `setTags`, `removeTask` and `goingAway`; steps 4 and 5 add `columns`/`moveTask` and `setDue`; and step 9 adds `renameTask`, which is the last row `list` needs and the one member whose arrival can be additive, because by then there are two other published units that do not call it.

**That is also why `list` does not rename or complete a task at step 1.** The units table says it draws both. Completing is `moveTask`, which is `board`'s ALONE - this sentence used to read that step 4 gives `list` that, and a `list` calling `moveTask` would leave step 10 refusing two units where its whole demonstration is that it refuses one. The table is the constraint and it has one tick in that row. A task is completed by moving it to the `done` column on the board. Renaming is `renameTask`, and **step 9 is where it arrives** — as the additive change, because by then `board` and `week` are published against a surface that does not have it, and a member added to `ShellStore` grows no app's use set. That is the whole demonstration: one unit republishes, two do not, and `contract:matrix` stays green across the mint. Step 9's row used to read `setTags`, which step 1 minted; a step demonstrating an additive change to a member that already exists demonstrates nothing.

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

**Measured on 2026-09-13, before any of this was built.** `fly storage create` issues a key pair per bucket, and the id it issued for a new bucket is not the asset bucket's - so the second key this step needs exists. Private is the DEFAULT and `--public` is the opt-in. And the CLI is per-APP: it refuses a second Tigris project for an app that already has one, so the snapshot bucket belongs to `pointer-deploy-api` rather than to `pointer-deploy`, which is where this step wanted the key anyway. TODO §4 carries the readings and what taking them cost.

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

The shell ends up opening with **no version first**, reading `db.version`, and then deciding. Opening at a fixed version against a database that is already newer raises `VersionError`, and the shell must never be in a position to do that.

| Stored version | What the shell does | Built at |
| --- | --- | --- |
| equal to what this shell expects | uses it | step 2 |
| lower | closes, reopens at the expected version, runs the forward upgrade | step 14 |
| **higher** | closes it, uses no cache, says so on the page, and **leaves every byte untouched** | step 16 |

The third row is what a rollback produces, and the requirement is that it degrades rather than fails. A shell that meets data from a newer shell is not entitled to read it and is not entitled to delete it.

**The last column is the whole reason steps 15 and 16 exist, and it was nearly read the other way.** This section describes where the shell ENDS UP, and a reader taking it as the design to build at step 2 would open with no version from the start - which is strictly safer, and which would leave step 15 with no `VersionError` to produce and step 16 with nothing to fix. So step 2 opens at the one version it knows, and `src/web/shell/planner.ts` says why at `SCHEMA_VERSION`. The limit is real while it stands: a visitor who is served a rolled-back shell between step 14 and step 16 meets a page that cannot open its planner at all. Step 15 is where that is measured rather than reasoned about.

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
| 1 | 2026-09-11 | `list` on `/`, in memory only | A second unit, published and promoted alone | `keeping-a-list-of-tasks` |
| 2 | 2026-09-11 | IndexedDB v1 in the shell | Tasks survive a reload; a fresh browser starts empty | `keeping-the-planner-in-the-browser` |
| 3 | 2026-09-11 | `/backup`: export a file, import a file | Total overwrite in one transaction, and a file that is refused | `backing-up-the-planner` |
| 4 | 2026-09-12 | `board` on `/board` | A third unit. Preloaded off the landing route, fetched and not imported | `moving-a-task-between-columns` |
| 5 | 2026-09-13 | `week` on `/week` | Three bundles, one signals runtime, one store | `seeing-the-week` |
| 6 |  | Service: snapshots in a private bucket | The service holds no data and holds the only key. Push, then pull by digest | rewrite `reading-from-a-service` |
| 7 |  | Slots: a stable address and a write key | Push from one browser, pull in another. A `PUT` changes what a second browser draws, with no deploy | `sharing-a-planner` |
| 8 |  | Slot history and restore | Data rollback, by the same mechanism as the pointer | `restoring-an-older-snapshot` |
| 9 |  | Additive contract change: `renameTask` | `board` and `week` do not republish and still compile against the new contract. `contract:matrix` stays green | `contract:matrix`, not a scenario |
| 10 |  | Breaking change: drop `moveTask` | `promote` refuses `board` and names it. `list` and `week` are untouched | restores `bun run e2e:members` |
| 11 |  | A new `board` alone | The unit of release is a panel | `deploying-a-unit` |
| 12 |  | `promote --app board=<older id>` | The code rollback is the deploy command. Put beside step 8 | `deploying-a-unit` |
| 13 |  | Service deprecation: `snapshot.tasks` → `snapshot.document` | A field retires with notice. No unit rebuilt, no id moved | rewrite `reading-what-the-service-holds` |
| 14 |  | IndexedDB v2 | A forward migration runs on a planner that already has data | `migrating-the-planner` |
| 15 |  | Roll the shell back with v2 data present | The asymmetry, seen: code moves back and data does not | `rolling-back-onto-newer-data` |
| 16 |  | The fix: open with no version, degrade to no cache | The limit closed, and the data untouched | `rolling-back-onto-newer-data` |

### What step 5 settled, and what it cost

**The slate's unit list is finished, and the fourth unit cost two published bundles nothing.** `week` draws seven days on `/week` and `setDue` is the one member it adds. Contract `9e59f0c` is additive over `f766e10`, and **both** `list` and `board` came out of the build with the ids they already had - `2adce208`, which step 2 promoted, and `de7a91d7`, which step 4's cold-read fix produced. A whole unit arrived and two of the three published bundles did not move. Step 4 made that claim about one unit; this is the same claim with a second subject, and it is the shape step 9 needs.

**Each of the three sub-apps holds at least one member the other two do not call.** Measured by `bun run build`'s member reading on 2026-09-13, and asserted in `members.test.ts` for all three at once rather than for a pair:

| Unit | Members nothing else calls |
| --- | --- |
| `list` | `addTask`, `removeTask`, `setTags`, `goingAway` |
| `board` | `columns`, `moveTask` |
| `week` | `setDue` |

That is what step 10 needs. Dropping `moveTask` has to refuse `board` and leave `list` and `week` alone, and "and nothing else" is a claim about the other units rather than about one - so it needed a third before it could be made at all.

**`Task.due` had no user until now, and `Task.createdAt` still has none.** The member reading on 2026-09-11 put both in nobody's set, because a task HAS them and nothing read either. `board` gave `Task.column` a user at step 4 and `week` gives `Task.due` one here, each with nothing declared anywhere. `createdAt` stays in nobody's set on purpose: `planner.ts` sorts the restored list by it, and that is shell machinery rather than a member a sub-app calls. TODO §45 is what that field is still missing.

**The seven days are the unit's own and are NOT on the contract surface.** `columns()` is on it because `board` draws one panel per column and a task moves between them, so two units have to agree on the set. Nothing has to agree with a week: a date is a date, `setDue` takes it, and which seven days are drawn is this panel's reading of the clock. Putting a `days()` on the surface would have been a member no other unit could ever call, which is what `greeting` was.

**Monday to Sunday, and not the next seven days.** A rolling window moves a task to a different panel overnight for no reason a person did anything about. The cost is that the panel is time-dependent, so no scenario may name a date: every one of them names a day by its POSITION, and the harness reads the value off the page rather than working out which Monday it is. A second reading of the week in the harness would pass whenever the two agreed.

**Both off-screen units were measured, and each carries its own control.** Step 4 measured `board` alone, because it was the only unit off the landing route. Step 5 makes four of the six warmed files belong to views a landing visitor may never open, and `scripts/measure-preload.ts` takes `--unit` now and reads the route out of `views.ts` rather than out of a literal.

**What the table below is NOT.** It is two runs of one script, minutes apart, each publishing its own build, pointing `test-qa` at it, starting its own server and its own browser. The script strips all the warm tags or none, so there is no arm with one unit warmed and the other not, and nothing here compares two warmed files against four. Each column pair is a fresh warm-against-control reading for one unit, and that is the whole of what it says. A cold read on 2026-09-13 asked what controls the drift between the two runs; nothing does, and the two are printed side by side because they are the same protocol and not because they are one measurement.

**The protocol is the paused one, for both units.** `--runs 9 --pause 10000`, so the click is taken ten seconds after the landing view settles rather than at the moment Chrome's preload cache is hottest. Step 4's headline 780 ms came from the UNPAUSED arm (52 against 832) and its paused arm read 56 against 836. So the number to set 55 against 822 beside is 56 against 836, and the same cold read is why that is said here rather than left to be compared wrongly.

Four arms, two per unit, because the branch was measured again after a cold read changed the panel:

| Run | Unit | Warm, median of 9 | Warm, every run | Control, median of 9 | What the warm bought |
| --- | --- | --- | --- | --- | --- |
| first | `board` | 55 ms | 46 to 68 | 822 ms | **767 ms** |
| first | `week` | 60 ms | 45 to 121 | 839 ms | **779 ms** |
| second | `board` | 67 ms | 43 to 112 | 829 ms | **762 ms** |
| second | `week` | 55 ms | 48 to 125 | 821 ms | **766 ms** |
| step 4, paused | `board` | 56 ms | — | 836 ms | 780 ms |

And the readings that do not vary, in all four arms:

| Reading | Warm | Control |
| --- | --- | --- |
| the unit's files in the browser before the view is opened | 2 | 0 |
| files fetched across the visit | 2 | 2 |
| what started them | `link`, `other` | `link`, `script` |
| content-policy refusals | 0 | 0 |

**The warm arm is NOISY and the control arm is not, and the second pair of runs is what says so.** Across 36 warm runs the readings fall between 43 and 125 ms; across 36 control runs they fall between 807 and 850. The first pair looked like a difference between the units - `week` ran 46, 60, 51, 46, 92, 45, 106, 113, 121 while `board` stayed inside 46 to 68 - and this section said so. The second pair puts `board` at 43 to 112 and `week` at 48 to 125, so the scatter belongs to the run and not to the unit. **What it is, this script cannot say**; it is not the two fetches, which are reported per run, and it is not the control arm.

That is a claim withdrawn by measuring it again rather than by arguing, and the shape of the mistake is worth keeping: nine runs of one arm looked like a property of a unit, and were a property of nine runs. What survives is the number the four arms agree on - the warm opens the view between **762 and 779 ms** sooner - and every one of them is a median of nine.

**And §47's own number moved.** The control arm's two fetches add up to 319 to 515 ms of a median 821 to 839, so roughly **430 ms** is neither fetch, where step 4 measured about 530 ms of 832. The fetches got slower and the baseline did not, which narrows the gap without explaining it. A `Promise.all` in `loader.ts` would still recover at most the shorter of the two.

**Sixteen scenarios, twenty mutations, and all twenty caught. Eight of the sixteen scenarios still have no mutation of their own.** Seven mutations are `@local` - what a DATE is and what a WEEK is, in the store, the document reader and `week.ts`, all three pure - and thirteen need a browser. `bun run verify:browser` is what runs the thirteen; `bun run verify` and `bun run verify:live` reach none of them, which is the reason that command is in `CLAUDE.md`'s table.

**A count of mutations is not a count of scenarios covered, and this branch first wrote it as though it were.** Fourteen caught was true and said nothing about which scenarios were falsified. A cold read on 2026-09-13 found the Rule this section names as the step's demonstration - three bundles over one store - carrying no mutation at all, so six were added: a move that drops the task's date, a date that cannot be taken off, a page that draws a task twice, a week that is the next seven days, a day named for the wrong weekday, and an out-of-week date that can be chosen again. Eight scenarios are still unmutated and that is the reading, not a gap being hidden.

**`week.ts` is a module of its own so the Monday rule has a check that does not depend on the calendar.** `weekOf` and `label` are pure and take the moment as an argument, and `week.test.ts` reads them over fixed dates - a Sunday, a Monday, a year boundary, a leap day. The mutation this branch first DECLINED, cutting the Monday offset so the week starts today, is in the array now and aimed at that test: it is a no-op on a Monday and no-ops are exactly what a fixed date removes. There was no test file anywhere under `src/web/apps/` before this; the `.feature` file still names days by position, because that is a rule about reading a page a panel drew from the clock it was given.

**§35's guard fired twice, which is its second and third real use.** Both mutations were written as cuts and both cuts stopped the build rather than the check: `onPick(held)` left the chosen value assigned and read by nothing, and `outside && false` has type `false`, so tsc dropped the narrowing that made `held` a string and the build failed with TS2322. Both are re-aimed to keep the value read. A mutation that does not compile is reported as caught by a check that never ran, which is exactly what that guard refuses.

**One mutation was declined, and the reason is the calendar.** Cutting the Monday offset out of `weekOf` makes the week start today - a no-op on a Monday, so the mutation would be caught six days in seven and the reading would depend on what day the suite was run. What is in the array shifts every day by one whatever the date is. The scenario that catches it asserts three things at once: the seven days are consecutive, day 1 is a Monday, and today is among them.

**Every task the planner holds is on the page once.** A task is on a day, under No date, or under Another date, and never in two of those and never in none. The board's report at step 4 was built for the state where a panel draws a count per group rather than a total, so every number on the page agrees while a task is missing from all of them; this is the same requirement made total.

The scenario that reads it compares the titles on the page against the titles in **the planner's object store**. It compared them against `tasks.length` on the panel's own root until a cold read on 2026-09-13 named that as the correction `board.steps.ts` had already taken at step 4: a value the panel derived from the same `store.tasks()` the cards come from is one value drawn twice, not a cross-check. The database is a source this panel never saw. The titles are compared as a sorted LIST and not as a set, because `addTask` permits two tasks with one title and a set would turn a legitimate planner red.

**A `due` that is not a date is refused at two doors and reported at the third.** `setDue` refuses it silently, because `ShellStore` has no way to report anything - it returns nothing, and a member for reporting a refusal is a member no sub-app asked for. `readDocument` refuses it by name and says the shape, and that door is the one a person reaches with a text editor. IndexedDB is the third and guards nothing, for the reason `PLAN.md` gives for the whole planner at steps 15 and 16 - so the week prints the value the task carries and a person can see it. TODO §46 was a door on one field and is a door on two from this step.

**One rule, two callers.** `isDueDate` is in `document.ts` and called from `readTask` and from `setDue`. `2026-02-30` matches `\d{4}-\d{2}-\d{2}` and `Date.parse` reads it - as 2026-03-02, because the parser rolls the day over - so the pattern alone is not the rule and the round trip is the arm that catches it. `api.ts` imports it WITHOUT the `.ts` extension every other import in this tree carries, and the rule is VALUE against TYPE rather than the extension by itself. Measured on 2026-09-13 in an isolated program with `allowImportingTsExtensions: false`: a value import carrying the extension is TS5097 and a type-only import carrying it is not, so `api.ts` needs the extension gone and `document.ts:1` does not - which is why `emitSurface` still passes now that `api.ts` pulls `document.ts` into the emit program for the first time. A cold read on 2026-09-13 asked that question; what was recorded before it was the OUTPUT check, that `document` appears nowhere in the emitted surface, which is a different claim and is also still true.

**Read cold by `devils-advocate-agent` before merge, and it found fifteen items.** All fifteen are answered on the branch; three changed code and one of the fifteen was wrong.

| What it was | What holds it now |
| --- | --- |
| **The reason `setDue` may refuse silently was an argument about the panel's option set, and the option set held a value that need not be a date.** `DuePicker` drew the task's own out-of-week date as an option, and `"yesterday"` is exactly what reaches that branch. What kept it from being written back was that a select fires no `change` for the option already chosen - a DOM event rule nothing recorded and nothing tested | That option is `disabled`, so every option a visitor can CHOOSE is one of the seven days or the empty value, and a scenario reads it. The store's reason is now the store's own: `ShellStore` returns nothing and has no member for reporting a refusal, so the choice is to write the value or not. The panel argument was also about a bundle `api.ts` cannot see - steps 10 to 12 are the claim that a shell serves a `week` it was not built beside - and the same correction is made to `moveTask`'s comment |
| **`label` read the weekday off the day's POSITION in the row**, so a heading could never disagree with the position: a week anchored on the wrong day drew `MON 6 SEP`, and neither the page nor the deploy record's pictures could contradict it | The weekday comes off the date. `week.test.ts` reads seven labels against seven dates, and a mutation flips the offset |
| **The accounting scenario compared the cards against `tasks.length` on the panel's own root** - a value derived from the same `store.tasks()` the cards come from. That is the correction `board.steps.ts` took at step 4, made again | It compares the titles on the page against the titles in the planner's object store, which this panel never saw, as a sorted list rather than a set |
| The Rule this section names as the step's demonstration carried no mutation, and eight of sixteen scenarios had none | Six mutations added. Eight scenarios still have none, and that is said rather than left to a count |
| The Monday rule was checked only by a browser scenario against the real clock | `week.ts`, `week.test.ts`, and the declined mutation back in the array aimed at it |
| The two preload readings were printed as one table under one protocol | Said to be two runs of one script, each with its own control, with no arm comparing two warmed files against four, and step 4's PAUSED reading given as the comparable one |
| The extensionless import was recorded as a rule about the extension | Measured: value against type. A value import carrying `.ts` is TS5097 and a type-only import carrying it is not |
| Stale counts in `first-steps.md`, `OVERVIEW.md`, `serving-the-shell.feature` and `frame.steps.ts` | Every one measured on 2026-09-13 and corrected. `OVERVIEW.md`'s suite table read 424 / 54 / 45 / 13 / 92 and was three slates behind; a third of the suite stood behind no requirement row |
| `seeing-the-week.feature` pointed at a `week` warming scenario that was never written | Three written, including one reading both off-screen units in a single load |
| Five files said the page warms two bundles | It warms three, and four of the six files are off the landing route |
| The contract table called itself the finished surface and had no row for `planner`, `setPlanner`, `setService` or `loadTasks` | Four rows added |
| **One was wrong.** It read `GET /v1/greeting` as gone since step 1 | `service.ts:13` is `DATA_PATH = "greeting"` and the call is still made. What changed at step 1 is the READING - the status and the `Sunset` header, nothing out of the body - which `first-steps.md:101` says |

**What it cost.** Two `.feature` files carried the unit list as a literal - `serving-the-shell.feature` and `warming-a-unit-before-its-view.feature` both named `"list, board"` - and both went red on a correct composition. That is `e2e:members`'s step-1 unit count again, in a file rather than in a script, and both are now the finished list rather than a count. `bun run pr` could not preview this branch for the same reason step 4's could not: the origin composes from the pointer and ignores an override naming a unit the pointer does not carry, so the order inverts again - promote, shoot the record, and the pull request carries the record's pictures. TODO §34 holds the fix.

### What step 4 settled, and what it cost

**The warm has a subject, and it is worth 780 ms.** `board` is the first unit this repository has placed on a route a visitor does not land on, so the `modulepreload` and style preload the shell has emitted since §17 finally warm a file the landing page is not about to import anyway. `scripts/measure-preload.ts` takes every reading twice - once from the page as served, once from the same page with the warm tags cut out of the HTML on the way to the browser - so both arms run against one origin, one store, one pointer and one build, and nothing but the tags differs.

| Reading | Warm | Control |
| --- | --- | --- |
| `board`'s files in the browser before `/board` is opened | 2 | 0 |
| files fetched across the visit | 2 | 2 |
| what started them | `link`, `other` | `link`, `script` |
| click to panel on screen, median of 9 | **52 ms** | **832 ms** |
| every run, ms | 41 to 68 | 821 to 837 |
| the same, after 10 s on the landing view, median of 5 | 56 ms | 836 ms |
| content-policy refusals | 0 | 0 |

**Nine runs and a paused arm, because a cold read named three runs and a hot cache as the weakest points in the branch.** Both objections were right to make and neither changed the number. The spread is 27 ms wide on the warm arm and 16 ms on the control arm, so a median of three was not hiding a range. And the 52 ms is not the moment Chrome's preload cache is hottest: clicking after ten seconds on the landing view reads 56 ms against 836 ms, the same 780 ms.

**Where the control arm's 832 ms goes, and it is not all round trips.** `loader.ts` awaits the STYLESHEET and only then imports the module, so the control arm pays two cross-origin fetches in series. Measured per run: the stylesheet takes 143-167 ms and the module 139-192 ms, and the two add up to 284-354 ms. **So about 530 ms of the 832 is not accounted for by either fetch** - and the warm arm's whole 52 ms says it is not module evaluation or rendering either, because those happen in both arms. This script cannot say what it is. What follows for the design is one thing and not another: a `Promise.all` in `loader.ts` would recover at most the SHORTER of the two fetches, about 150 ms of 832, and not half of it. TODO §47 carries both the unaccounted time and the parallel fetch.

**A scenario CAN read this now, and the one that reads it best was already written.** README's own finding stands - "the bundle was fetched once after the navigation" is true with the warm and without it - so the count is not the reading. What discriminates is `PerformanceResourceTiming`: a file fetched because of a tag reports `initiatorType` `other` for a module and `link` for a stylesheet, and the same file fetched by a dynamic `import()` reports `script`. Measured, not assumed: the first version of `warming-a-unit-before-its-view.feature` asserted `link` for both and went red on the module. What is asserted now is that nothing there was started by an import, which is the design's own claim - a hint fills the cache, and an import would have RUN the module for a visitor who may never open the view.

**And one scenario that measured nothing now measures this.** `Moving between views draws each one and fetches nothing` was a statement about five views placing one unit between them. Step 4 makes the walk open a view that DOES place one, and the count is still zero - because the files were already warm. Measured on 2026-09-11: 0 requests across the walk. The `the page warms nothing, and the walk pays for it` mutation turns it red, so the scenario that was a statement about placement is now also the cheapest reading of the warm there is.

**`list` did not republish, and that is the contract claim.** `f766e10` adds `Column`, `ShellStore.columns` and `ShellStore.moveTask` and is **additive** over `1c4a120`, so nothing published against step 2's surface breaks. `list`'s id came out of the build unchanged at `2adce208` - the id step 2 promoted - while the shell moved. Three units are now published, and the contract matrix reads `board` as compiling against `f766e10` alone, because it is the first surface that has the members it calls.

**Each unit holds a member the other does not call, in both directions.** That is `PLAN.md`'s contract table working as a design constraint rather than a description, and it is measured rather than declared: `bun run build`'s member reading gives `board` `ShellStore.columns` and `ShellStore.moveTask` and gives neither to `list`, and gives `list` `addTask`, `removeTask` and `setTags` and gives none of them to `board`. `members.test.ts` asserts both directions. Step 10 drops `moveTask` and reads the refusal that names `board` and leaves `list` alone; without this, that step would have had nothing to demonstrate.

**`Task.column` had no user until now.** The member reading on 2026-09-11 put `Task.column` and `Task.due` in nobody's set, because a task HAS them and nothing moved either. `board` moves one, so the reading picks it up with no declaration anywhere; `due` stays unused until `week` at step 5.

**A column no column names is refused in two places, and only one of them can be reached.** `moveTask` refuses one silently, because the board draws its buttons from `columns()` and no control can produce one - so a sentence there would be a sentence nothing reaches. `readDocument` refuses one by name, and that one IS reachable: a hand-edited file, or a planner written by a tool. The reason both exist is what such a task would be - in the planner, drawn by `list`, and on no panel of the board, reachable only by exporting the file again. The columns reach `readDocument` as an ARGUMENT from `store.columns()` rather than as an import, because a constant exported from `api.ts` for it to read would be a member no sub-app calls, which is what `greeting` was.

**Twelve mutations, and four of them run on `bun run falsify`.** Measured on 2026-09-12: **4 of 4 `@local` caught**, and **8 of 8 `@browser` caught** under `FALSIFY_LIVE=1`. One needed re-aiming for the reason step 1's tag-box mutation did: cutting `if (planner.state === "unread")` to `if (false)` leaves `planner` read by nothing, `noUnusedLocals` fails the build, and §35's guard refuses the reading rather than counting it. `&& false` keeps the field read and the branch dead.

**And one of the twelve was caught for a reason its own comment got wrong.** `a move is drawn without being written` claimed the card would appear in the new column because the panel re-rendered from a store that changed nothing. This panel cannot do that: it holds no state of its own and draws every card off `store.tasks()`, so the mutation is caught by the move step's own wait and the persistence claim had no mutation behind it at all. Refuted by `devils-advocate-agent` on 2026-09-12. The entry is renamed to what it does and a second one, `a task's column is not kept`, is aimed at `planner.ts` - where the claim actually is, because `PLAN.md` step 2 says a sub-app does not know a database exists.

**Two claims TODO §31 was holding came back, and one of them came back short.** Warming an off-screen unit now buys something measurable, which is the row above. "Two independently deployed sub-apps share one signals runtime" came back as far as this composition allows: `list` and `board` are two separately published bundles over one store, and a task added through one is drawn by the other. What is NOT here is a panel redrawing because ANOTHER panel wrote - the two units are on different routes and never share a view, so no scenario can arrange it. `shared-state.feature` had five panels on one page; nothing on this slate can. TODO §31 carries the difference rather than claiming the row closed.

**Read cold by `devils-advocate-agent` before merge, and it found nine defects and six wrong sentences.** All of them are fixed on this branch.

| What it was | What holds it now |
| --- | --- |
| **IndexedDB is a third door on the column value and nothing guards it.** `moveTask` refuses a column no column names and `readDocument` refuses a document carrying one; `planner.ts` contains no occurrence of `column`. A later shell's columns, or steps 15 and 16, put a task in the planner, on the list, on no panel of the board - and the board draws per-column counts rather than a total, so every number on the page agreed | The board REPORTS it: `unplaced` names the task and its column. One `@browser` scenario arranges it by writing straight into the database, one mutation removes the report. Not a refusal, because a shell that deleted a task it did not understand would be destroying data it is not entitled to. TODO §46 is the door |
| **Nothing asserted that `f766e10` is additive over `1c4a120`.** The claim rested on one line `contract:mint` printed into a terminal, and `contract:matrix` corroborates it by compiling units rather than by reading the direction | `scripts/contract.test.ts` reads the direction on every published pair after the first, named rather than looped, so a mint that is not additive has to be argued for here. Step 9's whole demonstration rests on that reading |
| A mutation caught for a reason its comment got wrong, and no mutation on the column reaching the database | Re-aimed and renamed, plus `a task's column is not kept` on `planner.ts` |
| Three runs and a click taken at the hottest cache moment | Nine runs, the spread reported, and a second arm that pauses ten seconds. Both readings are 780 ms |
| The 780 ms attributed to the warm with no decomposition | The two fetches are reported per run. They are 284-354 ms of 832, so about 530 ms is unaccounted for, and that is said rather than filled in |

The six sentences: `README.md` said in four places that `/board` places no unit, which `views.ts` had stopped being true of; `features/steps/frame.steps.ts` said the subject was the four views that name none, and it is three; `moving-a-task-between-columns.feature` said the warm makes §41's margin NARROWER and `falsify.ts` said WIDER, and the feature file was wrong - a warmed panel mounts sooner, so the requirement is more reachable; `falsify.ts`'s own section comment said five of eight were `@local` where the array held four and four; and `board.steps.ts` called the per-column counts an independent cross-check when the panel computes both from one `held`.

**What it cost.** `e2e:members` checked `Object.keys(baseline).length === 2`, which was step 1's unit count written as a literal, and failed on a composition that was correct. It counts `UNITS.length` now, and both `bun run e2e` and `bun run e2e:members` were green at three units on 2026-09-12. Step 4 opened §46 and §47; step 3's §43, §44 and §45 are all still open.

### What step 3 settled, and what it cost

**A whole view arrived and the contract did not move.** `/backup` writes the planner to a JSON file and reads one back over the top, and the surface at HEAD still hashes to `1c4a120`. The frame calls `src/web/shell/document.ts` itself and writes what it read through `ShellStore.loadTasks`, which step 2 had already minted for the database's own read. That member has two callers - `index.tsx` with what came out of IndexedDB, and `Shell.tsx` with what came out of a file - and a third at step 7, and every one of them is a TOTAL replacement - which is why there is no member for adding some tasks to the ones already held, and why one assignment is one IndexedDB transaction rather than one per task. Step 0 settled that a view naming no unit is legitimate. This is the same claim one level down: a view naming no unit needs no surface either.

**Three rows of the contract table were struck out, and the reason is not the compiler error that was met first.** `exportDocument()` and `importDocument(json)` were written into that table on 2026-09-10, before step 1 sharpened the rule that a member no unit calls is surface the member gate can refuse nothing for. `import { readDocument } from "./document.ts"` in `api.ts` does fail the surface emit with TS5097, because `emitSurface` sets `allowImportingTsExtensions: false` against a root `tsconfig.json` that sets it true - **and that is one line in `scripts/contract.ts`, not a property of `api.ts`.** `subapp.ts` already reaches across the surface by the `@pointer/shell` alias, and an extensionless import resolves under `moduleResolution: bundler`. The reading first written here called the emit a wall; `devils-advocate-agent` refuted it on 2026-09-11 and it is corrected rather than removed, because the error is what sent the design the right way.

**The reason that stands is the schema version.** A member that reads a document has to know what version this shell reads, and `SCHEMA_VERSION` belongs to `planner.ts`. Putting it on the surface means step 14's bump to 2 mints a contract for a number no sub-app can see, and `emitSurface` writes the literal into `shell.d.ts`, so the bump is unavoidable rather than incidental. The third row, `storage()`, is `planner()` under another name: step 2 minted it, `/backup` draws it, and a second report of one fact is two readings that can disagree.

**The refusal names the field, and that is the whole of "a file that is refused".** `format`, then `schemaVersion`, then every task in order, and the sentence says which one stopped it: `tasks[1].column is 7, and a string was expected`. A refusal carries a sentence rather than a code because it has one reader - the page - and one job, which is to send a person somewhere in a file. A lower `schemaVersion` is refused too, and the table above says it should be MIGRATED: there is nothing to migrate from until step 14, and a branch falling through to accept would write a document built to rules this shell does not have.

**A task read OUT of a document is rebuilt field by field and never spread.** (`documentFrom` spreads on the way in, which is safe for a different reason: every task in the store came from `addTask` or from this rebuild, so no unknown field can be in one.) A document at this schema version may carry fields this shell has never heard of - hand-edited, or written by a tool - and spreading them would put them in IndexedDB, hand them back out of the next export, and leave a planner carrying data no version anywhere describes. One unit test holds it and one mutation removes the rebuild.

**"One transaction" was reasoning until two arrangements made it a measurement, and the two are not worth the same.** The overwrite was already one transaction and nothing had ever seen one fail.

| The arrangement | What it is worth |
| --- | --- |
| The database gives up on the transaction | A failure a browser really produces - a quota that runs out, a disk that fails. The browser rolls the whole transaction back, the clear with it, and the scenario measures that |
| The browser refuses a record as it is QUEUED | **Not reachable from any input this shell has.** The clear and every put before the refusal stay queued and the transaction commits THOSE - neither the planner that was there nor the one the file held - so `Planner.write` aborts by hand. `readDocument` requires a non-empty string id and rebuilds every field as a primitive, so no key error and no clone failure can occur, and `addTask` mints its own ids |

The second row was written here as a defect found and met. `devils-advocate-agent` refuted that on 2026-09-11: a branch no reachable input produces is defence, not a defect, and a scenario that arranges the branch and a mutation that removes it form a closed loop with no browser in it. It is kept, and kept `@browser` rather than demoted to a unit test, for one reason: it is the second line if `readDocument`'s id rule ever loosens. That rule now has a unit test and a mutation of its own, which is what the argument was resting on and nothing checked.

**Sixteen mutations, and nine of them run on `bun run falsify`.** That is the difference from step 2, whose six were all `@browser` and all reported as skipped by the command in the checklist. Every rule about what a DOCUMENT is holds in a pure function and is measured by a unit test; the seven that need a browser are the ones about the page, the file and the transaction. Measured on 2026-09-11: **9 of 9 `@local` caught**, and **7 of 7 `@browser` caught** under `FALSIFY_LIVE=1`. Two of the six are the transaction pair, and they are the reason the pair is a measurement: one moves the `clear` into a transaction of its own and one takes the hand-abort out, and each turns exactly one scenario red.

**Read cold by `devils-advocate-agent` before merge, and it found two defects and four wrong sentences.** The two defects are in this branch and are fixed on it.

| What it was | What holds it now |
| --- | --- |
| `/backup` drew "Tasks held 0" and an armed Export button while the planner was still being read. The view is in the SHELL bundle and `/backup` is landable directly, so it paints before the read - the margin §41 says is widest for the frame, on the one view that reaches it. An export taken in that window writes a valid, importable planner holding nothing | Both doors are held until the read lands, and the count says so. A fifth Rule lands cold on `/backup` with the open slowed, and one mutation removes the guard |
| A document carrying one id twice was accepted. `tasks` is keyed on `id`, so the page drew both and said every task was replaced while the database held one - and the disagreement showed only on the next visit | `readDocument` refuses it and names both places. Two unit tests and one mutation |

The four sentences: "the transaction commits the clear alone" (it commits the clear and every put before the throw); "the emit refused two rows" (it refuses one import style, and the reason is the schema version); "three callers" (two); and "rebuilt field by field and never spread" (true of import, and `documentFrom` spreads). Every one is corrected above rather than removed.

**What it cost, and it is step 2's defect rather than step 3's.** `PlannerReport.state` has one value, `unstored`, for three different facts: a browser with no IndexedDB, a database that would not open, and a write that failed after a successful read. `list` draws "These tasks are kept in this page alone. A reload starts again with none." for all three, and after a failed write a reload starts again with what was last stored - so the sentence is false in exactly the case step 3 arranged. `/backup` says the true thing beside it, because it draws `planner.error` as well as `planner.state`. Closing it is a fourth state and a republished `list`, which is not what step 3 is for. TODO §43 carries it.

### What step 2 settled, and what it cost

**The planner survives the page, and `list` did not change to make it.** The shell opens `pointer-planner` at version 1, reads the tasks after the first paint, and writes them back on every change. The panel draws `store.tasks()` exactly as it did at step 1 and names no database. That is the claim §15 exists for, and step 2 is the first thing that tests it: the place the tasks are KEPT moved, and the bundle that draws them was rebuilt with no change to what it draws.

**One sentence on the page changed, and it is a reading rather than a claim.** Step 1's panel said the tasks were kept in this page alone. It now says one of two sentences, chosen by `PlannerReport.state`: "kept in this browser alone" when the database is open, and step 1's words when it is not. A browser that refuses IndexedDB - a private window, a blocked origin - degrades to step 1's behaviour rather than failing, and says so. Two scenarios drive that by taking `indexedDB` away before the page loads.

**The first paint cannot say the planner is empty, because it does not know.** Reading the database is asynchronous and the first paint is not, so `PlannerReport.state` starts at `unread` and the panel draws neither the list nor "No tasks yet" until it moves. `The empty message waits for the planner to be read` is the scenario, and it is measured by an observer installed before navigation that records the planner's state every time an empty message is added to the page - because by the time a step could look, the page is correct and the moment has gone.

**The surface grew by five declarations and the mint is additive.** `1c4a120` / `planner-stored-2026-09`: `PlannerReport`, `NO_PLANNER`, and `ShellStore.planner`, `ShellStore.setPlanner`, `ShellStore.loadTasks`. `15ed669` stays promotable, nothing published against step 1 breaks, and no channel is stranded - which is the contrast with step 1, whose mint froze `prod` and is §39. `list` uses two of the five: `ShellStore.planner` and `PlannerReport.state`. The other three are written by the shell and read by nobody else, which is what `setService` already was.

**What the step cost, and it was a defect in the feature rather than in a check.** Measured against `test-qa`: a task added and the page reloaded in the same ten milliseconds was gone, because the write transaction was still open when the browser took the page away. Three reload scenarios failed on it. The fourth passed, and which one passed is the reading - `Tags survive a reload` spends 150 ms typing before it reloads, and closed the window by accident. Nothing makes the window zero: IndexedDB has no synchronous commit and `pagehide` cannot flush a transaction. So `PlannerReport.pending` says whether a change has reached the database, and `they load the page again` waits for it to clear before reloading. **No scenario measures that window**, by construction, and TODO §40 carries what would close it.

**Six mutations, and the sixth said a scenario measured nothing.** `FALSIFY_LIVE=1 bun run falsify --only ...` over the six `@browser` mutations step 2 adds, on 2026-09-11: five caught, one not. `the empty message is drawn before the planner has been read` stayed green - because `list` is a separately published bundle, fetched and imported after the shell paints, so IndexedDB is always open before the panel first renders. The requirement was about a moment that does not occur in this composition, and the scenario would have passed for the rest of the project's life. The fix is an arrangement rather than a deletion: `the planner is slow to open` delays the first `indexedDB.open` by 1500 ms, the panel then renders while the planner is unread, and the scenario reads both halves - that the panel says it is reading, and that no empty message was drawn while it was. Re-run: **6 of 6 caught.** Step 4 preloads a unit off the landing route, which is where that margin starts to close without help.

**A reading on how this section is written, because it nearly went the other way.** "Opening it" above describes the shell that exists at step 16, not the one step 2 builds. Taken as an instruction it would have had step 2 open with no version - safer, and it would have left step 15 with no failure to produce and step 16 with nothing to fix. The last column of that table is new, and `src/web/shell/planner.ts` says the same thing at `SCHEMA_VERSION`.

### What step 1 settled, and what it cost

**A second unit, and a contract minted for it.** `list` is `15ed669` / `planner-2026-09`, and the surface it is built against dropped `greeting`, `setGreeting`, `Greeting` and `DEFAULT_GREETING` as well as adding the five members above. Both units compile against `15ed669` and neither against `9d1b0a3`, so the mint's direction reading calls the pair NOT additive and names `DEFAULT_GREETING`. Nothing is refused for it: the intersection is non-empty, and `9d1b0a3` stays retained because a rollback onto a unit published against it is what retaining is for. `scripts/contract.test.ts` holds that reading - the fourth row of §31, which needed two published contracts and now has them.

**The shell still calls the service once, and keeps nothing from it.** The greeting is gone from the store, so `hydrate` is `readData`: the one call at `API_VERSION`, made because `/versions` sits outside any version prefix and cannot say whether the version this shell CALLS answers, and because only a data response carries the `Sunset` header `/service` draws. `serviceBacked` is gone; `setGreeting` went on 2026-09-11, one branch late - step 1 said it had gone while `ServiceClient` still declared it, `createClient` still implemented it and the bundle still shipped it. The planner is in the browser, so no write is sent anywhere until step 6.

**And `readData` no longer parses the body it does not keep.** It called `client.greeting()` behind a parser that requires `greeting.text`, so a service answering `v1` correctly with any other body put `api field greeting.text is missing or not a string` on `data-api` - a reading about the SHAPE of a response, under a doc comment saying the reading is whether the version answers. `ServiceClient.data()` makes the call and reads the status and the `Sunset` header and nothing else. `parseGreeting` and `ApiGreeting` went with it: nothing in the shell drew a field of that response, so the parser was checking a boundary no value crossed.

**`list` calls `goingAway("snapshot.tasks")`, which returns null.** The service holds no snapshots until step 6 and the field is retired at step 13, so nothing is drawn for it today. The call is not decoration: `bun run e2e:members` drops the member and reads a refusal naming `list`, which is the whole of §9's first half and had no subject at step 0.

**"Nothing is fetched for a view that names no unit" gained teeth.** At step 0 there was no bundle a mutation could make the page fetch, so the unit-level half of that claim was structural. It is now a difference between `/`, which fetches `list`, and the four views that fetch nothing - and the `@browser` walk measures it.

**A surface change strands a channel that carries a unit built against the old one.** `test-prod` still held `hello 72e6a6f4`, which uses `ShellStore.greeting`, `ShellStore.setGreeting`, `Greeting.text` and `Greeting.audience` - all four gone from this surface - so `promote` refused every merge into that channel and named the unit and every member. Four `verify:live` scenarios failed in their Background on it. `bun run promote test-prod --from-build --drop hello` is the whole fix, and the refusal is §9's gate working on a composition nobody manufactured for it. TODO carries the reading.

**And `prod` is in that state too, which is the part step 1 did not say.** Measured on 2026-09-11: both regions of `prod` serve `shell c2601912` and `hello 3bba892b` at contract `9d1b0a3`, and `hello 3bba892b`'s `uses` names all four of the members this surface removed. `promote` loads every CARRIED unit's manifest and judges the whole composition, so every promote naming the new shell on `prod` is refused until `hello` is said to leave. **The runbook is below and nothing on this branch has run it:** `prod` has no hostname, so no browser can reach it, and the promote is the one act in this repository whose record cannot have pictures.

### Deploying `PLAN.md` step 1 to `prod`

Not done. The commands, in order, for whoever decides to:

```sh
git checkout main && git pull          # a clean tree at the commit being deployed
bun run build                          # no BUILD_MARKER: a marked build is refused on a real channel
bun run publish
bun run promote prod --from-build --drop hello
bun run shoot --note "..." --out deploys/<composedAt>-prod   # REFUSES: prod has no hostname
git add deploys/<composedAt>-prod && git commit
```

| | |
| --- | --- |
| Why `--drop hello` | `hello 3bba892b` uses `ShellStore.greeting`, `ShellStore.setGreeting`, `Greeting.text` and `Greeting.audience`. Without it the promote is refused and names the unit and all four |
| Why not `--app hello=<older>` | Every published `hello` was built against `9d1b0a3`. There is no id that composes with this shell |
| Why the build must be clean and unmarked | A `--from-build` to a real channel refuses a harness build, a dirty tree and another commit. Naming ids with `--shell`/`--app` takes none of those checks, which is why the runbook uses `--from-build` |
| What the record will hold | `promote.json`, `manifest.eu.json`, `manifest.us.json`, `notes.md` — **and no pictures**. `shoot` refuses `prod` because `Host` is forbidden to `setExtraHTTPHeaders` and Fly routes on SNI. TODO §2 is the domain and the certificate that would change it |
| The way back | `bun run promote prod --shell c2601912 --app hello=3bba892b`, which is the composition `prod` serves today |

**A reading on the mint, for the repository's owner.** The removal of `greeting`, `setGreeting`, `Greeting` and `DEFAULT_GREETING` was optional. Keeping the four declared and unused would have made `15ed669` additive, left `prod` and `test-prod` promotable without a `--drop`, and cost nothing but four dead declarations - which step 6 removes anyway when the service changes its subject. What the removal bought is §31's "a published pair reads as not additive" row, held by `scripts/contract.test.ts`. So a repository whose headline claim is that a deploy is one JSON write froze its only un-shootable channel behind a manual removal, to give one test row a subject that `contract:mint --name scratch-breaking` produces on demand and that README already documents. That reads as the wrong trade. It is **not** re-minted here: a contract is an identity two published units already claim, and churning it again to undo a judgement is the owner's call and not a defect fix.

**What came back, and what did not.** `bun run e2e` and `bun run e2e:members` pass rather than exiting non-zero. Six scenarios returned to `deploying-a-unit`, one to `choosing-a-version`, an Outline to `checking-what-the-page-loads`, and two to `recovering-from-an-error`; thirteen `falsify` mutations came back with them, and step 1 said nine and counted the array. **Measured on 2026-09-11 with `FALSIFY_LIVE=1 bun run falsify --only ...`: ten caught, two not caught, one refused by §35's guard for not compiling.** Eight of the thirteen are `@live` or `@browser`, so `bun run falsify` - the command in the checklist - had run none of them. The three that failed are in TODO's cold-read table with what each did instead; after they were re-aimed, 3 of 3 caught. What still has no subject is every claim needing a THIRD unit: two sub-apps sharing one runtime, a member dropped refusing one app and not another, and warming a unit off the landing route. TODO §31 carries those, and `PLAN.md` steps 4, 5 and 10 are where they come back.

### What step 0 settled, and what it cost

**Five routes, and which three are "empty".** The units table above names five: `/`, `/board`, `/week`, `/service`, `/backup`. It also says two of them name no unit — `/service` and `/backup` — which is the finished application. At step 0 none of the five names a unit, because the tree builds none, so "three empty" is read as the three that are **waiting for one**: `/` at step 1, `/board` at step 4, `/week` at step 5. The frame draws all five and says on each of the three which it is. That is the reading that makes step 1 the smallest next step: build `list`, place it on `/`, and move nothing else.

**That reading was prose and nothing checked it.** `views.test.ts` asserted five routes and zero placed apps, which was true under either reading. Step 1 settles it by acting: `list` went on `/`, and `views.test.ts` now names which route places it and which four place nothing. The alternative reading — `/backup` is also waiting, for the shell code that draws it at step 3 — is untouched by that and is still the right way to read the `/backup` note.

**No contract was minted.** Step 0 changed no declaration in `src/web/shell/api.ts` or `src/web/shell/subapp.ts`, so the surface at HEAD still hashed to `9d1b0a3`. That was checked rather than asserted — `build.ts` refuses a build whose HEAD surface the registry does not hold — and it was true only because the greeting members stayed declared while nothing called them. Step 1 removed them and minted `15ed669`.

**A composition naming no sub-app is now legitimate.** `src/server/manifest.ts` used to refuse one at schema 3, which made the whole application a 503. Schema 2 still refuses one, and the file says why the two differ. `src/server/html.test.ts` now renders a schema-3 manifest with no app — the page every visitor gets from here on, and the one shape `bun test` did not touch: it was covered only through schema 1, which returns `{}` from a different branch.

**What lost its subject.** Going to zero units cost eight checks their subject, on top of the four the previous slate cost. TODO §31 lists every one of them, where it was, and which step brings it back. `bun run e2e` and `bun run e2e:members` exited non-zero rather than passing: a green check that measured nothing is the failure mode `~/projects/CLAUDE.md` exists to name. Step 1 restored both, and most of the rest with them.

**It is not one publish and one promote, and that is the finding.** Every other step in this table is. This one changes what a MANIFEST may say, which is the surface between the pointer and the running image, and that surface has no gate and no version. The first promote wrote a pointer with `apps: {}`, the deployed image threw `manifest names no apps` on it, `ams` kept serving what it had, and `iad` answered 503 to every request for `us` until the pointer was put back. TODO §36 carries it, with the readings.

**`iad` did not fail because it was suspended. It failed because it had nothing cached.** `prime` puts `checkedAt` back when a read yields nothing, so a cold entry's first `get` awaits, gets null, and the origin answers 503. `ams` survived by holding a value, not by being in `eu` — and any restart of it would have taken `eu` down the same way. `qa` was one machine restart from 503 in both regions. `src/server/manifest.test.ts` holds that state now; the suite had both halves of it and never the product.

**And the way back was not a command.** `--app hello=<id>` exited 1, because `--app` checked its name against what this tree builds. The recovery was an edit to `scripts/contract.ts` and a promote from a dirty tree, which `deploys/2026-09-10T21-15-37Z-qa/promote.json` records. That is fixed: a promote composes from the channel's own apps as well as this tree's units, so a unit the tree stopped building is carried and can be named, and `--drop <app>` is the only way one leaves. Verified live on 2026-09-10 — `--app hello=3bba892b` from a tree that builds no sub-app, twice, with a record for each.

**So step 0 finished with a `fly deploy` and then a promote.** `deploys/2026-09-11T08-34-02Z-qa` is the record: `bun run promote qa --from-build --drop hello`, the first promote in the archive that moved anything, and the first that removed a unit. `qa` has served the frame with five views and no sub-app since. TODO §36 stays open regardless: what took a region down was that nothing gates what a pointer may SAY against what the image parses, and that gap is unchanged by any of this.

Steps 1 and 2 are deliberately separate. A planner that forgets everything on reload is not a product, and shipping it first makes persistence a visible increment rather than an assumption nobody watched arrive.

Steps 8 and 12 are the pair to put on one slide: one rolls data back, one rolls code back, and they are the same operation.

Steps 15 and 16 are the pair the persistence question was deferred for on 2026-08-28. 15 must be **seen to break** before 16 is written.

---

## What this costs the suite

`~/projects/CLAUDE.md` requires every scenario to start from the cold state a fresh visitor sees. Persistence puts a clear step in front of every browser scenario, and any scenario that misses it becomes order-dependent.

**This section specified a step, and building it on 2026-09-13 refuted it.** What it asked for was `indexedDB.deleteDatabase("pointer-planner")` in the browser world's setup, once, with one `falsify` mutation removing it and a named scenario that must go red. Both halves failed, for different reasons, and both were measured rather than argued.

| What was specified | What the measurement said |
| --- | --- |
| `deleteDatabase` before the page is opened | **It hangs the case it is for.** A delete issued while another page in the same context holds the database open is BLOCKED: it deletes nothing AND queues every later `open` on that name behind it, so the next page's shell never gets a connection and the panel sits on "Reading the planner…" |
| One `falsify` mutation removes it, and a named scenario goes red | **No scenario can go red.** Playwright gives each test its own context and IndexedDB is per profile, so the state a clear would fix is unreachable and a mutation removing the clear stays green |

What is built instead is the READING, and it needs no delete. `indexedDB.databases()` names what exists and at what version; it opens nothing, holds no connection and blocks nothing. Every page the world drives carries it, and the `After` hook fails the scenario by name when any context it used already held a planner — after the restores, because a hook that threw first would leave a pointer where a scenario moved it, which is §42's own failure produced by §44's check.

| | |
| --- | --- |
| The reading | `indexedDB.databases()` at document start, once per browsing context, into `sessionStorage` |
| Where it goes | `PointerWorld.usePage`, so every page the world drives has it - the fixture's and any second browser a scenario opens |
| What it says | The scenario's name, the version that already existed, and where to look: `playwright.config.ts` first |
| The check, pure | `coldPlannerProblem` and the script's shape are in `features/support/cold-planner.ts`, with 29 tests and three `falsify` mutations. Three of those tests GREP the script's text rather than running it, because it runs in a page and that file starts no browser; `verify:cold` is what runs it |
| The check, arranged | `bun run verify:cold`. Two pages in one browser context, 11 readings on 2026-09-13. That is ONE way to reach the state - `launchPersistentContext` and a `storageState` reach it too - and it is the cheapest |
| The refutation, arranged | The same script. It issues the `deleteDatabase` this section specified while the first page holds the database open, and reads back `blocked` and a database still there. A claim that overturns a specification is the last one that should rest on prose |

**The refutation is about the CONCURRENT shape, and `verify:cold` measures the other one too.** A page that has closed holds nothing open, so a delete there completes and does exactly what this section specified. What was rejected is the step as an unconditional part of the setup, because the shape it cannot survive is the shape a shared context actually produces first.

**A third option was not considered until a cold read on 2026-09-13 asked: delete, and report when the delete is blocked.** That would clear the sequential shape and report the concurrent one, which is strictly more than the reading alone. It is not built, and the reason is a trade rather than a measurement: a harness hook that deletes a visitor's planner is a write, and the reading already names the fault in both shapes without one. If a reused context ever becomes something the suite wants rather than something it reports, that is the design to build.

**Nothing is cleared, and that is deliberate.** A reused context gives a visitor a warm planner; the suite reports it rather than hiding it behind a clear that works in one shape of two. A clear step nothing verifies is a clear step that will be silently dropped - which is what this section said, and the answer turned out to be an arrangement rather than a mutation.

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
