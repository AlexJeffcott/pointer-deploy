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

// The other half of the boundary claim: the panel is gone and the frame is
// not. The frame is the element carrying the unit marker, which the panel's
// own error message is a child of.
Then("the frame is still drawn", async function (this: PointerWorld) {
  const frames = await this.browserPage.$$eval("div[data-unit-marker]", (nodes) => nodes.length);
  expect(frames).toBe(1);
  const shellErrors = await this.browserPage.$$eval("[data-shell-error]", (nodes) => nodes.length);
  expect(shellErrors).toBe(0);
});

Then("the page reports that the frame failed", async function (this: PointerWorld) {
  await this.browserPage.waitForSelector("[data-shell-error]", { timeout: 5_000 });
  const frames = await this.browserPage.$$eval("[data-unit-marker]", (nodes) => nodes.length);
  expect(frames).toBe(0);
});

Then("the page offers to reload", async function (this: PointerWorld) {
  await this.browserPage.waitForSelector("[data-shell-reload]", { timeout: 5_000 });
});
