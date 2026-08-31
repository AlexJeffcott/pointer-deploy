import { Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { REACHED_STORE, runPromote } from "../support/promote-guard.ts";
import { PointerWorld } from "../support/world.ts";

When(
  "the operator promotes it to the {string} channel",
  async function (this: PointerWorld, channel: string) {
    this.lastRun = await runPromote(this.guardDir!, [channel, "--from-build"]);
  },
);

When(
  "the operator promotes it to the {string} channel with --no-source-check",
  async function (this: PointerWorld, channel: string) {
    this.lastRun = await runPromote(this.guardDir!, [channel, "--from-build", "--no-source-check"]);
  },
);

Then("the store was never contacted", function (this: PointerWorld) {
  const runResult = this.lastRun!;
  expect(`${runResult.stdout}\n${runResult.stderr}`).not.toMatch(REACHED_STORE);
});

Then("the store was contacted", function (this: PointerWorld) {
  expect(`${this.lastRun!.stdout}\n${this.lastRun!.stderr}`).toMatch(REACHED_STORE);
});
