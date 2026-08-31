import { Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";

When("the {string} panel is asked to throw", async function (this: PointerWorld, app: string) {
  await this.browserPage.click(`[data-throw="${app}"]`);
});

When("the frame is asked to throw", async function (this: PointerWorld) {
  await this.browserPage.click(`[data-throw="shell"]`);
});

When("they mount the {string} panel again", async function (this: PointerWorld, app: string) {
  await this.browserPage.click(`[data-app-retry="${app}"]`);
});

Then("the {string} panel reports an error", async function (this: PointerWorld, app: string) {
  await this.browserPage.waitForSelector(`[data-app-error="${app}"]`, { timeout: 5_000 });
});

Then("the {string} panel is drawn", async function (this: PointerWorld, app: string) {
  await this.browserPage.waitForSelector(`[data-app="${app}"] section`, { timeout: 5_000 });
  const errors = await this.browserPage.$$eval(
    `[data-app-error="${app}"]`,
    (nodes) => nodes.length,
  );
  expect(errors).toBe(0);
});

Then("the {string} panel reads {int}", async function (this: PointerWorld, app: string, want: number) {
  const text = await this.browserPage.$eval(
    `[data-app="${app}"] section p:nth-of-type(2)`,
    (el) => el.textContent?.trim() ?? "",
  );
  expect(text).toBe(String(want));
});

Then("the page reports that the frame failed", async function (this: PointerWorld) {
  await this.browserPage.waitForSelector("[data-shell-error]", { timeout: 5_000 });
  const frames = await this.browserPage.$$eval("[data-unit-marker]", (nodes) => nodes.length);
  expect(frames).toBe(0);
});

Then("the page offers to reload", async function (this: PointerWorld) {
  await this.browserPage.waitForSelector("[data-shell-reload]", { timeout: 5_000 });
});
