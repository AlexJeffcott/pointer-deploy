// Steps about choosing which build the page runs.
//
// All @test-channel: the switcher is off unless a channel is named in
// VERSION_SWITCHER_CHANNELS, and the harness names its own two and never a real
// one. The store, the units, the bundles and the history are real; only the
// process the HTML comes from is local.

import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import {
  type Channel,
  PROPAGATION_WINDOW_MS,
  PointerWorld,
  unitIdsInShell,
  versionsInShell,
} from "../support/world.ts";
import { UNITS, type Unit } from "../../scripts/contract.ts";

/** The id the incompatible-unit step published, shared with unit.steps.ts. */
const INCOMPATIBLE = () => `incompat-${Bun.hash(`${process.pid}`).toString(16)}`;

const optionsOf = (world: PointerWorld, unit: string) =>
  versionsInShell(world.lastBody)[unit] ?? [];

Given("that unit is recorded in the {word} channel's history", async function (this: PointerWorld, channel: string) {
  // No member reading at all, which is what a unit published before §9 has and
  // the only state the CONTRACT fallback still decides. Inheriting the served
  // unit's reading would let the member gate allow it, and this scenario is not
  // about that rule.
  await this.recordInHistory(channel as Channel, "alpha", {
    unitId: INCOMPATIBLE(),
    contracts: ["0000000"],
    surface: null,
  });
});

// §11. A shell recorded as reading a field of the server's JSON blocks that
// this server does not write. Written into the history directly, like the
// incompatible unit above: building one would mean shipping a shell nobody
// wants, for one scenario.
const UNFEEDABLE = () => `unfeedable-${Bun.hash(`${process.pid}`).toString(16)}`;

Given("a shell recorded in the {word} channel's history that reads a block field this server does not write", async function (this: PointerWorld, channel: string) {
  // Contracts and members copied from the shell this channel serves, so the
  // ONLY thing wrong with it is the block field. A fixture that also shared no
  // contract would be refused by the older rule and prove nothing about this
  // one - measured on 2026-08-29, by a mutation that survived it.
  await this.recordInHistory(channel as Channel, "shell", {
    unitId: UNFEEDABLE(),
    surface: { blocks: { "VersionOption.teleported": "0000000" } },
  });
});

Then("the {word} origin offers that shell and will not let it be chosen", async function (this: PointerWorld, channel: string) {
  const want = UNFEEDABLE();
  const started = Date.now();
  let option: ReturnType<typeof optionsOf>[number] | undefined;
  while (Date.now() - started < PROPAGATION_WINDOW_MS + 15_000) {
    await this.visit(channel as Channel);
    option = optionsOf(this, "shell").find((o) => o.unitId === want);
    if (option) break;
    await Bun.sleep(500);
  }
  const offered = optionsOf(this, "shell").map((o) => o.unitId).join(", ") || "nothing";
  expect(option ? "offered" : `${want} is absent after ${Date.now() - started} ms; offered ${offered}`)
    .toBe("offered");
  expect(`disabled=${option?.disabled}`).toBe("disabled=true");
});

When("a visitor asks the {word} origin for that shell", async function (this: PointerWorld, channel: string) {
  const want = UNFEEDABLE();
  // Waits for the origin to KNOW the id before asking for it. The history was
  // written directly and the server holds its last good copy until its own TTL
  // is up, so asking straight away is refused with "not one this channel has
  // served" - a different reading, and one that made this scenario pass with
  // the block gate disabled. Measured on 2026-08-29.
  const started = Date.now();
  while (Date.now() - started < PROPAGATION_WINDOW_MS + 15_000) {
    await this.visit(channel as Channel);
    if (optionsOf(this, "shell").some((o) => o.unitId === want)) break;
    await Bun.sleep(500);
  }
  await this.visit(channel as Channel, `/?shell=${want}`);
});

Then("the request is refused because this server cannot feed that shell", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(400);
  expect(this.lastBody).toContain("does not write");
  // Not the "never served" refusal, which is what an id the origin has not
  // caught up with produces and which would pass this for the wrong reason.
  expect(this.lastBody).not.toContain("not one this channel has served");
});

When("a visitor asks the {word} origin for build {string}'s {string} unit", async function (this: PointerWorld, channel: string, name: string, app: string) {
  const id = this.unitIdOf(name, app as Unit);
  await this.visit(channel as Channel, `/?${app}=${id}`);
});

When("a visitor asks the {word} origin for an {string} unit it has never served", async function (this: PointerWorld, channel: string, app: string) {
  await this.visit(channel as Channel, `/?${app}=0000dead`);
});

