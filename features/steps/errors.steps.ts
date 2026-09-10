import { Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";

// The panel half of this file is gone with `hello`: nothing on this slate is
// mounted inside `AsyncAppLoader`, so there is no panel to throw, to report an
// error, or to mount again. It returns at `PLAN.md` step 1, from commit
// ff196d5. TODO §31 records it.

When("the frame is asked to throw", async function (this: PointerWorld) {
  await this.browserPage.click(`[data-throw="shell"]`);
});

Then("the page reports that the frame failed", async function (this: PointerWorld) {
  await this.browserPage.waitForSelector("[data-shell-error]", { timeout: 5_000 });
  const frames = await this.browserPage.$$eval("[data-unit-marker]", (nodes) => nodes.length);
  expect(frames).toBe(0);
});

Then("the page offers to reload", async function (this: PointerWorld) {
  await this.browserPage.waitForSelector("[data-shell-reload]", { timeout: 5_000 });
});
