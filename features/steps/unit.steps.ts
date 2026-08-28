// Steps about deploying and rolling back one unit at a time.
//
// All @live. These run the real publish.ts and promote.ts against the real
// store, because the claim is about what those two scripts do to it. A local
// stand-in could compose the right answer while the real merge was replacing
// the whole composition.

import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import {
  CACHE_IMMUTABLE,
  configFromEnv,
  contentTypeFor,
  putObject,
} from "../../scripts/store.ts";
import {
  type Channel,
  PointerWorld,
  PROPAGATION_WINDOW_MS,
  appScriptUrls,
  run,
  unitIdsInShell,
} from "../support/world.ts";
import { APPS, UNITS, type Unit } from "../../scripts/contract.ts";

const BUDGET_MS = PROPAGATION_WINDOW_MS + 15_000;

/** A scenario's freshly published unit, by app name. */
const fresh = new Map<string, string>();

/**
 * Unique per run.
 *
 * The scenario that asserts publish uploads one unit and skips four needs
 * genuinely new bytes, or the second run of the suite finds them already in
 * the store, reports "unchanged" for all five, and goes red. Steps that only
 * need a unit different from the baseline use a stable marker instead, so the
 * suite does not republish four bundles it already has.
 */
const RUN = Date.now().toString(36);

