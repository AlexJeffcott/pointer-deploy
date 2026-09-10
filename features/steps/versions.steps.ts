import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import {
  type Channel,
  PROPAGATION_WINDOW_MS,
  PointerWorld,
  unitIdsInShell,
} from "../support/world.ts";
import { type Unit } from "../../scripts/contract.ts";

const UNFEEDABLE = () => `unfeedable-${Bun.hash(`${process.pid}`).toString(16)}`;

/**
 * Asks for an id that was written straight into the channel's history, and
 * keeps asking until the server has read that write.
 *
 * The history reaches the server through its own cache, so the first attempt
 * meets a server that has never heard of the id and refuses it as one this
 * channel cannot serve. That refusal is a different one from the refusal each
 * scenario is about, so the loop stops on any refusal that is NOT it.
 */
async function askUntilJudged(
  world: PointerWorld,
  channel: Channel,
  query: string,
): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < PROPAGATION_WINDOW_MS + 15_000) {
    await world.visit(channel, query);
    if (!world.lastBody.includes("is not one this channel can serve")) return;
    await Bun.sleep(500);
  }
}

Given("a shell recorded in the {word} channel's history that reads a block field this server does not write", async function (this: PointerWorld, channel: string) {
  await this.recordInHistory(channel as Channel, "shell", {
    unitId: UNFEEDABLE(),
    surface: { blocks: { "BuildInfo.teleported": "0000000" } },
  });
});

When("a visitor asks the {word} origin for that shell", async function (this: PointerWorld, channel: string) {
  await askUntilJudged(this, channel as Channel, `/?shell=${UNFEEDABLE()}`);
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

When("a visitor asks the {word} origin for a {string} unit it has never served", async function (this: PointerWorld, channel: string, app: string) {
  await this.visit(channel as Channel, `/?${app}=0000dead`);
});

Then("the page runs build {string}'s {string} unit", function (this: PointerWorld, name: string, app: string) {
  const want = this.unitIdOf(name, app as Unit);
  expect(`${app}=${unitIdsInShell(this.lastBody)[app as Unit]}`).toBe(`${app}=${want}`);
});

Then("the request is refused as a bad request", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(400);
  expect(this.lastBody).toContain("is not one this channel can serve");
});
