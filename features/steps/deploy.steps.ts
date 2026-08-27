// Steps about what the operator does. Every one of these runs @live against
// the real store: a local stand-in for publish and promote could pass while
// the real path was broken, which is the failure this suite exists to catch.

import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "bun:test";
import {
  CACHE_IMMUTABLE,
  configFromEnv,
  contentTypeFor,
  publicUrl,
  putObject,
} from "../../scripts/store.ts";
import { type Channel, PointerWorld, run } from "../support/world.ts";
import { UNITS, type Unit } from "../../scripts/contract.ts";

type UnitManifest = {
  assetBase: string;
  js: string;
  files: string[];
};

/** One published unit's manifest, straight from the store. */
async function unitManifest(unit: Unit, id: string): Promise<UnitManifest> {
  const cfg = configFromEnv();
  const url = publicUrl(cfg, `units/${unit}/${id}/unit.json`);
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`GET ${url} responded ${res.status}`);
  return (await res.json()) as UnitManifest;
}

/** The shell unit's entry script for a named scenario build. */
async function entryScriptOf(world: PointerWorld, name: string): Promise<string> {
  const m = await unitManifest("shell", world.unitIdOf(name, "shell"));
  return `${m.assetBase}${m.js}`;
}

Given("build {string} is published", async function (this: PointerWorld, name: string) {
  await this.publish(name);
});

Given("build {string} is published and promoted to the {word} channel", async function (this: PointerWorld, name: string, channel: string) {
  await this.pointAt(channel as Channel, name);
});

// Produces exactly the state an interrupted publish leaves behind: files in
// the unit's directory, no unit.json beside them. Every unit, because promote
// reads all five and any one of them being incomplete must stop it.
Given("a publish of build {string} is interrupted after some files are uploaded", async function (this: PointerWorld, name: string) {
  const cfg = configFromEnv();
  const id = `interrupted-${Bun.hash(`${name}-${process.pid}`).toString(16)}`;
  for (const unit of UNITS) {
    await putObject(
      cfg,
      `units/${unit}/${id}/${unit}-partial.js`,
      new TextEncoder().encode("// half an upload\n"),
      { contentType: contentTypeFor("x.js"), cacheControl: CACHE_IMMUTABLE },
    );
  }
  this.setId(name, id);
});

When("the operator promotes build {string} to the {word} channel", async function (this: PointerWorld, name: string, channel: string) {
  this.lastRun = await this.promote(channel as Channel, name);
});

When("the operator publishes build {string} again", async function (this: PointerWorld, name: string) {
  const built = await run(["bun", "run", "build"], { BUILD_MARKER: name });
  expect(built.code).toBe(0);
  // The same marker yields the same bytes, so every unit hashes to the id it
  // already has in the store.
  this.lastRun = await run(["bun", "run", "--silent", "scripts/publish.ts"]);
});

When("a visitor fetches a file of build {string}", async function (this: PointerWorld, name: string) {
  const res = await fetch(await entryScriptOf(this, name));
  this.lastResponse = res;
  this.lastBody = await res.text();
});

When("a page loaded from build {string} requests one of its files", async function (this: PointerWorld, name: string) {
  const res = await fetch(await entryScriptOf(this, name));
  this.lastResponse = res;
  this.lastBody = await res.text();
});

When("a browser on the {word} origin requests the script of build {string}", async function (this: PointerWorld, channel: string, name: string) {
  // The Origin header is what turns this into a CORS request. A plain GET
  // succeeds either way, which is why curl could not see the fault.
  const res = await fetch(await entryScriptOf(this, name), {
    headers: { origin: this.originFor(channel as Channel) },
  });
  this.lastResponse = res;
  this.lastBody = await res.text();
});

Then("the store permits that origin to use it", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(200);
  const allowed = this.lastResponse?.headers.get("access-control-allow-origin");
  expect(allowed === "*" || allowed === this.originFor("qa")).toBe(true);
});

Then("the promotion is refused because build {string} is not published", function (this: PointerWorld, name: string) {
  expect(this.lastRun?.code).not.toBe(0);
  expect(this.lastRun?.stderr).toContain("not published");
  expect(this.lastRun?.stderr).toContain(this.idOf(name));
});

Then("the promotion is refused because build {string} has no manifest", function (this: PointerWorld, name: string) {
  expect(this.lastRun?.code).not.toBe(0);
  expect(this.lastRun?.stderr).toContain("not published");
  expect(this.lastRun?.stderr).toContain(this.idOf(name));
});

Then("no unit is uploaded, because none of them changed", function (this: PointerWorld) {
  // A unit id is a hash of that unit's own output, so an id already in the
  // store names bytes that are already there. Refusing would be wrong: the
  // common case is publishing after changing one app, where the other four
  // are legitimately unchanged and must be skipped rather than rejected.
  expect(this.lastRun?.code).toBe(0);
  expect(this.lastRun?.stderr).not.toContain("uploaded");
  for (const unit of UNITS) {
    expect(this.lastRun?.stderr).toContain(`${unit.padEnd(7)} `);
  }
  expect((this.lastRun?.stderr.match(/unchanged/g) ?? []).length).toBe(UNITS.length);
});

Then("the file is marked as safe to cache indefinitely", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(200);
  const header = this.lastResponse?.headers.get("cache-control") ?? "";
  expect(header).toContain("immutable");
  expect(header).toContain("max-age=31536000");
});

Then("every file that build names can be fetched", async function (this: PointerWorld) {
  // Every file of every unit, not only the shell's. A composition whose alpha
  // uploaded and whose delta did not still renders three panels and an error.
  const urls: string[] = [];
  for (const unit of UNITS) {
    const m = await unitManifest(unit, this.unitIdOf("alpha", unit));
    urls.push(...m.files.map((f) => `${m.assetBase}${f}`));
  }
  expect(urls.length).toBeGreaterThan(0);

  const statuses = await Promise.all(
    urls.map(async (u) => `${u.split("/").pop()} ${(await fetch(u)).status}`),
  );
  expect(statuses.filter((s) => !s.endsWith(" 200"))).toEqual([]);
});

Then("the file is served", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(200);
  expect(this.lastBody.length).toBeGreaterThan(0);
});

Then("the machines serving the {word} origin are the instances that were already running", async function (this: PointerWorld, channel: string) {
  expect(this.machinesBefore).toBeTruthy();
  // Confirm the origin really is served by these machines before comparing
  // them, or the assertion is about an unrelated app.
  await this.visit(channel as Channel);
  expect(this.lastResponse?.status).toBe(200);

  const after = await this.machineFingerprint();
  // Machine ids AND their updated_at timestamps. A rollout would change both;
  // a restart would change the timestamp alone. Neither may happen.
  expect(after).toBe(this.machinesBefore!);
});
