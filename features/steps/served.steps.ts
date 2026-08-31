import { Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { type Channel, PointerWorld } from "../support/world.ts";

const reading = (world: PointerWorld) => {
  const r = world.lastServed;
  if (!r) throw new Error("no step has asked the origin what it has served yet");
  return r;
};

When("the {word} origin is asked what it has served", async function (this: PointerWorld, channel: string) {
  await this.readServed(channel as Channel);
});

Then("it names the composition of build {string} on the {word} channel", function (this: PointerWorld, name: string, channel: string) {
  const want = this.idsOf(name);
  const wantChannel = this.storeChannel(channel as Channel);
  const named = reading(this).compositions.filter((c) => c.channel === wantChannel);
  const row = named.find((c) => c.buildId === want.shell);

  expect(
    `${wantChannel} ${want.shell}: ${row ? "named" : `not named, ${JSON.stringify(named.map((c) => c.buildId))} was`}`,
  ).toBe(`${wantChannel} ${want.shell}: named`);

  expect(row!.units).toEqual(want);
  this.lastNamed = row!;
});

Then("it names no composition at all", function (this: PointerWorld) {
  expect(reading(this).compositions).toEqual([]);
});

Then("it has handed that composition out {int} time(s)", function (this: PointerWorld, times: number) {
  const row = this.lastNamed;
  if (!row) throw new Error("no step has named a composition yet");
  expect(row.responses).toBe(times);
});

Then("none of those responses came from the version switcher", function (this: PointerWorld) {
  const row = this.lastNamed;
  if (!row) throw new Error("no step has named a composition yet");
  expect(row.overrides).toBe(0);
});

Then("it says it cannot see a tab that keeps the composition it was opened on", function (this: PointerWorld) {
  const said = reading(this).blindTo.join("\n");
  expect(said).toContain("never asks again");
});

Then("it says the count starts again when the machine is replaced", function (this: PointerWorld) {
  const said = reading(this).blindTo.join("\n");
  expect(said).toContain("in memory");
});

Then("that composition is counted as an operator's override, and nothing else is", function (this: PointerWorld) {
  const rows = reading(this).compositions;
  const asked = this.unitIdOf("one", "alpha");
  const overridden = rows.filter((c) => c.overrides > 0);

  expect(`overridden: ${JSON.stringify(overridden.map((c) => `alpha=${c.units.alpha} x${c.overrides}`))}`)
    .toBe(`overridden: ${JSON.stringify([`alpha=${asked} x1`])}`);

  const visitors = rows.filter((c) => c.overrides === 0 && c.units.alpha !== asked);
  expect(`the channel's own composition was counted, unoverridden: ${visitors.length > 0}`).toBe(
    "the channel's own composition was counted, unoverridden: true",
  );
});
