// Steps about promote refusing a build the test harness made.
//
// @local, and the conventions allow it here: this failure cannot be forced on
// the real store, because forcing it means naming a real channel, and a removed
// refusal would then deploy to visitors.
//
// Nothing is stubbed. Each scenario runs the real scripts/promote.ts from a
// temporary repository against an unresolvable store - see
// features/support/promote-guard.ts, which carries why that is safe. Running
// the script and reading whether it reached the store are shared with the other
// guard feature and live in promote-guard.steps.ts.

import { Given, Then } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { makeRepo, writeBuild } from "../support/promote-guard.ts";
import { PointerWorld } from "../support/world.ts";

/** Proof a run was stopped by the marker check. */
const REFUSED_FOR_MARKER = /harness build/;

/**
 * A build with a marker or without one, and nothing else wrong with it.
 *
 * The source it records is the one the scenario's own tree is at, so the other
 * guard on this path has no reason to fire and a refusal here can only be the
 * marker's.
 */
async function aBuildMarked(world: PointerWorld, marker: string): Promise<void> {
  const repo = await makeRepo();
  await writeBuild(repo.dir, { marker, source: { commit: repo.head, dirty: false } });
  world.guardDir = repo.dir;
}

Given("a build the test harness made", async function (this: PointerWorld) {
  // What BUILD_MARKER or BUILD_MARKER_<UNIT> stamps, and nothing else does.
  await aBuildMarked(this, "harness");
});

Given("a build made the ordinary way", async function (this: PointerWorld) {
  await aBuildMarked(this, "");
});

Then(
  "the promotion is refused because the build came from the harness",
  function (this: PointerWorld) {
    const runResult = this.lastRun!;
    expect(runResult.code).not.toBe(0);
    expect(runResult.stderr).toMatch(REFUSED_FOR_MARKER);
    // The refusal has to name what it found, or an operator cannot tell a
    // stale dist/ from a broken script.
    expect(runResult.stderr).toMatch(/"harness"/);
  },
);

Then("the promotion is not refused for carrying a marker", function (this: PointerWorld) {
  expect(this.lastRun!.stderr).not.toMatch(REFUSED_FOR_MARKER);
});
