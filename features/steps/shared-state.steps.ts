// Steps that need a real browser. The behaviour they cover - five separately
// published bundles agreeing about one store - is not observable to anything
// that only fetches HTML.

import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "bun:test";
import { PointerWorld } from "../support/world.ts";
import { VIEWS } from "../../src/web/shell/views.ts";

/**
 * The view a scenario names, from the shell's own table.
 *
 * This was a second copy of the layout - the paths and the app lists, written
 * out again - with nothing tying it to `src/web/shell/views.ts`. TODO §14.
 *
 * The trap, because it is smaller than it looks: importing the table from the
 * working tree does NOT tie the harness to the DEPLOYED shell. A @browser
 * scenario without @test-channel reads a PUBLISHED shell, which may place apps
 * differently from the tree this import came from. What it removes is the drift
 * between two copies in one tree. The published pair is covered at build time,
 * by `placementProblems` in build.ts, which runs on the bytes being published.
 */
const BY_NAME = new Map(
  Object.entries(VIEWS).map(([path, v]) => [v.title.toLowerCase(), { path, apps: [...v.apps] }]),
);

const view = (name: string) => {
  const v = BY_NAME.get(name);
  if (!v) {
    throw new Error(
      `no view called ${JSON.stringify(name)}. The shell places ` +
        `${[...BY_NAME.keys()].join(", ")}.`,
    );
  }
  return v;
};

/** Every count the page currently shows for a namespace, from any sub-app. */
async function readsOf(world: PointerWorld, ns: string): Promise<number[]> {
  return world.browserPage.$$eval(
    `[data-count-for="${ns}"]`,
    (nodes) => nodes.map((n) => Number(n.textContent)),
  );
}

Given("a visitor opens the {word} view", async function (this: PointerWorld, name: string) {
  const v = view(name);
  await this.openView(v.path, v.apps);
});

When("they open the {word} view", async function (this: PointerWorld, name: string) {
  const v = view(name);
  await this.openView(v.path, v.apps);
});

When("they raise the {string} counter by {int}", async function (this: PointerWorld, ns: string, by: number) {
  const page = this.browserPage;
  for (let i = 0; i < by; i++) {
    await page.click(`[data-app="${ns}"] button:has-text("+1")`);
  }
  await page.waitForFunction(
    ([selector, want]) =>
      document.querySelector(selector as string)?.textContent?.trim() === String(want),
    [`[data-app="${ns}"] section p:nth-of-type(2)`, by] as const,
    { timeout: 5_000 },
  );
});

When("they set the name to {string}", async function (this: PointerWorld, name: string) {
  await this.browserPage.fill("#who", name);
});

When("they set the colour to {string}", async function (this: PointerWorld, colour: string) {
  await this.browserPage.$eval(
    "#colour",
    (el, value) => {
      const input = el as HTMLInputElement;
      input.value = value as string;
      input.dispatchEvent(new Event("input", { bubbles: true }));
    },
    colour,
  );
});

Then("every sub-app that lists counters reads {string} as {int}", async function (this: PointerWorld, ns: string, want: number) {
  const seen = await readsOf(this, ns);
  // At least one sub-app must list it, or an empty page passes.
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).toEqual(seen.map(() => want));
});

// Cucumber matches on arity, so the four names are separate parameters rather
// than a rest argument.
Then("the totals view lists the namespaces {word}, {word}, {word} and {word}", async function (this: PointerWorld, a: string, b: string, c: string, d: string) {
  const wanted = [a, b, c, d].sort();
  // Waits, because a namespace now appears when its sub-app mounts rather than
  // before its first render: `mount(el)` called register() itself, and a
  // component registers from a layout effect. The set converges within a frame
  // and this asserts on where it converges, not on the frame it started in.
  await this.browserPage.waitForFunction(
    (want) => {
      const seen = [...document.querySelectorAll("[data-app='charlie'] [data-ns]")]
        .map((n) => n.textContent?.trim() ?? "")
        .sort();
      return JSON.stringify(seen) === JSON.stringify(want);
    },
    wanted,
    { timeout: 5_000 },
  );
  const listed = await this.browserPage.$$eval("[data-app='charlie'] [data-ns]", (nodes) =>
    nodes.map((n) => n.textContent?.trim() ?? ""),
  );
  expect([...listed].sort()).toEqual(wanted);
});

