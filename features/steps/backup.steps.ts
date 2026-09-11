// The planner as one file, `PLAN.md` step 3.
//
// `/backup` is drawn by the FRAME and no unit is placed on it, so every step
// here drives the shell's own controls: a button that writes a file and a file
// input that reads one back. Nothing reaches into the store. What step 3 has to
// show is that a person can take the planner out of this browser and put it
// back, and a step that called `loadTasks` itself would prove the store rather
// than the page.
//
// One step reads IndexedDB instead of the page, for the reason `planner.steps.ts`
// gives: "the import did not reach the database" is a claim about the database,
// and a page still holding the imported tasks in a signal would agree with a
// step that only looked at it.

import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";
import { DOCUMENT_FORMAT } from "../../src/web/shell/document.ts";
import { SCHEMA_VERSION } from "../../src/web/shell/planner.ts";

const BACKUP = "[data-backup]";
const DB = "pointer-planner";

/**
 * A document a shell of this version would accept, holding the titles given.
 *
 * Built here rather than read from `features/support/fixtures/`, because every
 * refusing scenario needs a document that differs from this one in exactly one
 * field, and a directory of near-identical files is a directory nobody reads.
 * `createdAt` ascends, so the order the list draws them in is the order the
 * file names them.
 */
const plannerFile = (titles: readonly string[]): string =>
  `${JSON.stringify(
    {
      format: DOCUMENT_FORMAT,
      schemaVersion: SCHEMA_VERSION,
      exportedAt: "2026-01-01T00:00:00.000Z",
      tasks: titles.map((title, i) => ({
        id: `imported-${i}`,
        title,
        column: "todo",
        due: null,
        tags: [],
        createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
      })),
    },
    null,
    2,
  )}\n`;

const titleList = (text: string): string[] =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");

/** Hands the file input bytes, exactly as a person choosing a file would. */
const chooseFile = (world: PointerWorld, name: string, text: string): Promise<void> =>
  world.browserPage.setInputFiles(`${BACKUP} [data-import]`, {
    name,
    mimeType: "application/json",
    buffer: Buffer.from(text, "utf8"),
  });

/**
 * The file the export wrote, taken off the download rather than off the page.
 *
 * `page.click` and the download event are awaited together: Chrome starts the
 * download inside the click, so a step that clicked first and waited afterwards
 * would race the event it is waiting for.
 */
When("they export the planner", async function (this: PointerWorld) {
  const page = this.browserPage;
  const [download] = await Promise.all([
    page.waitForEvent("download", { timeout: 20_000 }),
    page.click(`${BACKUP} [data-export]`),
  ]);
  const path = await download.path();
  if (!path) throw new Error("the browser did not keep the exported file");
  this.exportedFile = { name: download.suggestedFilename(), text: await Bun.file(path).text() };
});

const exported = (world: PointerWorld): { name: string; text: string } => {
  if (!world.exportedFile) throw new Error("nothing has been exported in this scenario");
  return world.exportedFile;
};

Then("the exported file holds {string}", function (this: PointerWorld, expected: string) {
  const doc = JSON.parse(exported(this).text) as { tasks: Array<{ title: string }> };
  expect(doc.tasks.map((t) => t.title)).toEqual(titleList(expected));
});

Then("the exported file holds no tasks", function (this: PointerWorld) {
  const doc = JSON.parse(exported(this).text) as { tasks: unknown[] };
  expect(doc.tasks).toEqual([]);
});

/**
 * The two fields the import rule reads first, read off what the export wrote.
 *
 * A file with no name and no version on it is a file nothing can refuse, so
 * this is the other half of every refusing scenario below rather than a
 * restatement of them.
 */
Then(
  "the exported file is a {string} document at schema version {int}",
  function (this: PointerWorld, format: string, version: number) {
    const doc = JSON.parse(exported(this).text) as { format: string; schemaVersion: number };
    expect(doc.format).toBe(format);
    expect(doc.schemaVersion).toBe(version);
  },
);

Then("the exported file is named for the planner", function (this: PointerWorld) {
  expect(exported(this).name).toMatch(/^pointer-planner-\d{4}-\d{2}-\d{2}\.json$/);
});

When(
  "they import a planner holding {string}",
  async function (this: PointerWorld, titles: string) {
    await chooseFile(this, "planner.json", plannerFile(titleList(titles)));
  },
);

When("they import a planner holding nothing", async function (this: PointerWorld) {
  await chooseFile(this, "planner.json", plannerFile([]));
});

/** Whatever bytes the scenario names, which is how a refusal gets its subject. */
When("they import a file holding {string}", async function (this: PointerWorld, text: string) {
  await chooseFile(this, "planner.json", text);
});

When("they import the file they exported", async function (this: PointerWorld) {
  const file = exported(this);
  await chooseFile(this, file.name, file.text);
});

