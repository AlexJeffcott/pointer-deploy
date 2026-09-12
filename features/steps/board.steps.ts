// The planner's board, driven the way a visitor drives it.
//
// Every step goes through the panel's own controls and reads the panel's own
// output, for the same reason `list.steps.ts` does: the claim `PLAN.md` step 4
// makes is that a THIRD separately published bundle writes into the frame's
// store and draws what came back, and a step that called the store directly
// would prove the store rather than the composition.

import { Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";

const PANEL = '[data-app="board"]';

/** The column labels the board currently draws, in the order it draws them. */
const labelsOn = (world: PointerWorld): Promise<string[]> =>
  world.browserPage.$$eval(`${PANEL} [data-column] h3`, (nodes) =>
    nodes.map((n) => n.firstChild?.textContent?.trim() ?? ""),
  );

/** The titles in one column, in the order that column draws them. */
const cardsIn = (world: PointerWorld, column: string): Promise<string[]> =>
  world.browserPage.$$eval(
    `${PANEL} [data-column="${column}"] [data-card]`,
    (nodes) => nodes.map((n) => n.getAttribute("data-card") ?? ""),
  );

When(
  "they move {string} to {string}",
  async function (this: PointerWorld, title: string, column: string) {
    const page = this.browserPage;
    await page.click(`${PANEL} [data-card="${title}"] [data-move="${title}"][data-to="${column}"]`);
    // Drawn in the new column before the next step runs. A scenario that moves
    // a task twice would otherwise race its second click against the redraw and
    // click a button the panel has already replaced.
    await page.waitForSelector(`${PANEL} [data-column="${column}"] [data-card="${title}"]`, {
      timeout: 10_000,
    });
  },
);

/**
 * The reload, taken on the board rather than on the list.
 *
 * The same rule `list.steps.ts` carries and the same reason: a write is
 * asynchronous, so what survives a reload is what was STORED, and a reload that
 * beats the commit window is TODO §40 rather than this scenario's subject. The
 * wait after it is on the board having drawn its COLUMNS, because the panel
 * draws "Reading the planner…" until the read lands.
 */
When("they load the board again", async function (this: PointerWorld) {
  const page = this.browserPage;
  await page.waitForFunction(
    () => document.documentElement.dataset.plannerPending !== "yes",
    undefined,
    { timeout: 10_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(`${PANEL} [data-board-note]`, { timeout: 20_000 });
});

/**
 * One task written straight into the planner, in a column nothing draws.
 *
 * There is no control that produces this and that is the point: `moveTask`
 * refuses such a column and `readDocument` refuses a document carrying one, so
 * the only door left is the database - which a later shell's columns, or a
 * rollback onto data a newer shell wrote, reaches without anybody typing
 * anything. `PLAN.md` steps 15 and 16 are where it stops being arranged.
 *
 * Written after the page has opened rather than before it, so the object stores
 * are the ones the shell created. Opened with NO version, so this never
 * upgrades anything and never blocks the shell's own handle.
 */
When(
  "the planner is given a task in the column {string}",
  async function (this: PointerWorld, column: string) {
    await this.browserPage.evaluate(
      ([name, col]) =>
        new Promise<void>((resolve, reject) => {
          const open = indexedDB.open(name!);
          open.onerror = () => reject(new Error(`could not open ${name}`));
          open.onsuccess = () => {
            const handle = open.result;
            const tx = handle.transaction("tasks", "readwrite");
            tx.objectStore("tasks").put({
              id: "seeded-1",
              title: "Learn to sail",
              column: col,
              due: null,
              tags: [],
              createdAt: "2026-09-12T09:00:00.000Z",
            });
            tx.oncomplete = () => {
              handle.close();
              resolve();
            };
            tx.onabort = () => reject(new Error("the seed transaction aborted"));
          };
        }),
      ["pointer-planner", column] as const,
    );
  },
);

Then(
  "the board reports {int} task it does not draw",
  async function (this: PointerWorld, count: number) {
    const page = this.browserPage;
    await page.waitForSelector(`${PANEL} [data-unplaced="${count}"]`, { timeout: 10_000 });
    // The title and the column, both said. A count alone tells a visitor there
    // is a task somewhere and gives them nothing to look for.
    const said = await page.$eval(`${PANEL} [data-unplaced]`, (n) => n.textContent ?? "");
    expect(said).toContain("Learn to sail");
    expect(said).toContain("someday");
  },
);

Then("the board says it is reading the planner", async function (this: PointerWorld) {
  await this.browserPage.waitForSelector(`${PANEL} [data-planner-unread]`, { timeout: 10_000 });
});

/**
 * What the planner's state was every time this page said something was empty.
 *
 * Recorded by the harness as it happens, because the moment has passed by the
 * time a step could look: the board fills in, and the finished page is correct.
 * The board's per-column empty message carries `data-empty` for exactly this.
 */
Then(
  "the board said no column was empty before the planner was read",
  async function (this: PointerWorld) {
    await this.browserPage.waitForSelector(`${PANEL} [data-column-empty]`, { timeout: 20_000 });
    const when = await this.emptyMessageStates();
    expect(when.filter((s) => s !== "stored" && s !== "unstored")).toEqual([]);
  },
);

Then("the board draws the columns {string}", async function (this: PointerWorld, expected: string) {
  const wanted = expected.split(",").map((c) => c.trim());
  await this.browserPage.waitForFunction(
    (n) => document.querySelectorAll('[data-app="board"] [data-column]').length === n,
    wanted.length,
    { timeout: 10_000 },
  );
  expect(await labelsOn(this)).toEqual(wanted);
});

Then("every column on the board is empty", async function (this: PointerWorld) {
  const page = this.browserPage;
  const columns = await page.$$eval(`${PANEL} [data-column]`, (nodes) =>
    nodes.map((n) => n.getAttribute("data-column") ?? ""),
  );
  expect(columns.length).toBeGreaterThan(0);
  for (const column of columns) {
    await page.waitForSelector(`${PANEL} [data-column-empty="${column}"]`, { timeout: 10_000 });
    expect(await cardsIn(this, column)).toEqual([]);
  }
});

Then(
  "{string} is in the {string} column",
  async function (this: PointerWorld, title: string, column: string) {
    const page = this.browserPage;
    await page.waitForSelector(`${PANEL} [data-column="${column}"] [data-card="${title}"]`, {
      timeout: 10_000,
    });
    // The card is in that column and in NO other. A move that copied rather
    // than moved would satisfy the wait above and fail here.
    const drawnIn = await page.$$eval(
      `${PANEL} [data-card="${title}"]`,
      (nodes) => nodes.map((n) => n.getAttribute("data-in") ?? ""),
    );
    expect(drawnIn).toEqual([column]);
  },
);

Then("the {string} column is empty", async function (this: PointerWorld, column: string) {
  await this.browserPage.waitForSelector(`${PANEL} [data-column-empty="${column}"]`, {
    timeout: 10_000,
  });
  expect(await cardsIn(this, column)).toEqual([]);
});

/**
 * The counts the board draws beside its column names.
 *
 * NOT an independent cross-check, and a comment claiming it was stood here
 * until a cold read on 2026-09-12. The panel computes `held` once and renders
 * `held.length` and `held.map(...)` from it, so the two cannot disagree - one
 * value drawn twice. What this step is worth is the three columns in one
 * assertion with the numbers named, which is how a scenario says where every
 * task on the board is rather than where one of them is.
 */
Then(
  "the board counts {int} tasks in {string}, {int} in {string} and {int} in {string}",
  async function (
    this: PointerWorld,
    firstCount: number,
    first: string,
    secondCount: number,
    second: string,
    thirdCount: number,
    third: string,
  ) {
    const page = this.browserPage;
    for (const [column, wanted] of [
      [first, firstCount],
      [second, secondCount],
      [third, thirdCount],
    ] as const) {
      const drawn = await page.$eval(
        `${PANEL} [data-column-count="${column}"]`,
        (n) => n.textContent?.trim() ?? "",
      );
      expect(`${column} says ${drawn}`).toBe(`${column} says ${wanted}`);
      // The cards as well as the count. One value drawn twice in the panel, so
      // this cannot catch a disagreement between them - it catches a count
      // drawn from somewhere else entirely, which is what a later edit could
      // make it.
      expect(`${column} draws ${(await cardsIn(this, column)).length}`).toBe(
        `${column} draws ${wanted}`,
      );
    }
  },
);
