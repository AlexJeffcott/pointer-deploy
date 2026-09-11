// Where the planner is kept, `PLAN.md` step 2.
//
// Two kinds of step here, and the difference is deliberate. Most of them drive
// the panel and read the panel, like `list.steps.ts`, because what step 2 has
// to show is that a reload puts the same list back in front of a visitor. Two
// of them open IndexedDB directly, because "the task is in the database" is a
// claim about the database and a step that read the panel could not tell a
// stored task from a task still in a signal.

import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";
import { VIEWS } from "../../src/web/shell/views.ts";

const PANEL = '[data-app="list"]';

const viewCalled = (name: string): { path: string; apps: string[] } => {
  const found = Object.entries(VIEWS).find(([, v]) => v.title.toLowerCase() === name);
  if (!found) throw new Error(`no view called ${JSON.stringify(name)}`);
  return { path: found[0], apps: [...found[1].apps] };
};

/**
 * A browser with no IndexedDB at all.
 *
 * A private window, a blocked origin and a setting all reach the shell the same
 * way: the factory is not there, or it refuses to open. This arranges the first
 * of those, which is the one a page cannot tell from the others anyway.
 *
 * Added before any navigation, so it is in place for the shell's first script.
 */
Given("this browser refuses IndexedDB", async function (this: PointerWorld) {
  await this.browserPage.addInitScript(() => {
    Object.defineProperty(globalThis, "indexedDB", { value: undefined, configurable: true });
  });
});

/**
 * A planner that takes a moment to open, which is the only way the page's
 * "reading" state can be seen at all.
 *
 * Measured on 2026-09-11: with no delay, the mutation that draws the empty
 * message before the planner has been read stayed GREEN. `list` is a separately
 * published bundle, fetched and imported after the shell paints, so IndexedDB
 * is always open before the panel first renders - and a requirement about the
 * first paint had no moment to be about. This arranges that moment.
 *
 * One open only. The steps below open the database themselves to read it, and
 * delaying those as well would slow every scenario for nothing.
 *
 * The delay is a real open, made late, behind an object carrying the three
 * handlers a caller assigns. `indexedDB.open` returns its request
 * synchronously, so there is nothing to await and nothing to wrap.
 */
Given("the planner is slow to open", async function (this: PointerWorld) {
  await this.browserPage.addInitScript(() => {
    type Handler = ((event: Event) => void) | null;
    const proto = IDBFactory.prototype;
    const real = proto.open;
    let delayed = false;

    proto.open = function (this: IDBFactory, name: string, version?: number) {
      if (delayed) return real.call(this, name, version);
      delayed = true;

      const pending = {
        result: null as unknown,
        error: null as DOMException | null,
        onsuccess: null as Handler,
        onerror: null as Handler,
        onupgradeneeded: null as Handler,
      };

      setTimeout(() => {
        const request = real.call(this, name, version);
        request.onupgradeneeded = (event) => {
          pending.result = request.result;
          pending.onupgradeneeded?.(event);
        };
        request.onsuccess = (event) => {
          pending.result = request.result;
          pending.onsuccess?.(event);
        };
        request.onerror = (event) => {
          pending.error = request.error;
          pending.onerror?.(event);
        };
      }, 1_500);

      return pending as unknown as IDBOpenDBRequest;
    } as typeof proto.open;
  });
});

Then("the panel says it is reading the planner", async function (this: PointerWorld) {
  await this.browserPage.waitForSelector(`${PANEL} [data-planner-unread]`, { timeout: 10_000 });
});

/**
 * A second browser, which is what makes "in this browser alone" measurable.
 *
 * A new context rather than a new tab: IndexedDB is per origin per profile, and
 * two tabs of one profile share the planner. Everything after this step reads
 * the new page, and the context is closed when the scenario ends.
 */
When("a second browser opens the {word} view", async function (this: PointerWorld, name: string) {
  const v = viewCalled(name);
  await this.openSecondBrowser();
  await this.openView(v.path, v.apps);
});