Then("the backup view reads {int} tasks out of the file", async function (this: PointerWorld, n: number) {
  await this.browserPage.waitForSelector(`${BACKUP} [data-import-read="${n}"]`, { timeout: 10_000 });
});

const refusal = async (world: PointerWorld): Promise<string> => {
  await world.browserPage.waitForSelector(`${BACKUP} [data-import-refused]`, { timeout: 10_000 });
  return world.browserPage.$eval(
    `${BACKUP} [data-import-refused]`,
    (n) => n.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
};

Then("the backup view refuses the file", async function (this: PointerWorld) {
  expect(await refusal(this)).toContain("refused");
});

/**
 * Every word the refusal has to carry, given as one comma-separated list.
 *
 * Substrings and not the whole sentence. What a person needs from a refusal is
 * the field to look at and the values that disagree; a step asserting the
 * wording would go red on a rewrite and stay green on a refusal that named the
 * wrong field, which is the only failure worth catching here.
 */
Then("the refusal names {string}", async function (this: PointerWorld, wanted: string) {
  const said = await refusal(this);
  for (const word of titleList(wanted)) expect(said).toContain(word);
});

Then("the backup view says the planner is {word}", async function (this: PointerWorld, state: string) {
  await this.browserPage.waitForFunction(
    (want) => document.querySelector("[data-planner-state]")?.textContent?.trim() === want,
    state,
    { timeout: 10_000 },
  );
});

Then("the backup view says {int} tasks are held", async function (this: PointerWorld, n: number) {
  await this.browserPage.waitForFunction(
    (want) => document.querySelector("[data-planner-tasks]")?.textContent?.trim() === String(want),
    n,
    { timeout: 10_000 },
  );
});

/**
 * A database that gives up part-way through a write, which is the only way the
 * one-transaction claim can be seen at all.
 *
 * The third task PUT into `tasks` aborts the transaction it is in. A quota that
 * runs out and a disk that fails both arrive this way, and the point of one
 * transaction is that the `clear` queued before those puts goes back with them.
 *
 * The abort is queued as a microtask rather than taken on the spot: the whole
 * of `Planner.write` is synchronous up to its await, so an abort taken inside
 * `put` would make the calls after it throw `TransactionInactiveError` and the
 * page would report that instead of the abort. A microtask runs after the last
 * request is queued and before the transaction can commit.
 *
 * Counted per transaction, on the transaction object itself, so that the one
 * write a scenario makes BEFORE the import is not the one that aborts.
 */
Given("the database gives up part-way through a write", async function (this: PointerWorld) {
  await this.browserPage.addInitScript(() => {
    const proto = IDBObjectStore.prototype;
    const real = proto.put;
    proto.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      const request = real.call(this, value as never, key as never);
      if (this.name === "tasks") {
        const tx = this.transaction as IDBTransaction & { __puts?: number };
        tx.__puts = (tx.__puts ?? 0) + 1;
        if (tx.__puts === 3) queueMicrotask(() => tx.abort());
      }
      return request;
    } as typeof proto.put;
  });
});

/**
 * A database that refuses one record as it is queued.
 *
 * The other half of the rule above, and a different failure: the browser
 * throws out of `put` rather than giving the transaction up. `Planner.write`
 * has already queued the clear by then, so a write that simply stopped would
 * leave the transaction holding a clear and nothing else - and the browser
 * would commit it. The abort in that catch is what this measures.
 *
 * `DataError` is what a record the browser cannot key throws. Nothing a FILE
 * can carry produces one, because `readDocument` requires a non-empty string
 * id, so the moment is arranged here rather than waited for.
 */
Given("the database refuses a record as it is written", async function (this: PointerWorld) {
  await this.browserPage.addInitScript(() => {
    const proto = IDBObjectStore.prototype;
    const real = proto.put;
    proto.put = function (this: IDBObjectStore, value: unknown, key?: IDBValidKey) {
      if (this.name === "tasks") {
        const tx = this.transaction as IDBTransaction & { __written?: number };
        tx.__written = (tx.__written ?? 0) + 1;
        if (tx.__written === 3) {
          throw new DOMException("the browser refused this record", "DataError");
        }
      }
      return real.call(this, value as never, key as never);
    } as typeof proto.put;
  });
});

/**
 * What the database holds, and nothing else in it.
 *
 * "Holds the task" is the wrong reading for a rolled-back write: a transaction
 * that half-committed would hold the old task AND some of the new ones, and a
 * step that only looked for one of them would pass.
 */
Then("the database holds only {string}", async function (this: PointerWorld, expected: string) {
  const wanted = titleList(expected);
  const deadline = Date.now() + 10_000;
  let seen: string[] = [];
  while (Date.now() < deadline) {
    seen = await this.storedTaskTitles(DB);
    if (seen.length === wanted.length) break;
    await Bun.sleep(100);
  }
  expect(seen).toEqual(wanted);
});
