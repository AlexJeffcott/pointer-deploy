// §12. Steps about what the origin says it has handed out.
//
// The reading is fetched through the same `visit` a scenario's visitor uses, so
// it crosses the wire the same way - which live means a Host the address does
// not match, and therefore curl.

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
  // The channel the store really holds. A live scenario says "qa" and means
  // the suite's own test-qa, which is what the origin counted it under.
  const wantChannel = this.storeChannel(channel as Channel);
  const named = reading(this).compositions.filter((c) => c.channel === wantChannel);
  const row = named.find((c) => c.buildId === want.shell);

  // The whole list on a miss. "not named" alone leaves an operator - and the
  // next person reading this failure - with no idea what it did name.
  expect(
    `${wantChannel} ${want.shell}: ${row ? "named" : `not named, ${JSON.stringify(named.map((c) => c.buildId))} was`}`,
  ).toBe(`${wantChannel} ${want.shell}: named`);

  // The units, not merely the build. A row naming the right shell and the
  // wrong sub-apps is the reading a rollback of one unit exists to show.
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

// The two limits that decide whether the number in front of an operator means
// what they will read it as meaning.
Then("it says it cannot see a tab that keeps the composition it was opened on", function (this: PointerWorld) {
  const said = reading(this).blindTo.join("\n");
  expect(said).toContain("never asks again");
});

Then("it says the count starts again when the machine is replaced", function (this: PointerWorld) {
  const said = reading(this).blindTo.join("\n");
  expect(said).toContain("in memory");
});

// §12's one reading no stub can produce. The stub store holds no history, so
// the version switcher is off locally and nothing there can make an override
// happen at all. This runs against the real store, with a real history.
Then("that composition is counted as an operator's override, and nothing else is", function (this: PointerWorld) {
  const rows = reading(this).compositions;
  const asked = this.unitIdOf("one", "alpha");
  const overridden = rows.filter((c) => c.overrides > 0);

  // The whole list either way. "expected 1, got 2" leaves whoever reads the
  // failure with no idea which compositions were counted as an operator's.
  expect(`overridden: ${JSON.stringify(overridden.map((c) => `alpha=${c.units.alpha} x${c.overrides}`))}`)
    .toBe(`overridden: ${JSON.stringify([`alpha=${asked} x1`])}`);

  // The control, and the half that makes this a split rather than a label. The
  // channel's own composition reached this origin too - the promotes above
  // waited on it - and not one of those responses is counted as an operator's.
  //
  // Its response COUNT is not asserted: the background waits for a promote by
  // polling this origin, and the composition it was still serving while it
  // waited is the same one the override then asked for. Three responses on that
  // row, one of them an override, is the reading working.
  const visitors = rows.filter((c) => c.overrides === 0 && c.units.alpha !== asked);
  expect(`the channel's own composition was counted, unoverridden: ${visitors.length > 0}`).toBe(
    "the channel's own composition was counted, unoverridden: true",
  );
});
