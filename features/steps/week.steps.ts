// The planner's week, driven the way a visitor drives it.
//
// Every step goes through the panel's own control and reads the panel's own
// output, for the same reason `list.steps.ts` and `board.steps.ts` do: the
// claim `PLAN.md` step 5 makes is that a FOURTH separately published bundle
// writes into the frame's store and draws what came back, and a step that
// called the store directly would prove the store rather than the composition.
//
// A day is named by its POSITION and never by a date. The panel computes its
// seven days from the clock, so a step carrying `2026-12-25` would read
// correctly until December and then quietly measure something else.

import { Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";

const PANEL = '[data-app="week"]';

/** The seven day values the panel currently draws, in the order it draws them. */
const daysOn = (world: PointerWorld): Promise<string[]> =>
  world.browserPage.$$eval(`${PANEL} [data-day]`, (nodes) =>
    nodes.map((n) => n.getAttribute("data-day") ?? ""),
  );

/**
 * The date the panel has drawn at position `n`, counting from 1.
 *
 * Read off the page rather than computed here. A harness that worked out which
 * Monday it was would be a second reading of the week, and a scenario would
 * then pass whenever the two agreed and fail for a reason nobody could see.
 */
async function dayValue(world: PointerWorld, n: number): Promise<string> {
  const days = await daysOn(world);
  const day = days[n - 1];
  if (day === undefined || day === "") {
    throw new Error(`the week drew ${days.length} days, so there is no day ${n}`);
  }
  return day;
}

/** Every title the panel draws, wherever on the page it draws it. */
const cardsOn = (world: PointerWorld): Promise<string[]> =>
  world.browserPage.$$eval(`${PANEL} [data-card]`, (nodes) =>
    nodes.map((n) => n.getAttribute("data-card") ?? ""),
  );

/**
 * One task written straight into the planner, carrying whatever `due` it is
 * given.
 *
 * There is no control that produces a date the week cannot place: `setDue`
 * refuses anything that is not a date, and `readDocument` refuses a document
 * carrying one. The database is the door left over, and a later shell or a
 * rollback onto data a newer shell wrote reaches it without anybody typing
 * anything - `PLAN.md` steps 15 and 16.
 *
 * Written after the page has opened rather than before it, so the object stores
 * are the ones the shell created. Opened with NO version, so this never
 * upgrades anything and never blocks the shell's own handle.
 */
async function seedTask(world: PointerWorld, due: string): Promise<void> {
  await world.browserPage.evaluate(
    ([name, value]) =>
      new Promise<void>((resolve, reject) => {
        const open = indexedDB.open(name!);
        open.onerror = () => reject(new Error(`could not open ${name}`));
        open.onsuccess = () => {
          const handle = open.result;
          const tx = handle.transaction("tasks", "readwrite");
          tx.objectStore("tasks").put({
            id: "seeded-1",
            title: "Learn to sail",
            column: "todo",
            due: value,
            tags: [],
            createdAt: "2026-09-13T09:00:00.000Z",
          });
          tx.oncomplete = () => {
            handle.close();
            resolve();
          };
          tx.onabort = () => reject(new Error("the seed transaction aborted"));
        };
      }),
    ["pointer-planner", due] as const,
  );
}

When(
  "the planner is given a task dated {int} days from now",
  async function (this: PointerWorld, days: number) {
    // The visitor's own calendar, the way the panel reads it. `toISOString`
    // would put a browser east of Greenwich on the wrong day for part of every
    // evening, which is the same reason `weekOf` uses the local getters.
    const due = await this.browserPage.evaluate((ahead) => {
      const at = new Date();
      at.setDate(at.getDate() + ahead);
      const pad = (n: number) => String(n).padStart(2, "0");
      return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
    }, days);
    await seedTask(this, due);
  },
);

When(
  "the planner is given a task dated {string}",
  async function (this: PointerWorld, due: string) {
    await seedTask(this, due);
  },
);

/**
 * The one control this unit has, and the only caller of `setDue`.
 *
 * A select rather than a button per day: seven buttons on every card is a panel
 * nobody can read. `selectOption` fires the change the panel listens for.
 *
 * Every option a visitor can choose is one of the seven days or the empty
 * value, which `the control on ... offers the date it carries` asserts. That is
 * a property of this panel and NOT the reason `setDue` refuses silently - a
 * cold read on 2026-09-13 took that argument out of `api.ts`, because a shell
 * is composed with a sub-app it was not built beside.
 */
When(
  "they put {string} on day {int} of the week",
  async function (this: PointerWorld, title: string, n: number) {
    const page = this.browserPage;
    const day = await dayValue(this, n);
    await page.selectOption(`${PANEL} [data-due="${title}"]`, day);
    // Drawn on the new day before the next step runs. A scenario that dates a
    // task twice would otherwise race its second choice against the redraw and
    // drive a select the panel has already replaced.
    await page.waitForSelector(`${PANEL} [data-day="${day}"] [data-card="${title}"]`, {
      timeout: 10_000,
    });
  },
);

When("they take the date off {string}", async function (this: PointerWorld, title: string) {
  const page = this.browserPage;
  await page.selectOption(`${PANEL} [data-due="${title}"]`, "");
  await page.waitForSelector(`${PANEL} [data-group="undated"] [data-card="${title}"]`, {
    timeout: 10_000,
  });
});

/**
 * The reload, taken on the week rather than on the list.
 *
 * The same rule the other two panels carry and the same reason: a write is
 * asynchronous, so what survives a reload is what was STORED, and a reload that
 * beats the commit window is TODO §40 rather than this scenario's subject. The
 * wait after it is on the panel's note, because it draws "Reading the planner…"
 * until the read lands.
 */
When("they load the week again", async function (this: PointerWorld) {
  const page = this.browserPage;
  await page.waitForFunction(
    () => document.documentElement.dataset.plannerPending !== "yes",
    undefined,
    { timeout: 10_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(`${PANEL} [data-week-note]`, { timeout: 20_000 });
});

Then("the week draws {int} days", async function (this: PointerWorld, wanted: number) {
  await this.browserPage.waitForFunction(
    (n) => document.querySelectorAll('[data-app="week"] [data-day]').length === n,
    wanted,
    { timeout: 10_000 },
  );
  const days = await daysOn(this);
  expect(days).toHaveLength(wanted);
  // Consecutive, every one of them a date, and the first a MONDAY. Seven panels
  // drawn from one value repeated would satisfy the count above, and seven days
  // starting today would satisfy the count and the spacing - which is the whole
  // difference between a week and a rolling window, and the reason a task does
  // not change panel overnight.
  const asDays = days.map((d) => Date.parse(`${d}T00:00:00Z`));
  for (const [index, at] of asDays.entries()) {
    expect(Number.isFinite(at)).toBe(true);
    if (index > 0) expect(at - asDays[index - 1]!).toBe(86_400_000);
  }
  expect(`day 1 is weekday ${new Date(asDays[0]!).getUTCDay()}`).toBe("day 1 is weekday 1");
  // And today is one of the seven. A week that had drifted a week either way
  // would still be seven consecutive days beginning on a Monday.
  const today = await this.browserPage.evaluate(() => {
    const at = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())}`;
  });
  expect(days).toContain(today);
});

Then("every day of the week is empty", async function (this: PointerWorld) {
  const page = this.browserPage;
  const days = await daysOn(this);
  expect(days.length).toBeGreaterThan(0);
  for (const day of days) {
    await page.waitForSelector(`${PANEL} [data-day-empty="${day}"]`, { timeout: 10_000 });
  }
});

Then("day {int} of the week is empty", async function (this: PointerWorld, n: number) {
  const day = await dayValue(this, n);
  await this.browserPage.waitForSelector(`${PANEL} [data-day-empty="${day}"]`, { timeout: 10_000 });
});

Then(
  "{string} is on day {int} of the week",
  async function (this: PointerWorld, title: string, n: number) {
    const page = this.browserPage;
    const day = await dayValue(this, n);
    await page.waitForSelector(`${PANEL} [data-day="${day}"] [data-card="${title}"]`, {
      timeout: 10_000,
    });
    // On that day and on NO other part of the page. A write that copied rather
    // than moved would satisfy the wait above and fail here.
    const drawnOn = await page.$$eval(
      `${PANEL} [data-card="${title}"]`,
      (nodes) => nodes.map((node) => node.getAttribute("data-on") ?? ""),
    );
    expect(drawnOn).toEqual([day]);
  },
);

Then("{string} has no date", async function (this: PointerWorld, title: string) {
  const page = this.browserPage;
  await page.waitForSelector(`${PANEL} [data-group="undated"] [data-card="${title}"]`, {
    timeout: 10_000,
  });
  const drawnOn = await page.$$eval(
    `${PANEL} [data-card="${title}"]`,
    (nodes) => nodes.map((node) => node.getAttribute("data-on") ?? ""),
  );
  expect(drawnOn).toEqual([""]);
});

Then(
  "the week holds {int} task(s) with no date",
  async function (this: PointerWorld, wanted: number) {
    const page = this.browserPage;
    await page.waitForSelector(`${PANEL} [data-undated-count]`, { timeout: 10_000 });
    const drawn = await page.$eval(
      `${PANEL} [data-undated-count]`,
      (n) => n.textContent?.trim() ?? "",
    );
    expect(`No date says ${drawn}`).toBe(`No date says ${wanted}`);
    const cards = await page.$$eval(
      `${PANEL} [data-group="undated"] [data-card]`,
      (nodes) => nodes.length,
    );
    expect(`No date draws ${cards}`).toBe(`No date draws ${wanted}`);
  },
);

Then(
  "the week reports {int} task(s) dated another day",
  async function (this: PointerWorld, wanted: number) {
    const page = this.browserPage;
    await page.waitForSelector(`${PANEL} [data-elsewhere-count]`, { timeout: 10_000 });
    const drawn = await page.$eval(
      `${PANEL} [data-elsewhere-count]`,
      (n) => n.textContent?.trim() ?? "",
    );
    expect(`Another date says ${drawn}`).toBe(`Another date says ${wanted}`);
    const cards = await page.$$eval(
      `${PANEL} [data-group="elsewhere"] [data-card]`,
      (nodes) => nodes.length,
    );
    expect(`Another date draws ${cards}`).toBe(`Another date draws ${wanted}`);
  },
);

/**
 * The value the task actually carries, printed as it is.
 *
 * A count alone tells a visitor there is a task somewhere and gives them
 * nothing to look for. This is the half that makes a value which is not a date
 * legible as itself, which is the only thing this panel can honestly say about
 * one.
 */
/**
 * The select on a card whose date this week does not draw.
 *
 * Its options are the seven days and No date, so a value outside them matches
 * none - and a select whose value matches no option draws the FIRST one, which
 * would tell a visitor the task had no date while the heading above it says it
 * has one. The panel puts the task's own date at the top for that reason, and
 * this is the reading that says so.
 */
Then(
  "the control on {string} offers the date it carries, and will not let it be chosen",
  async function (this: PointerWorld, title: string) {
    const page = this.browserPage;
    const chosen = await page.$eval(
      `${PANEL} [data-due="${title}"]`,
      (n) => (n as HTMLSelectElement).value,
    );
    const carried = await page.$eval(
      `${PANEL} [data-elsewhere-due="${title}"]`,
      (n) => n.textContent?.trim() ?? "",
    );
    expect(carried).not.toBe("");
    expect(`the control reads ${chosen}`).toBe(`the control reads ${carried}`);

    // And every option a visitor can CHOOSE is one of the seven days or the
    // empty value. Without this the option set holds a value that need not be
    // a date at all, and the sentence that lets `setDue` refuse silently - an
    // argument about the option set - is false. Found by a cold read on
    // 2026-09-13, which is also why the option is `disabled` rather than
    // merely never re-picked.
    const days = await daysOn(this);
    const choosable = await page.$$eval(
      `${PANEL} [data-due="${title}"] option:not([disabled])`,
      (nodes) => nodes.map((node) => (node as HTMLOptionElement).value),
    );
    expect(choosable).toEqual(["", ...days]);
  },
);

Then("the week prints {string} beside that task", async function (this: PointerWorld, due: string) {
  const printed = await this.browserPage.$$eval(
    `${PANEL} [data-elsewhere-due]`,
    (nodes) => nodes.map((node) => node.textContent?.trim() ?? ""),
  );
  expect(printed).toContain(due);
});

/**
 * The accounting claim, read against the DATABASE.
 *
 * The panel draws a count per day and two more for the groups, and every one of
 * those comes out of the same filters the cards do - so comparing them with
 * each other measures nothing. This read `tasks.length` off the panel's own
 * root until a cold read on 2026-09-13 named it as the correction
 * `board.steps.ts` already took: one value drawn twice is not a cross-check.
 *
 * What it compares now is the titles on the page against the titles in the
 * planner's object store, which the shell wrote and this panel never saw. A
 * task in no group and a task in two both fail it, and so does a page drawing
 * a task the planner does not hold.
 *
 * Titles are compared as a SORTED LIST and not as a set. `addTask` permits two
 * tasks with one title, so a set would turn a legitimate planner red - and
 * `data-card` is keyed on the title, so two of them are two nodes carrying one
 * name and the counts still have to agree.
 */
Then(
  "every task the planner holds is drawn once on the week",
  async function (this: PointerWorld) {
    const page = this.browserPage;
    // What is STORED, so a write still in flight is not read as a missing
    // task. The same wait every reload step takes, for the same reason.
    await page.waitForFunction(
      () => document.documentElement.dataset.plannerPending !== "yes",
      undefined,
      { timeout: 10_000 },
    );
    const held = await this.storedTaskTitles("pointer-planner");
    expect(held.length).toBeGreaterThan(0);
    const drawn = await cardsOn(this);
    expect(`${drawn.length} cards for ${held.length} tasks`).toBe(
      `${held.length} cards for ${held.length} tasks`,
    );
    expect([...drawn].sort()).toEqual([...held].sort());
  },
);

Then("the week says it is reading the planner", async function (this: PointerWorld) {
  await this.browserPage.waitForSelector(`${PANEL} [data-planner-unread]`, { timeout: 10_000 });
});

/**
 * What the planner's state was every time this page said something was empty.
 *
 * Recorded by the harness as it happens, because the moment has passed by the
 * time a step could look: the week fills in, and the finished page is correct.
 * Every empty message this panel draws carries `data-empty` for exactly this.
 */
Then(
  "the week said no day was empty before the planner was read",
  async function (this: PointerWorld) {
    await this.browserPage.waitForSelector(`${PANEL} [data-day-empty]`, { timeout: 20_000 });
    const when = await this.emptyMessageStates();
    expect(when.filter((s) => s !== "stored" && s !== "unstored")).toEqual([]);
  },
);