When("a visitor picks build {string}'s {string} unit from the switcher", async function (this: PointerWorld, name: string, app: string) {
  const page = this.browserPage;
  const id = this.unitIdOf(name, app as Unit);
  await page.goto(`${this.originFor("qa")}/`);
  // The control is the shell's, so it exists only once the shell has run.
  await page.waitForSelector(`[data-version-select="${app}"]`, { timeout: 20_000 });
  await page.selectOption(`[data-version-select="${app}"]`, id);
  // Choosing reloads: the composition decides the import map, the policy and
  // every digest on the page, so a new composition is a new document.
  await page.waitForURL((url) => url.searchParams.get(app) === id, { timeout: 20_000 });
  await page.waitForSelector(`[data-app="${app}"] section`, { timeout: 20_000 });
  this.lastBody = await page.content();
});

Then("the page offers a version switcher for every unit", function (this: PointerWorld) {
  const offered = versionsInShell(this.lastBody);
  // Every unit, not merely a block. A switcher that named the shell alone would
  // satisfy "there is one" and offer nothing an operator came to change.
  for (const unit of UNITS) {
    const options = offered[unit] ?? [];
    expect(options.length ? unit : `${unit} has no options; the page offers ${Object.keys(offered).join(", ") || "nothing"}`).toBe(unit);
  }
});

Then("the page offers both {string} units", function (this: PointerWorld, app: string) {
  const offered = optionsOf(this, app).map((o) => o.unitId);
  const shown = offered.join(", ") || "nothing";
  // Named ids, not a count. Two copies of one id would satisfy a length check
  // and prove nothing about a channel having served two builds.
  const older = this.unitIdOf("one", app as Unit);
  expect(offered.includes(older) ? "the older id" : `${older} is missing from ${shown}`).toBe(
    "the older id",
  );
  expect(offered.length >= 2 ? "two or more" : `only ${shown}`).toBe("two or more");
  expect(`${new Set(offered).size} distinct of ${offered.length}: ${shown}`).toBe(
    `${offered.length} distinct of ${offered.length}: ${shown}`,
  );
});

Then("the option the channel serves is the one the page is showing", function (this: PointerWorld) {
  for (const [unit, options] of Object.entries(versionsInShell(this.lastBody))) {
    const live = options.find((o) => o.live);
    const current = options.find((o) => o.current);
    expect(`${unit} live=${live?.unitId} current=${current?.unitId}`).toBe(
      `${unit} live=${live?.unitId} current=${live?.unitId}`,
    );
  }
});

Then("the page runs build {string}'s {string} unit", function (this: PointerWorld, name: string, app: string) {
  const want = this.unitIdOf(name, app as Unit);
  expect(`${app}=${unitIdsInShell(this.lastBody)[app as Unit]}`).toBe(`${app}=${want}`);
});

Then("the page still runs the shell the channel serves", async function (this: PointerWorld) {
  const chosen = unitIdsInShell(this.lastBody).shell;
  const served = (await this.compositionOf("qa")).shell;
  expect(`shell=${chosen}`).toBe(`shell=${served}`);
});

Then("the request is refused as a bad request", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(400);
  // Named, because an operator who asked for a build that is gone needs to be
  // told which reading it is: never served, or served and incompatible.
  expect(this.lastBody).toContain("not one this channel has served");
});

Then("the {word} origin offers that unit and will not let it be chosen", async function (this: PointerWorld, channel: string) {
  const want = INCOMPATIBLE();
  // Polled, because this crosses the same store-to-origin boundary every other
  // propagation step here crosses: the history was written directly, and the
  // server holds its last good copy until its own TTL is up.
  const started = Date.now();
  let option: ReturnType<typeof optionsOf>[number] | undefined;
  while (Date.now() - started < PROPAGATION_WINDOW_MS + 15_000) {
    await this.visit(channel as Channel);
    option = optionsOf(this, "alpha").find((o) => o.unitId === want);
    if (option) break;
    await Bun.sleep(500);
  }
  const offered = optionsOf(this, "alpha").map((o) => o.unitId).join(", ") || "nothing";
  expect(option ? "offered" : `${want} is absent after ${Date.now() - started} ms; offered ${offered}`)
    .toBe("offered");
  // Disabled and not hidden. "This build exists and cannot run beside the
  // others" is the reading an operator came for.
  expect(`disabled=${option?.disabled}`).toBe("disabled=true");
});

Then("both sub-apps still render", async function (this: PointerWorld) {
  for (const app of ["alpha", "bravo"]) {
    await this.browserPage.waitForSelector(`[data-app="${app}"] section`, { timeout: 20_000 });
  }
});
