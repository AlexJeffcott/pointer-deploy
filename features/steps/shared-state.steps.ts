import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";
import { VIEWS } from "../../src/web/shell/views.ts";

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

/**
 * Raises a counter, and records what it stood at first.
 *
 * The start is READ and not assumed to be zero. A page told about a service
 * fills its counters from it, and that service is shared by every visitor and
 * every earlier run - so "clicked six times, therefore reads 6" is only true
 * for a page whose service holds nothing, and the suite is not that page.
 */
When("they raise the {string} counter by {int}", async function (this: PointerWorld, ns: string, by: number) {
  const page = this.browserPage;
  const selector = `[data-app="${ns}"] section p:nth-of-type(2)`;
  const before = Number(await page.$eval(selector, (n) => n.textContent?.trim() ?? ""));
  if (!Number.isFinite(before)) throw new Error(`${ns} does not show a number to raise`);
  this.countsBefore.set(ns, before);

  for (let i = 0; i < by; i++) {
    await page.click(`[data-app="${ns}"] button:has-text("+1")`);
  }
  await page.waitForFunction(
    ([sel, want]) => document.querySelector(sel as string)?.textContent?.trim() === String(want),
    [selector, before + by] as const,
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

// What the scenario is named for: five separately published bundles holding one
// number between them. The number itself belongs to the service and is not this
// scenario's subject.
Then("every sub-app that lists counters agrees about {string}", async function (this: PointerWorld, ns: string) {
  const seen = await readsOf(this, ns);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).toEqual(seen.map(() => seen[0]!));
});

Then("the {string} count rose by {int}", async function (this: PointerWorld, ns: string, by: number) {
  const before = this.countsBefore.get(ns);
  if (before === undefined) throw new Error(`no step has raised ${ns}, so nothing recorded its start`);
  const seen = await readsOf(this, ns);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).toEqual(seen.map(() => before + by));
});

Then("every sub-app that lists counters reads {string} as {int}", async function (this: PointerWorld, ns: string, want: number) {
  const seen = await readsOf(this, ns);
  expect(seen.length).toBeGreaterThan(0);
  expect(seen).toEqual(seen.map(() => want));
});

Then("the totals view lists the namespaces {word}, {word}, {word} and {word}", async function (this: PointerWorld, a: string, b: string, c: string, d: string) {
  // Read from the attribute, not from the text. What the row SAYS is the
  // service's label, which an operator renames at runtime - so a scenario
  // asserting the text would go red every time the feature was used. The
  // namespace is what this scenario is about, and the attribute carries it in
  // every composition, old units included.
  const wanted = [a, b, c, d].sort();
  const namespaces = () =>
    this.browserPage.$$eval("[data-app='charlie'] [data-ns]", (nodes) =>
      nodes.map((n) => n.getAttribute("data-ns") ?? ""),
    );
  await this.browserPage.waitForFunction(
    (want) => {
      const seen = [...document.querySelectorAll("[data-app='charlie'] [data-ns]")]
        .map((n) => n.getAttribute("data-ns") ?? "")
        .sort();
      return JSON.stringify(seen) === JSON.stringify(want);
    },
    wanted,
    { timeout: 5_000 },
  );
  expect([...(await namespaces())].sort()).toEqual(wanted);
});

Then("the bar for {string} is longer than the bar for {string}", async function (this: PointerWorld, bigger: string, smaller: string) {
  const width = (ns: string) =>
    this.browserPage.$eval(
      `[data-app="delta"] [data-ns="${ns}"] ~ span > span`,
      (el) => (el as HTMLElement).getBoundingClientRect().width,
    );
  const [big, small] = await Promise.all([width(bigger), width(smaller)]);
  expect(big).toBeGreaterThan(small);
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
