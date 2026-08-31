import { Given, Then } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { makeRepo, writeBuild } from "../support/promote-guard.ts";
import { PointerWorld } from "../support/world.ts";

const REFUSED_FOR_SOURCE = /refusing: dist\/build\.json was built from/;

Given("a build made from an older commit", async function (this: PointerWorld) {
  const repo = await makeRepo();
  await writeBuild(repo.dir, { source: { commit: repo.older, dirty: false } });
  this.guardDir = repo.dir;
});

Given("a build made from an uncommitted working tree", async function (this: PointerWorld) {
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
    expect(runResult.stderr).toMatch(/--no-source-check/);
  },
);

Then("the promotion is not refused for its source", function (this: PointerWorld) {
  expect(this.lastRun!.stderr).not.toMatch(/refusing:/);
});

Then("the promotion warns that the source check was skipped", function (this: PointerWorld) {
  const runResult = this.lastRun!;
  expect(runResult.stderr).toMatch(/WARNING --no-source-check/);
  expect(runResult.stderr).toMatch(/was built from/);
});
