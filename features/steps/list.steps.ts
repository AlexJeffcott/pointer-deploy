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

/**
 * Typed, one key at a time, and never filled.
 *
 * `page.fill` sets the whole string in a single `input` event, so a control
 * that rewrites its own value between keystrokes passes it. That is exactly
 * what this input did: `value` was `task.tags.join(", ")`, and typing `,` after
 * `travel` made the store round-trip `["travel"]` and Preact write `travel`
 * back over `travel,`. The comma was erased as it was typed, no visitor could
 * reach a second tag, and this step was green throughout.
 *
 * `pressSequentially` sends a key per character, which is the only way this
 * step measures what a person does. The clear is separate because typing into
 * a field that already holds text appends to it.
 */
When(
  "they tag {string} with {string}",
  async function (this: PointerWorld, title: string, tags: string) {
    const input = this.browserPage.locator(`${PANEL} [data-tag-input="${title}"]`);
    await input.clear();
    await input.pressSequentially(tags, { delay: 10 });
  },
);

/** The same keyboard, continuing where the store left the text. */
When(
  "they go on typing {string} after the tags on {string}",
  async function (this: PointerWorld, more: string, title: string) {
    const input = this.browserPage.locator(`${PANEL} [data-tag-input="${title}"]`);
    await input.click();
    await this.browserPage.keyboard.press("End");
    await input.pressSequentially(more, { delay: 10 });
  },
);

When("they take {string} off the list", async function (this: PointerWorld, title: string) {
  await this.browserPage.click(`${PANEL} [data-remove-task="${title}"]`);
});

/**
 * The reload, and what `PLAN.md` step 2 measures with it.
 *
 * `page.reload()` rather than a fresh context on purpose: the same tab, the
 * same origin and the same storage the browser would keep. At step 1 this ended
 * the planner; from step 2 it is how the planner is shown to survive, and a
 * fresh profile - `openSecondBrowser` - is what shows the other half.
 *
 * The wait is on the panel having drawn its LIST and not merely its section.
 * Reading IndexedDB is asynchronous, so a step that returned at the first paint
 * would hand the next one a panel still saying it was reading.
 */
When("they load the page again", async function (this: PointerWorld) {
  const page = this.browserPage;
  // Not a settling delay, and not politeness to the harness. Writing is
  // asynchronous: measured on 2026-09-11, a task added and the page reloaded in
  // the same ten milliseconds was gone, because the transaction was still open
  // when the browser took the page away. What survives a reload is what was
  // STORED, so this waits for the page's own reading that there is nothing left
  // to store - and a reload that beats that window is TODO §40, which this step
  // is deliberately not measuring.
  await page.waitForFunction(
    () => document.documentElement.dataset.plannerPending !== "yes",
    undefined,
    { timeout: 10_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector(`${PANEL} section`, { timeout: 20_000 });
  await page.waitForSelector(`${PANEL} [data-memory-note]`, { timeout: 20_000 });
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

/**
 * What the CONTROL shows, which is the other half of the reading above.
 *
 * The store is the truth about tags and this is the truth about typing: a
 * control that drops a character cannot be seen in `store.tasks()`, because the
 * store never held the separator in the first place.
 */
Then(
  "the tag box for {string} reads {string}",
  async function (this: PointerWorld, title: string, text: string) {
    expect(
      await this.browserPage.inputValue(`${PANEL} [data-tag-input="${title}"]`),
    ).toBe(text);
  },
);

// The note at the foot of the panel is read by `planner.steps.ts`. It says one
// of two sentences from `PLAN.md` step 2 onwards, and which one is the reading.
