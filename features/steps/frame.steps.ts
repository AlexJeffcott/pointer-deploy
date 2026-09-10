// The frame on its own: the views it draws that name no unit, and what the
// browser is asked to fetch for them.
//
// `PLAN.md` step 0 is exactly this claim. A view naming no unit is legitimate -
// the shell owns placement, and a route with nothing placed on it is a page
// rather than a hole - and the price of that being true is that nothing is
// fetched for such a view. The second half is the one with teeth: it is
// measured by counting what the browser asked for.

import { Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { buildIdInShell, PointerWorld } from "../support/world.ts";
import { DEFAULT_ROUTE, VIEWS } from "../../src/web/shell/views.ts";

/** The view title the frame currently has on screen. */
const titleOn = (page: Page): Promise<string> =>
  page.$eval("main h2", (n) => n.textContent?.trim() ?? "");

/**
 * What the walk saw, and what the browser had asked for before it started.
 *
 * Module-level rather than on the world, because two steps share it and the
 * runner takes one scenario at a time. `a visitor opens the frame` clears it,
 * so nothing a previous scenario left can be read as this one's.
 */
let drawn: Array<{ path: string; title: string }> = [];
let requestsBefore = -1;

When("a visitor opens the frame", async function (this: PointerWorld) {
  drawn = [];
  requestsBefore = -1;
  await this.openView(DEFAULT_ROUTE, []);
});

When("they open every other view in the sidenav", async function (this: PointerWorld) {
  const page = this.browserPage;
  drawn = [{ path: DEFAULT_ROUTE, title: await titleOn(page) }];

  // Taken with the frame already on screen and before one link is clicked, so
  // what the count measures is the walk rather than the load.
  requestsBefore = this.requests.length;

  for (const path of Object.keys(VIEWS)) {
    if (path === DEFAULT_ROUTE) continue;
    await page.click(`a[href="${path}"]`);
    // The route, not the title: waiting for the title this step expects would
    // make the wait the assertion, and a frame that drew the wrong view would
    // time out instead of being reported. The Then below compares.
    await page.waitForFunction((want) => location.pathname === want, path, { timeout: 10_000 });
    drawn.push({ path, title: await titleOn(page) });
  }
});

Then("the frame drew each view under its own title", function () {
  expect(drawn.map((d) => `${d.path} ${d.title}`)).toEqual(
    Object.entries(VIEWS).map(([path, view]) => `${path} ${view.title}`),
  );
});

Then("the browser fetched nothing while they walked", function (this: PointerWorld) {
  if (requestsBefore < 0) throw new Error("no walk was taken, so there is nothing to count");
  const since = this.requests.slice(requestsBefore);
  expect(`${since.length} requests: ${since.join(", ")}`).toBe("0 requests: ");
});

// -- what the served page names ---------------------------------------------

Then("the page names no sub-app for the browser to import", function (this: PointerWorld) {
  // The 200 first, and it is not ceremony. "Names no sub-app" is true of a 503,
  // of a 404 and of an empty body, so without this the step passes hardest on
  // exactly the pages it is there to rule out - and it did, for one run, while
  // the server was still refusing a composition that named no app.
  expect(`status ${this.lastResponse?.status}`).toBe("status 200");
  expect(buildIdInShell(this.lastBody)).not.toBeNull();

  const apps = /id="__APPS__">(.*?)<\/script>/s.exec(this.lastBody)?.[1] ?? null;
  expect(`the page's sub-app list: ${apps ?? "absent"}`).toBe("the page's sub-app list: absent");
});

Then("the page asks the browser to warm nothing", function (this: PointerWorld) {
  // The frame's own stylesheet is a <link rel="stylesheet">, not a preload, so
  // a page that carries the whole application still warms nothing. Asserted
  // here so that "no preload tags" cannot be satisfied by a page with no tags.
  expect(this.lastBody).toContain('<link rel="stylesheet"');
  const warmed = [...this.lastBody.matchAll(/<link rel="(modulepreload|preload)"[^>]*href="([^"]+)"/g)]
    .map((m) => `${m[1]} ${m[2]}`);
  expect(warmed).toEqual([]);
});

/**
 * Opens one view by its title, the way a visitor does: the link in the sidenav.
 *
 * By title rather than by path, because the title is what is on screen. `VIEWS`
 * is the one place both live, so a route that moved fails here rather than
 * silently opening something else.
 */
When("they open the {word} view", async function (this: PointerWorld, name: string) {
  const found = Object.entries(VIEWS).find(([, v]) => v.title.toLowerCase() === name);
  if (!found) {
    throw new Error(
      `no view called ${JSON.stringify(name)}. The shell places ` +
        `${Object.values(VIEWS).map((v) => v.title.toLowerCase()).join(", ")}.`,
    );
  }
  await this.openView(found[0], [...found[1].apps]);
});

/**
 * The frame drawing what it read, rather than what it was first rendered with.
 *
 * `index.tsx` sets the report to "unread" BEFORE the render and fills it in
 * when the document comes back, so a state of "ok" here can only have arrived
 * through the store after the first paint.
 */
Then("the frame draws the reading it took of the service", async function (this: PointerWorld) {
  const page = this.browserPage;
  await page.waitForSelector('[data-service="ok"]', { timeout: 20_000 });
  const serves = await page.$eval("[data-service-serves]", (n) => n.textContent?.trim() ?? "");
  expect(serves).not.toBe("unknown");
});
