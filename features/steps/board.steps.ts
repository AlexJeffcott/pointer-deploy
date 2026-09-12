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
 * A second reading of the same fact, and it is not decoration: the cards are
 * what the panel drew and the count is what the panel SAYS it drew, so a filter
 * that dropped a task would put the two out of step. Both are read here.
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
      expect(`${column} draws ${(await cardsIn(this, column)).length}`).toBe(
        `${column} draws ${wanted}`,
      );
    }
  },
);
