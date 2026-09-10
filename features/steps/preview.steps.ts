import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { type Channel, PointerWorld, unitIdsInShell } from "../support/world.ts";
import { catalogueDoc } from "../support/stub-store.ts";
import type { Unit } from "../../scripts/contract.ts";

/**
 * The id every unit carries in the stub catalogue.
 *
 * One id for every unit name, which is what `manifestDoc` already does. It has
 * to differ from anything the channel points at or has served: a catalogue
 * entry only decides anything while it is an id the channel has NEVER served.
 */
const PUBLISHED = "prev0000";

/**
 * Seeds the catalogue and restarts, because the catalogue is read at boot and
 * afterwards refreshed behind a `peek` that returns the old value while the new
 * one is fetched. A restart is the shortest way to a server that has certainly
 * read it, and the refresh path has its own scenario in `store-outage`.
 */
async function publishNowhere(world: PointerWorld, marker: string): Promise<void> {
  world.stub!.pointCatalogue(catalogueDoc(PUBLISHED, marker));
  await world.restartServer();
}

Given("a build marked {string} is published and promoted nowhere", async function (this: PointerWorld, marker: string) {
  await publishNowhere(this, marker);
});

Given("an unmarked build is published and promoted nowhere", async function (this: PointerWorld) {
  await publishNowhere(this, "");
});

When("a visitor asks the {word} origin for that build's {string} unit", async function (this: PointerWorld, channel: string, app: string) {
  await this.visit(channel as Channel, `/?${app}=${PUBLISHED}`);
});

Then("the page runs that build's {string} unit", function (this: PointerWorld, app: string) {
  expect(`status ${this.lastResponse?.status}`).toBe("status 200");
  expect(`${app}=${unitIdsInShell(this.lastBody)[app as Unit]}`).toBe(`${app}=${PUBLISHED}`);
});

Then("the {word} channel still points where it did", async function (this: PointerWorld, channel: string) {
  const served = await this.compositionOf(channel as Channel);
  expect(`alpha=${served.alpha}`).not.toBe(`alpha=${PUBLISHED}`);
});