Then("the bar for {string} is longer than the bar for {string}", async function (this: PointerWorld, bigger: string, smaller: string) {
  const width = (ns: string) =>
    this.browserPage.$eval(
      `[data-app="delta"] [data-ns="${ns}"] ~ span > span`,
      (el) => (el as HTMLElement).getBoundingClientRect().width,
    );
  const [big, small] = await Promise.all([width(bigger), width(smaller)]);
  expect(big).toBeGreaterThan(small);
  // A zero count must draw nothing, or every bar being full width also passes.
  expect(small).toBe(0);
});

Then("every sub-app on the page names {string}", async function (this: PointerWorld, name: string) {
  const page = this.browserPage;
  await page.waitForFunction(
    (wanted) =>
      [...document.querySelectorAll("[data-app] section")].every((s) =>
        s.textContent?.includes(wanted as string),
      ),
    name,
    { timeout: 5_000 },
  );
  const panels = await page.$$eval("[data-app] section", (nodes) => nodes.length);
  expect(panels).toBeGreaterThan(1);
});

Then("every sub-app on the page is drawn in that colour", async function (this: PointerWorld) {
  const page = this.browserPage;
  // #e2703a as the browser reports it.
  const expected = "rgb(226, 112, 58)";
  await page.waitForFunction(
    (want) =>
      [...document.querySelectorAll("[data-app] section")].every(
        (s) => getComputedStyle(s).borderTopColor === want,
      ),
    expected,
    { timeout: 5_000 },
  );
  const colours = await page.$$eval("[data-app] section", (nodes) =>
    nodes.map((n) => getComputedStyle(n).borderTopColor),
  );
  expect(colours.length).toBeGreaterThan(1);
  expect(colours).toEqual(colours.map(() => expected));
});

// Which directory a sub-app is served from is a property of the manifest schema,
// not of the application. Schema 2 put every app under one build directory as
// apps/<name>-<hash>.js; schema 3 gives each unit its own base and serves
// units/<name>/<id>/<name>-<hash>.js. The FILE NAME is the same under both, so
// match on the last path segment and these steps survive a schema change.
const fetchesOf = (requests: string[], app: string) =>
  requests.filter((u) => {
    const file = new URL(u).pathname.split("/").pop() ?? "";
    return file.startsWith(`${app}-`);
  });

Then("the bundles for the {word} view have been fetched", function (this: PointerWorld, name: string) {
  for (const app of view(name).apps) {
    const hits = fetchesOf(this.requests, app).filter((u) => u.endsWith(".js"));
    expect(hits.length).toBeGreaterThan(0);
  }
});

/**
 * Warmed and not evaluated.
 *
 * The half of the old "fetched only when a view first needs it" that survived
 * preloading. Which of the two halves matters is the one a sub-app can notice:
 * a bundle in the cache changes nothing it can observe, and a bundle that has
 * been EVALUATED has had its top-level code run. A background import() would
 * have warmed the cache and run the module; a modulepreload does not.
 */
Then("no sub-app on the {word} view has run", async function (this: PointerWorld, name: string) {
  for (const app of view(name).apps) {
    const rendered = await this.browserPage.$$eval(
      `[data-app="${app}"] section`,
      (nodes) => nodes.length,
    );
    expect(rendered).toBe(0);
  }
});

Then("each bundle for the {word} view was fetched once", function (this: PointerWorld, name: string) {
  for (const app of view(name).apps) {
    const hits = fetchesOf(this.requests, app).filter((u) => u.endsWith(".js"));
    expect(hits).toHaveLength(1);
  }
});
