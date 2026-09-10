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

const greetingOn = (world: PointerWorld): Promise<string> =>
  world.browserPage.$eval("[data-greeting]", (n) => n.textContent?.trim() ?? "");

Given("a visitor opens the {word} view", async function (this: PointerWorld, name: string) {
  const v = view(name);
  await this.openView(v.path, v.apps);
});

When("they open the {word} view", async function (this: PointerWorld, name: string) {
  const v = view(name);
  await this.openView(v.path, v.apps);
});

/**
 * Writes through the panel's own input, and records what was there first.
 *
 * The service is shared by every visitor and every earlier run, so the write
 * has to be undone: `restoreAudience` in the hooks puts it back. Without that
 * the suite leaves its own text on the live page.
 */
When("they set the audience to {string}", async function (this: PointerWorld, audience: string) {
  const page = this.browserPage;
  const input = '[data-app="hello"] input';
  if (this.audienceBefore === null) {
    this.audienceBefore = await page.$eval(input, (el) => (el as HTMLInputElement).value);
  }
  await page.fill(input, audience);
});

Then("the panel greets {string}", async function (this: PointerWorld, audience: string) {
  const page = this.browserPage;
  await page.waitForFunction(
    (want) => (document.querySelector("[data-greeting]")?.textContent ?? "").includes(want as string),
    audience,
    { timeout: 5_000 },
  );
  expect(await greetingOn(this)).toContain(audience);
});

// The cross-boundary reading: what the service holds, asked of the service
// itself, against what the page drew from the frame's one read of it.
Then("the panel greets what the service holds", async function (this: PointerWorld) {
  const base = await this.browserPage.evaluate(() => {
    const el = document.getElementById("__BUILD__");
    return el?.textContent ? ((JSON.parse(el.textContent) as { apiBase?: string }).apiBase ?? "") : "";
  });
  expect(base, "the page names no service, so there is nothing to agree with").not.toBe("");

  const held = (await (await fetch(`${base}/v1/greeting`)).json()) as {
    text: string;
    audience: string;
  };
  const wanted = held.audience ? `${held.text}, ${held.audience}` : held.text;
  await this.browserPage.waitForFunction(
    (want) => document.querySelector("[data-greeting]")?.textContent?.trim() === want,
    wanted,
    { timeout: 10_000 },
  );
  expect(await greetingOn(this)).toBe(wanted);
});
