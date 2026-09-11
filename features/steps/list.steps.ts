// The planner's list, driven the way a visitor drives it.
//
// Every step here goes through the panel's own controls and reads the panel's
// own output. Nothing reaches into the store: the claim `PLAN.md` step 1 makes
// is that a separately published bundle writes into the frame's store and draws
// what came back, and a step that called the store directly would prove the
// store rather than the composition.

import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";
import { VIEWS } from "../../src/web/shell/views.ts";

const PANEL = '[data-app="list"]';

const viewCalled = (name: string): { path: string; apps: string[] } => {
  const found = Object.entries(VIEWS).find(([, v]) => v.title.toLowerCase() === name);
  if (!found) {
    throw new Error(
      `no view called ${JSON.stringify(name)}. The shell places ` +
        `${Object.values(VIEWS).map((v) => v.title.toLowerCase()).join(", ")}.`,
    );
  }
  return { path: found[0], apps: [...found[1].apps] };
};

Given("a visitor opens the {word} view", async function (this: PointerWorld, name: string) {
  const v = viewCalled(name);
  await this.openView(v.path, v.apps);
});

/** The titles the panel currently draws, in the order it draws them. */
const titlesOn = (world: PointerWorld): Promise<string[]> =>
  world.browserPage.$$eval(`${PANEL} [data-task]`, (nodes) =>
    nodes.map((n) => n.getAttribute("data-task") ?? ""),
  );

When("they add the task {string}", async function (this: PointerWorld, title: string) {
  const page = this.browserPage;
  await page.fill(`${PANEL} [data-new-task]`, title);
  await page.click(`${PANEL} [data-add-task]`);
  // The panel has to have DRAWN it before the next step runs, or a scenario
  // that adds two tasks races its own second fill against the first render.
  await page.waitForSelector(`${PANEL} [data-task="${title}"]`, { timeout: 10_000 });
});

When(
  "they tag {string} with {string}",
  async function (this: PointerWorld, title: string, tags: string) {
    await this.browserPage.fill(`${PANEL} [data-tag-input="${title}"]`, tags);
  },
);

When("they take {string} off the list", async function (this: PointerWorld, title: string) {
  await this.browserPage.click(`${PANEL} [data-remove-task="${title}"]`);
});

/**
 * The reload, and the whole of `PLAN.md` step 1's "in memory only".
 *
 * `page.reload()` rather than a fresh context on purpose: the same tab, the
 * same origin and the same storage the browser would keep. Step 2 puts the
 * planner in IndexedDB and this scenario is what has to change then.
 */
When("they load the page again", async function (this: PointerWorld) {
  const page = this.browserPage;
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(`${PANEL} section`, { timeout: 20_000 });
});

Then("the list holds no tasks", async function (this: PointerWorld) {
  const page = this.browserPage;
  await page.waitForSelector(`${PANEL} [data-empty]`, { timeout: 10_000 });
  expect(await titlesOn(this)).toEqual([]);
});

Then("the list holds {string}", async function (this: PointerWorld, expected: string) {
  const wanted = expected.split(",").map((t) => t.trim());
  const page = this.browserPage;
  await page.waitForFunction(
    (n) => document.querySelectorAll('[data-app="list"] [data-task]').length === n,
    wanted.length,
    { timeout: 10_000 },
  );
  expect(await titlesOn(this)).toEqual(wanted);
});

/**
 * What the STORE holds for one task, not what its input shows.
 *
 * The input echoes the keystrokes whether or not the write reached the frame,
 * so the text beside it - rendered from `store.tasks()` - is the reading.
 */
const tagsOn = (world: PointerWorld, title: string): Promise<string> =>
  world.browserPage.$eval(
    `${PANEL} [data-tags="${title}"]`,
    (n) => n.textContent?.trim() ?? "",
  );

Then(
  "{string} carries the tags {string}",
  async function (this: PointerWorld, title: string, tags: string) {
    await this.browserPage.waitForFunction(
      ([t, want]) =>
        document
          .querySelector(`[data-app="list"] [data-tags="${t}"]`)
          ?.textContent?.trim() === want,
      [title, tags] as const,
      { timeout: 10_000 },
    );
    expect(await tagsOn(this, title)).toBe(tags);
  },
);

Then("{string} carries no tags", async function (this: PointerWorld, title: string) {
  expect(await tagsOn(this, title)).toBe("");
});

Then(
  "the panel says the tasks are kept in this page alone",
  async function (this: PointerWorld) {
    const said = await this.browserPage.$eval(
      `${PANEL} [data-memory-note]`,
      (n) => n.textContent?.replace(/\s+/g, " ").trim() ?? "",
    );
    expect(said).toBe("These tasks are kept in this page alone. A reload starts again with none.");
  },
);
