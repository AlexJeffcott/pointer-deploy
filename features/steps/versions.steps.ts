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
import { configFromEnv, getObjectText } from "../../scripts/store.ts";

type StoredHistory = {
  units: Record<string, Array<{ unit: { unitId: string }; supersededAt?: string }>>;
};

const storedHistory = async (world: PointerWorld): Promise<StoredHistory> => {
  const key = world.historyKey("qa");
  const text = await getObjectText(configFromEnv(), key);
  if (text === null) throw new Error(`${key} does not exist`);
  return JSON.parse(text) as StoredHistory;
};

Then("the {string} unit it serves says when it started being served", function (this: PointerWorld, unit: string) {
  const current = optionsOf(this, unit).find((o) => o.current);
  expect(current?.since ?? `the ${unit} unit ${current?.unitId} carries no start`).toMatch(
    /^\d{4}-\d{2}-\d{2}T/,
  );
});

// Named by id from the scenario's own setup rather than by position, so this
// reads the property - the served unit started when the one before it stopped -
// and not the expression the server computes it with.
Then("that is the moment build {string}'s {string} unit stopped being served", async function (this: PointerWorld, build: string, unit: string) {
  const current = optionsOf(this, unit).find((o) => o.current);
  const older = this.idsOf(build)[unit as Unit];
  const doc = await storedHistory(this);
  const stopped = (doc.units[unit] ?? []).find((e) => e.unit.unitId === older)?.supersededAt;
  expect(stopped ?? `the ${unit} unit ${older} carries no stamp`).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  expect(current?.since).toBe(stopped);
});

Then("the switcher shows how long each unit it serves has been served", async function (this: PointerWorld) {
  const shown = await this.browserPage.$$eval("[data-serving-since]", (els) =>
    els.map((e) => `${e.getAttribute("data-serving-since")} -> ${(e.textContent ?? "").trim()}`),
  );
  expect(shown.length ? "shown" : "the row shows no duration at all").toBe("shown");
  for (const line of shown) {
    expect(line).toMatch(/^\d{4}-\d{2}-\d{2}T.+ -> (just now|\d+ (min|h|d))$/);
  }
});

const INCOMPATIBLE = () => `incompat-${Bun.hash(`${process.pid}`).toString(16)}`;

const optionsOf = (world: PointerWorld, unit: string) =>
  versionsInShell(world.lastBody)[unit] ?? [];

Given("that unit is recorded in the {word} channel's history", async function (this: PointerWorld, channel: string) {
  await this.recordInHistory(channel as Channel, "alpha", {
    unitId: INCOMPATIBLE(),
    contracts: ["0000000"],
    surface: null,
  });
});

const UNFEEDABLE = () => `unfeedable-${Bun.hash(`${process.pid}`).toString(16)}`;

Given("a shell recorded in the {word} channel's history that reads a block field this server does not write", async function (this: PointerWorld, channel: string) {
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
  expect(this.lastBody).not.toContain("is not one this channel can serve");
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
  await page.waitForSelector(`[data-version-select="${app}"]`, { timeout: 20_000 });
  await page.selectOption(`[data-version-select="${app}"]`, id);
  await page.waitForURL((url) => url.searchParams.get(app) === id, { timeout: 20_000 });
  await page.waitForSelector(`[data-app="${app}"] section`, { timeout: 20_000 });
  this.lastBody = await page.content();
});

Then("the page offers a version switcher for every unit", function (this: PointerWorld) {
  const offered = versionsInShell(this.lastBody);
  for (const unit of UNITS) {
    const options = offered[unit] ?? [];
    expect(options.length ? unit : `${unit} has no options; the page offers ${Object.keys(offered).join(", ") || "nothing"}`).toBe(unit);
  }
});

Then("the page offers both {string} units", function (this: PointerWorld, app: string) {
  const offered = optionsOf(this, app).map((o) => o.unitId);
  const shown = offered.join(", ") || "nothing";
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
  expect(this.lastBody).toContain("is not one this channel can serve");
});

Then("the {word} origin offers that unit and will not let it be chosen", async function (this: PointerWorld, channel: string) {
  const want = INCOMPATIBLE();
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
  expect(`disabled=${option?.disabled}`).toBe("disabled=true");
});

Then("both sub-apps still render", async function (this: PointerWorld) {
  for (const app of ["alpha", "bravo"]) {
    await this.browserPage.waitForSelector(`[data-app="${app}"] section`, { timeout: 20_000 });
  }
});