const noteOn = (world: PointerWorld): Promise<string> =>
  world.browserPage.$eval(
    `${PANEL} [data-memory-note]`,
    (n) => n.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );

const saysNote = async (world: PointerWorld, expected: string): Promise<void> => {
  await world.browserPage.waitForSelector(`${PANEL} [data-memory-note]`, { timeout: 20_000 });
  expect(await noteOn(world)).toBe(expected);
};

Then("the panel says the tasks are kept in this browser alone", async function (this: PointerWorld) {
  await saysNote(
    this,
    "These tasks are kept in this browser alone. Another browser starts with none.",
  );
});

/** Step 1's sentence. It is what the panel falls back to when nothing stores. */
Then("the panel says the tasks are kept in this page alone", async function (this: PointerWorld) {
  await saysNote(this, "These tasks are kept in this page alone. A reload starts again with none.");
});

/**
 * The titles in the `tasks` object store, read from the page's own origin.
 *
 * Opened with no version, so this never upgrades anything and never blocks the
 * shell's own handle. A write is asynchronous and lands after the render that
 * triggered it, so the caller polls rather than reading once.
 */
const storedTitles = (world: PointerWorld, db: string): Promise<string[]> =>
  world.browserPage.evaluate(
    (name) =>
      new Promise<string[]>((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onerror = () => reject(new Error(`could not open ${name}`));
        open.onsuccess = () => {
          const handle = open.result;
          const all = handle.transaction("tasks", "readonly").objectStore("tasks").getAll();
          all.onsuccess = () => {
            resolve((all.result as Array<{ title: string }>).map((t) => t.title));
            handle.close();
          };
          all.onerror = () => reject(new Error(`could not read tasks from ${name}`));
        };
      }),
    db,
  );

Then(
  "the database {string} holds the task {string}",
  async function (this: PointerWorld, db: string, title: string) {
    const deadline = Date.now() + 10_000;
    let seen: string[] = [];
    while (Date.now() < deadline) {
      seen = await storedTitles(this, db);
      if (seen.includes(title)) return;
      await Bun.sleep(100);
    }
    expect(seen).toContain(title);
  },
);

Then(
  "the database {string} is at schema version {int}",
  async function (this: PointerWorld, db: string, version: number) {
    const deadline = Date.now() + 10_000;
    let seen: unknown = null;
    while (Date.now() < deadline) {
      seen = await this.browserPage.evaluate(
        (name) =>
          new Promise<unknown>((resolve, reject) => {
            const open = indexedDB.open(name);
            open.onerror = () => reject(new Error(`could not open ${name}`));
            open.onsuccess = () => {
              const handle = open.result;
              const row = handle
                .transaction("meta", "readonly")
                .objectStore("meta")
                .get("schemaVersion");
              row.onsuccess = () => {
                resolve((row.result as { value?: unknown } | undefined)?.value ?? null);
                handle.close();
              };
              row.onerror = () => reject(new Error(`could not read meta from ${name}`));
            };
          }),
        db,
      );
      if (seen === version) return;
      await Bun.sleep(100);
    }
    expect(seen).toBe(version);
  },
);

/**
 * The first paint, and what it must not have said.
 *
 * Recorded by an observer the world installs before any navigation, which notes
 * the planner's state every time an empty message is added to the page. A panel
 * that drew "No tasks yet" while the planner was still being read told a
 * visitor with a full planner that it was empty - and a step that looked at the
 * page afterwards would find the correct list and agree with it.
 */
Then(
  "the panel said nothing about being empty before the planner was read",
  async function (this: PointerWorld) {
    await this.browserPage.waitForSelector(`${PANEL} [data-empty]`, { timeout: 20_000 });
    const when = await this.emptyMessageStates();
    expect(when.filter((s) => s !== "stored" && s !== "unstored")).toEqual([]);
  },
);
