// Steps about promote refusing a build whose source is not this tree's.
//
// @local, and the conventions allow it here for the same reason the marker
// scenarios are: forcing the failure means naming a real channel, and a removed
// refusal would then deploy to visitors.
//
// Nothing is stubbed. Each scenario runs the real scripts/promote.ts from a
// temporary repository against an unresolvable store - see
// features/support/promote-guard.ts, which carries why that is safe. Running
// the script and reading whether it reached the store are shared with the other
// guard feature and live in promote-guard.steps.ts.

import { Given, Then } from "@cucumber/cucumber";
import { expect } from "bun:test";
import { makeRepo, writeBuild } from "../support/promote-guard.ts";
import { PointerWorld } from "../support/world.ts";

/** Proof a run was stopped by the source check, and not by something else. */
const REFUSED_FOR_SOURCE = /refusing: dist\/build\.json was built from/;

Given("a build made from an older commit", async function (this: PointerWorld) {
  // A real earlier commit in the scenario's own repository, not a made-up hash:
  // what an operator has is a build from a commit the tree has since moved past.
  const repo = await makeRepo();
  await writeBuild(repo.dir, { source: { commit: repo.older, dirty: false } });
  this.guardDir = repo.dir;
});

Given("a build made from an uncommitted working tree", async function (this: PointerWorld) {
  // The commit is the one the tree is at, so only the dirty flag can refuse
  // this. Without that the scenario would pass on a check that compared
  // commits alone.
  const repo = await makeRepo();
  await writeBuild(repo.dir, { source: { commit: repo.head, dirty: true } });
  this.guardDir = repo.dir;
});

Given("a build made from the commit this tree is at", async function (this: PointerWorld) {
  const repo = await makeRepo();
  await writeBuild(repo.dir, { source: { commit: repo.head, dirty: false } });
  this.guardDir = repo.dir;
});

Then(
  "the promotion is refused because the build is not from this tree's source",
  function (this: PointerWorld) {
    const runResult = this.lastRun!;
    expect(runResult.code).not.toBe(0);
    expect(runResult.stderr).toMatch(REFUSED_FOR_SOURCE);
    // The refusal has to name the way out, or an operator meaning to serve an
    // older build has a script telling them no and nothing else.
    expect(runResult.stderr).toMatch(/--no-source-check/);
  },
);

Then("the promotion is not refused for its source", function (this: PointerWorld) {
  // Any refusal at all, not only this one's wording: a guard that refused for
  // some other reason would leave the run just as stopped.
  expect(this.lastRun!.stderr).not.toMatch(/refusing:/);
});

Then("the promotion warns that the source check was skipped", function (this: PointerWorld) {
  const runResult = this.lastRun!;
  expect(runResult.stderr).toMatch(/WARNING --no-source-check/);
  // And says what it let through, not merely that it let something through.
  expect(runResult.stderr).toMatch(/was built from/);
});
