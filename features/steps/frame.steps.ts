// The frame on its own: the views it draws that name no unit, and what the
// browser is asked to fetch for them.
//
// `PLAN.md` step 0 made this claim about all five routes. Step 1 places `list`
// on `/`, so the subject is the four that still name none - and the claim gains
// teeth rather than losing them: with a unit in the tree, "nothing is fetched"
// is a difference between two views rather than a property of an empty build.
//
// Two halves, and they fail differently. What the served page NAMES is read off
// the HTML. What a browser FETCHES while walking the sidenav is counted from
// the network: a link that navigated instead of routing satisfies the first and
// breaks the second.

import { Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { buildIdInShell, PointerWorld } from "../support/world.ts";
import { DEFAULT_ROUTE, placedApps, VIEWS } from "../../src/web/shell/views.ts";

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
  // The landing route's own units, whatever they are. `PLAN.md` step 1 puts
  // `list` here, so the walk that follows starts from a page that has already
  // fetched everything the landing view needs - which is what makes "fetched
  // nothing" a statement about the four views that place none.
  await this.openView(DEFAULT_ROUTE, [...VIEWS[DEFAULT_ROUTE]!.apps]);
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

/** The names in the page's `__APPS__` block, or null when it carries none. */
const appsNamed = (body: string): string[] | null => {
  const block = /id="__APPS__">(.*?)<\/script>/s.exec(body)?.[1] ?? null;
  if (block === null) return null;
  return Object.keys(JSON.parse(block) as Record<string, unknown>).sort();
};

Then(
  "the page names {string} for the browser to import, and no other sub-app",
  function (this: PointerWorld, named: string) {
    // The 200 first, and it is not ceremony. A claim about what a page names is
    // true of a 503, of a 404 and of an empty body, so without this the step
    // would pass hardest on exactly the pages it is there to rule out - and it
    // did, for one run, while the server was still refusing a composition that
    // named no app.
    expect(`status ${this.lastResponse?.status}`).toBe("status 200");
    expect(buildIdInShell(this.lastBody)).not.toBeNull();

    const wanted = named.split(",").map((n) => n.trim()).sort();
    // Against the views rather than against a literal, so a unit placed on a
    // route without being built - or built without being placed - fails here as
    // well as at the build's own placement check.
    expect(wanted).toEqual(placedApps().sort());
    expect(appsNamed(this.lastBody) ?? ["absent"]).toEqual(wanted);
  },
);

Then(
  "the page asks the browser to warm {string}, and nothing else",
  function (this: PointerWorld, named: string) {
    // The frame's own stylesheet is a <link rel="stylesheet">, not a preload, so
    // a page warming one unit is not a page warming everything. Asserted here so
    // that the count below cannot be satisfied by a page with no tags at all.
    expect(this.lastBody).toContain('<link rel="stylesheet"');
    const warmed = [
      ...this.lastBody.matchAll(/<link rel="(?:modulepreload|preload)"[^>]*href="([^"]+)"/g),
    ].map((m) => m[1]!);

    const wanted = named.split(",").map((n) => n.trim());
    // Every warmed file belongs to a unit a view places, and every such unit is
    // warmed. The URL carries `/units/<name>/<id>/`, so the name is read off
    // what the browser was actually told to fetch.
    const unitOf = (url: string) => /\/units\/([^/]+)\//.exec(url)?.[1] ?? url;
    expect([...new Set(warmed.map(unitOf))].sort()).toEqual([...wanted].sort());
  },
);

/**
 * Opens one view by its title, the way a visitor does: the link in the sidenav.
 *
 * By title rather than by path, because the title is what is on screen. `VIEWS`
 * is the one place both live, so a route that moved fails here rather than
 * silently opening something else.
 */
When("they open the {word} view", async function (this: PointerWorld, name: string) {
  const v = this.viewCalled(name);
  await this.openView(v.path, v.apps);
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
