// The steps both promote-guard features share: running the real script, and
// reading whether it got as far as the store.
//
// Two features refuse a build at the same point in `promote --from-build` - one
// for the marker a harness stamps on it, one for the source it was built from -
// and both need the same "did this reach the store" reading. A step is global
// to a cucumber run, so the shared half lives here rather than in whichever
// feature happened to be written first.
//
// `features/support/promote-guard.ts` carries why running the real script is
// safe here.

import { Then, When } from "@cucumber/cucumber";
import { expect } from "bun:test";
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
  // The positive half. Without it "not refused" would also pass on a script
  // that exited early for some unrelated reason.
  expect(`${this.lastRun!.stdout}\n${this.lastRun!.stderr}`).toMatch(REACHED_STORE);
});
