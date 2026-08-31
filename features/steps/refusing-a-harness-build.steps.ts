import { Given, Then } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { makeRepo, writeBuild } from "../support/promote-guard.ts";
import { PointerWorld } from "../support/world.ts";

const REFUSED_FOR_MARKER = /harness build/;

async function aBuildMarked(world: PointerWorld, marker: string): Promise<void> {
  const repo = await makeRepo();
  await writeBuild(repo.dir, { marker, source: { commit: repo.head, dirty: false } });
  world.guardDir = repo.dir;
}

Given("a build the test harness made", async function (this: PointerWorld) {
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
    expect(runResult.stderr).toMatch(/"harness"/);
  },
);

Then("the promotion is not refused for carrying a marker", function (this: PointerWorld) {
  expect(this.lastRun!.stderr).not.toMatch(REFUSED_FOR_MARKER);
});
