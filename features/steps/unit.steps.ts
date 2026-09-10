import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import {
  type Channel,
  PointerWorld,
  PROPAGATION_WINDOW_MS,
  run,
  unitIdsInShell,
} from "../support/world.ts";
import { UNITS, type Unit } from "../../scripts/contract.ts";

const BUDGET_MS = PROPAGATION_WINDOW_MS + 15_000;

/** The id each "a new <unit> unit is published" step produced, by unit. */
export const fresh = new Map<string, string>();

export const RUN = Date.now().toString(36);

/**
 * Builds with one unit's marker moved, and publishes.
 *
 * Named for a sub-app, and on this slate the only unit it is ever handed is the
 * shell. The steps that took a sub-app - deploy one and watch the frame stay
 * put, publish and watch one unit upload alone, promote a unit whose contract
 * or member set does not fit - are gone with `hello`, because each of them is a
 * sentence about two units. They are restored at `PLAN.md` step 1 from commit
 * ff196d5; TODO §31 carries the loss.
 */
export async function publishOneApp(world: PointerWorld, app: string, marker: string) {
  const built = await run(["bun", "run", "build"], {
    BUILD_MARKER: "one",
    [`BUILD_MARKER_${app.toUpperCase()}`]: marker,
  });
  if (built.code !== 0) throw new Error(`build failed:\n${built.stderr}`);

  const published = await run(["bun", "run", "--silent", "scripts/publish.ts"]);
  if (published.code !== 0) throw new Error(`publish failed:\n${published.stderr}`);
  world.lastRun = published;
  return JSON.parse(published.stdout) as Record<Unit, string>;
}

Given("a new {string} unit is published", async function (this: PointerWorld, app: string) {
  const ids = await publishOneApp(this, app, `${app}-v2`);
  const id = ids[app as Unit];
  const baseline = this.unitIdOf("one", app as Unit);
  expect(id).not.toBe(baseline);
  fresh.set(app, id);
});

Given("that {string} unit is already deployed to the {word} channel", async function (this: PointerWorld, app: string, channel: string) {
  const id = fresh.get(app);
  if (!id) throw new Error(`no fresh ${app} unit was published`);
  this.lastRun = await this.promoteUnit(channel as Channel, app as Unit, id);
  expect(this.lastRun.code).toBe(0);
  await this.awaitUnit(channel as Channel, app as Unit, id, BUDGET_MS);
});

When("the operator promotes a {string} unit that was never published", async function (this: PointerWorld, app: string) {
  this.lastRun = await this.promoteUnit("qa", app as Unit, "0000dead");
});

Then("the {word} channel still serves the new {string} unit", async function (this: PointerWorld, channel: string, app: string) {
  await this.visit(channel as Channel);
  expect(unitIdsInShell(this.lastBody)[app as Unit]).toBe(fresh.get(app));
});

Then("the {word} channel still serves build {string} for every unit", async function (this: PointerWorld, channel: string, name: string) {
  await this.visit(channel as Channel);
  const served = unitIdsInShell(this.lastBody);
  for (const unit of UNITS) {
    expect(`${unit}=${served[unit]}`).toBe(`${unit}=${this.unitIdOf(name, unit)}`);
  }
});

Then("the promotion is refused because that unit is not published", function (this: PointerWorld) {
  expect(this.lastRun?.code).not.toBe(0);
  expect(this.lastRun?.stderr).toContain("not published");
});
