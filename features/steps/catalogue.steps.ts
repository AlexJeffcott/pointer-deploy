import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import {
  type Channel,
  PROPAGATION_WINDOW_MS,
  PointerWorld,
  run,
  versionsInShell,
} from "../support/world.ts";
import { UNITS, type Unit } from "../../scripts/contract.ts";
import { CATALOGUE_KEY, readCatalogue } from "../../scripts/catalogue.ts";
import { configFromEnv, deleteObject, getObjectText } from "../../scripts/store.ts";
import { RUN, fresh, publishOneApp } from "./unit.steps.ts";

const idOfNew = (app: string): string => {
  const id = fresh.get(app);
  if (!id) throw new Error(`no fresh ${app} unit was published`);
  return id;
};

/**
 * A unit built with a marker no other run has used, so its id has never
 * existed: nothing has published it and no channel can have served it.
 *
 * The suite's usual fresh unit is not enough for either scenario here. Its
 * marker is fixed, so its id is the same every run - it is already in the
 * catalogue from an earlier run, which makes "the catalogue names it" pass
 * with the recording removed, and it is already in a channel's history, which
 * makes "the history does not name it" fail for a reason that is not the
 * catalogue. Both were seen doing exactly that on 2026-08-31.
 */
Given(
  "an unpublished {string} unit is published",
  async function (this: PointerWorld, app: string) {
    const ids = await publishOneApp(this, app, `unpromoted-${RUN}`);
    fresh.set(app, ids[app as Unit]);
  },
);

Then(
  "the catalogue names every unit of build {string}",
  async function (this: PointerWorld, name: string) {
    const catalogue = await readCatalogue(configFromEnv());
    const missing: string[] = [];
    for (const unit of UNITS) {
      const want = this.unitIdOf(name, unit);
      const listed = (catalogue?.units[unit] ?? []).some((e) => e.unit.unitId === want);
      if (!listed) missing.push(`${unit}=${want}`);
    }
    expect(missing.length ? `missing ${missing.join(", ")}` : "every unit").toBe("every unit");
  },
);

Then(
  "the {word} channel's history does not name that {string} unit",
  async function (this: PointerWorld, channel: string, app: string) {
    const want = idOfNew(app);
    const text = await getObjectText(configFromEnv(), this.historyKey(channel as Channel));
    // A channel records what it PROMOTED. A unit that was only published is the
    // discriminating case: a catalogue read off the histories would miss it,
    // and so would a switcher that had only the histories to offer from.
    expect(`${want} in the history: ${(text ?? "").includes(want)}`).toBe(
      `${want} in the history: false`,
    );
  },
);

Then("the catalogue names that {string} unit", async function (app: string) {
  const want = idOfNew(app);
  const catalogue = await readCatalogue(configFromEnv());
  const listed = (catalogue?.units[app] ?? []).map((e) => e.unit.unitId);
  expect(listed.includes(want) ? "listed" : `${want} is absent; the catalogue names ${listed.join(", ") || "nothing"}`).toBe("listed");
});

When("the catalogue is deleted from the store", async function () {
  await deleteObject(configFromEnv(), CATALOGUE_KEY);
  expect(await getObjectText(configFromEnv(), CATALOGUE_KEY)).toBeNull();
});

/** What the last rebuild printed. One scenario writes it and the next line reads it. */
let lastRebuild = "";

When("the catalogue is rebuilt", async function () {
  const rebuilt = await run(["bun", "run", "--silent", "scripts/units.ts", "--rebuild"]);
  if (rebuilt.code !== 0) throw new Error(`rebuild failed:\n${rebuilt.stderr}`);
  lastRebuild = rebuilt.stderr;
});

Then("it re-read none of the published units", function () {
  const line = lastRebuild;
  const read = /Read (\d+) of (\d+)/.exec(line);
  expect(read ? `read ${read[1]}` : `no reading in ${JSON.stringify(line)}`).toBe("read 0");
});

Then("the page offers that {string} unit", async function (this: PointerWorld, app: string) {
  const want = idOfNew(app);
  // The catalogue reaches the page through two caches, the same two a promote
  // goes through: the store's 5 s on the object and the server's manifest TTL.
  const started = Date.now();
  let offered: string[] = [];
  while (Date.now() - started < PROPAGATION_WINDOW_MS + 15_000) {
    await this.visit("qa");
    offered = (versionsInShell(this.lastBody)[app] ?? []).map((o) => o.unitId);
    if (offered.includes(want)) break;
    await Bun.sleep(500);
  }
  expect(
    offered.includes(want)
      ? "offered"
      : `${want} is absent after ${Date.now() - started} ms; offered ${offered.join(", ") || "nothing"}`,
  ).toBe("offered");
});