/** Build with one app's marker changed, publish, and report what was uploaded. */
async function publishOneApp(world: PointerWorld, app: string, marker: string) {
  const built = await run(["bun", "run", "build"], {
    // The baseline marker keeps the other four units byte-identical to the
    // ones already in the store, which is the whole point of the exercise.
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
  // Two units with the same id would make every scenario below pass by
  // accident, because the channel would already point at what is promoted.
  expect(id).not.toBe(baseline);
  fresh.set(app, id);
});

When("the operator promotes that {string} unit to the {word} channel", async function (this: PointerWorld, app: string, channel: string) {
  const id = fresh.get(app);
  if (!id) throw new Error(`no fresh ${app} unit was published`);
  this.lastRun = await this.promoteUnit(channel as Channel, app as Unit, id);
});

// Setup, not the act under test: it also waits for the promotion to reach a
// visitor, so a scenario that goes on to move a second unit is not racing the
// propagation of the first. Cucumber matches Given/When/Then interchangeably,
// so this must not share its text with the When above.
Given("that {string} unit is already deployed to the {word} channel", async function (this: PointerWorld, app: string, channel: string) {
  const id = fresh.get(app);
  if (!id) throw new Error(`no fresh ${app} unit was published`);
  this.lastRun = await this.promoteUnit(channel as Channel, app as Unit, id);
  expect(this.lastRun.code).toBe(0);
  await this.awaitUnit(channel as Channel, app as Unit, id, BUDGET_MS);
});

When("the operator promotes build {string}'s {string} unit to the {word} channel", async function (this: PointerWorld, name: string, app: string, channel: string) {
  this.lastRun = await this.promoteUnit(channel as Channel, app as Unit, this.unitIdOf(name, app as Unit));
});

When("the operator promotes an {string} unit that was never published", async function (this: PointerWorld, app: string) {
  this.lastRun = await this.promoteUnit("qa", app as Unit, "0000dead");
});

When("the operator builds and publishes with only {string} changed", async function (this: PointerWorld, app: string) {
  await publishOneApp(this, app, `${app}-${RUN}`);
});

Then("visitors to the {word} origin receive the new {string} unit within the propagation window", async function (this: PointerWorld, channel: string, app: string) {
  const id = fresh.get(app)!;
  this.elapsedMs = await this.awaitUnit(channel as Channel, app as Unit, id, BUDGET_MS);
});

Then("visitors to the {word} origin receive build {string}'s {string} unit within the propagation window", async function (this: PointerWorld, channel: string, name: string, app: string) {
  const id = this.unitIdOf(name, app as Unit);
  this.elapsedMs = await this.awaitUnit(channel as Channel, app as Unit, id, BUDGET_MS);
});

Then("the {word} channel still serves the new {string} unit", async function (this: PointerWorld, channel: string, app: string) {
  await this.visit(channel as Channel);
  expect(unitIdsInShell(this.lastBody)[app as Unit]).toBe(fresh.get(app));
});

Then("the {word} channel still serves build {string} for bravo, charlie, delta and the shell", async function (this: PointerWorld, channel: string, name: string) {
  await this.visit(channel as Channel);
  const served = unitIdsInShell(this.lastBody);
  for (const unit of UNITS.filter((u) => u !== "alpha")) {
    expect(`${unit}=${served[unit]}`).toBe(`${unit}=${this.unitIdOf(name, unit)}`);
  }
});

Then("the {word} channel still serves build {string} for every unit", async function (this: PointerWorld, channel: string, name: string) {
  await this.visit(channel as Channel);
  const served = unitIdsInShell(this.lastBody);
  for (const unit of UNITS) {
    expect(`${unit}=${served[unit]}`).toBe(`${unit}=${this.unitIdOf(name, unit)}`);
  }
});

Then("each sub-app on the {word} origin is fetched from its own unit's directory", async function (this: PointerWorld, channel: string) {
  await this.visit(channel as Channel);
  const served = unitIdsInShell(this.lastBody);
  const urls = appScriptUrls(this.lastBody);
  expect(Object.keys(urls).sort()).toEqual([...APPS].sort());
  for (const app of APPS) {
    // The id in the path, not merely somewhere in the document: this is what
    // separates a per-unit base from one shared base that happens to be right.
    expect(urls[app]).toContain(`/units/${app}/${served[app]}/`);
  }
});

Then("only the {word} unit is uploaded", function (this: PointerWorld, unit: string) {
  expect(this.lastRun?.code).toBe(0);
  const report = this.lastRun?.stderr ?? "";
  const uploaded = report
    .split("\n")
    .filter((l) => l.includes("uploaded"))
    .map((l) => l.trim().split(/\s+/)[0]);
  // The whole report, because the units this names are the finding. Without it
  // a failure says only which names it wanted and which it got, and the reason
  // is a line in an output nobody kept.
  expect(uploaded, `publish reported:\n${report}`).toEqual([unit]);
});

// A unit that claims a contract nothing else supports. Written straight into
// the store rather than built, because producing one from source would mean
// minting a contract the repository then has to carry for one scenario.
Given("a unit published against a contract the shell does not support", async function (this: PointerWorld) {
  const cfg = configFromEnv();
  const id = `incompat-${Bun.hash(`${process.pid}`).toString(16)}`;
  const prefix = `units/alpha/${id}`;
  const baseline = this.unitIdOf("one", "alpha");

  const source = await fetch(
    `https://${cfg.bucket}.${new URL(cfg.endpoint).host}/units/alpha/${baseline}/unit.json`,
  );
  const manifest = (await source.json()) as Record<string, unknown> & { files: string[] };

  await putObject(cfg, `${prefix}/${manifest.js as string}`, new TextEncoder().encode("export function mount(){return()=>{}}\n"), {
    contentType: contentTypeFor("x.js"),
    cacheControl: CACHE_IMMUTABLE,
  });
  await putObject(
    cfg,
    `${prefix}/unit.json`,
    new TextEncoder().encode(
      `${JSON.stringify(
        {
          ...manifest,
          id,
          assetBase: `https://${cfg.bucket}.${new URL(cfg.endpoint).host}/${prefix}/`,
          css: null,
          files: [manifest.js as string],
          contracts: ["0000000"],
        },
        null,
        2,
      )}\n`,
    ),
    { contentType: "application/json; charset=utf-8", cacheControl: CACHE_IMMUTABLE },
  );
  fresh.set("incompatible", id);
});

When("the operator promotes that unit to the {word} channel", async function (this: PointerWorld, channel: string) {
  this.lastRun = await this.promoteUnit(channel as Channel, "alpha", fresh.get("incompatible")!);
});

Then("the promotion is refused because no contract is shared", function (this: PointerWorld) {
  expect(this.lastRun?.code).not.toBe(0);
  expect(this.lastRun?.stderr).toContain("no contract is supported by every unit");
  expect(this.lastRun?.stderr).toContain("Nothing was changed");
});

Then("the promotion is refused because that unit is not published", function (this: PointerWorld) {
  expect(this.lastRun?.code).not.toBe(0);
  expect(this.lastRun?.stderr).toContain("not published");
});
