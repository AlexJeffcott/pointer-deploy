// Steps about what a visitor observes. All mechanics live here; the scenarios
// stay declarative.

import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "bun:test";
import {
  assetUrlsInShell,
  buildIdInShell,
  type Channel,
  PointerWorld,
  PROPAGATION_WINDOW_MS,
  run,
} from "../support/world.ts";

const LOCAL_TTL_MS = 300;
const pastTtl = () => Bun.sleep(LOCAL_TTL_MS + 200);

Given("the {word} channel points at build {string}", async function (this: PointerWorld, channel: string, name: string) {
  await this.pointAt(channel as Channel, name);
});

Given("a visitor has already loaded the {word} origin", async function (this: PointerWorld, channel: string) {
  const res = await this.visit(channel as Channel);
  expect(res.status).toBe(200);
});

Given("the server's copy of the manifest is older than its refresh interval", async function () {
  await pastTtl();
});

Given("the store has become slow to answer", function (this: PointerWorld) {
  this.stub!.setDelay(1_500);
});

Given("a server that has not yet read any manifest", function (this: PointerWorld) {
  // The Before hook started a fresh server for this scenario and nothing has
  // visited it yet, so its cache is genuinely cold. Asserting that here keeps
  // the precondition honest rather than assumed.
  expect(this.lastResponse).toBeNull();
});

Given("the store is unreachable", async function (this: PointerWorld) {
  await this.stub!.goDown();
});

Given("no machine is running", async function (this: PointerWorld) {
  const list = await run(["fly", "machine", "list", "--json"]);
  const machines = JSON.parse(list.stdout) as Array<{ id: string }>;
  for (const m of machines) await run(["fly", "machine", "stop", m.id]);
});

When("the store becomes unreachable", async function (this: PointerWorld) {
  await this.stub!.goDown();
});

When("a visitor loads the {word} origin", async function (this: PointerWorld, channel: string) {
  await this.visit(channel as Channel);
});

When("a visitor requests an application asset path from the {word} origin", async function (this: PointerWorld, channel: string) {
  await this.visit(channel as Channel, "/assets/index-abc123.js");
});

When("a visitor loads an origin that is not configured", async function (this: PointerWorld) {
  await this.visitUnknownOrigin();
});

const UNTRUSTWORTHY: Record<string, string> = {
  "a truncated document": '{"schema": 1, "buildId": ',
  // Parses cleanly. Only validation stands between this and a shell with no
  // script tag.
  "valid JSON that is not a manifest": JSON.stringify({ schema: 1, buildId: "beta" }),
};

When("the {word} channel's manifest is replaced with {string}", function (this: PointerWorld, channel: string, kind: string) {
  const body = UNTRUSTWORTHY[kind];
  if (body === undefined) throw new Error(`no document defined for ${JSON.stringify(kind)}`);
  this.stub!.pointRaw(channel, body);
});

When("the platform checks the server's health", async function (this: PointerWorld) {
  const res = await fetch(`${this.originFor("qa")}/healthz`);
  this.lastResponse = res;
  this.lastBody = await res.text();
});

Then("the shell identifies build {string}", function (this: PointerWorld, name: string) {
  expect(this.lastResponse?.status).toBe(200);
  expect(buildIdInShell(this.lastBody)).toBe(this.idOf(name));
});

Then("the shell loads the script and the stylesheet of build {string}", function (this: PointerWorld, name: string) {
  const { js, css } = assetUrlsInShell(this.lastBody);
  const id = this.idOf(name);
  expect(js).toBeTruthy();
  expect(css).toBeTruthy();
  // Both must come from the shell unit's own directory in the store, never
  // from this server: the claim is that the image holds no application files.
  expect(js).toContain(`/units/shell/${id}/`);
  expect(css).toContain(`/units/shell/${id}/`);
  expect(new URL(js!).origin).not.toBe(this.originFor("qa"));
});

Then("no cache between the server and the visitor is permitted to store the shell", function (this: PointerWorld) {
  const header = this.lastResponse?.headers.get("cache-control") ?? "";
  expect(header).toContain("no-store");
});

Then("the request is refused as not found", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(404);
});

Then("the request is refused as temporarily unavailable", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(503);
});

Then("no shell is returned", function (this: PointerWorld) {
  expect(this.lastBody).not.toContain("<!doctype html>");
  expect(buildIdInShell(this.lastBody)).toBeNull();
});

Then("no build is identified in the response", function (this: PointerWorld) {
  expect(buildIdInShell(this.lastBody)).toBeNull();
});

Then("the server reports itself healthy", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(200);
  expect(this.lastBody.trim()).toBe("ok");
});

/** The two headers the server puts on every shell it renders. */
const manifestAge = (world: PointerWorld): string =>
  world.lastResponse?.headers.get("x-manifest-age") ?? "absent";
const lastRefresh = (world: PointerWorld): string =>
  world.lastResponse?.headers.get("x-manifest-refresh") ?? "absent";

Then("the shell reports the age of the manifest it was rendered from", function (this: PointerWorld) {
  const age = manifestAge(this);
  // A number, not merely a header. "never" is the honest answer for a manifest
  // nothing has fetched, and a shell rendered from one cannot exist.
  expect(`${age} is a number: ${/^-?\d+$/.test(age)}`).toBe(`${age} is a number: true`);
});

Then("the shell reports that its last refresh worked", function (this: PointerWorld) {
  expect(lastRefresh(this)).toBe("ok");
});

Then(
  "the shell reports the manifest it was rendered from as older than the refresh interval",
  function (this: PointerWorld) {
    const age = Number(manifestAge(this));
    // The server's TTL for a @local run. An age below it would mean the store
    // answered and this scenario proved nothing about a refresh that failed.
    expect(`${age} ms >= ${LOCAL_TTL_MS} ms: ${age >= LOCAL_TTL_MS}`).toBe(
      `${age} ms >= ${LOCAL_TTL_MS} ms: true`,
    );
  },
);

Then("the shell names what its last refresh failed with", function (this: PointerWorld) {
  const said = lastRefresh(this);
  // Whatever the fetch threw. Pinning the sentence would pin Bun's wording for
  // a refused connection, which is not this project's behaviour to fix.
  expect(`${JSON.stringify(said)} is an error: ${said !== "ok" && said !== "absent" && said.length > 0}`).toBe(
    `${JSON.stringify(said)} is an error: true`,
  );
});

Then("the shell is returned without waiting for the store", function (this: PointerWorld) {
  expect(this.lastResponse?.status).toBe(200);
  // The store is answering in 1500 ms. Anything close to that means the
  // request waited for it instead of serving the copy it already had.
  expect(this.elapsedMs).toBeLessThan(400);
});

Then("visitors to the {word} origin continue to receive build {string}", async function (this: PointerWorld, channel: string, name: string) {
  const want = this.idOf(name);
  // Two observations across two refresh intervals. One could be the cached
  // copy the previous step already had; two means the server really is holding
  // this build rather than drifting to something else.
  for (let i = 0; i < 2; i++) {
    if (this.mode === "local") await pastTtl();
    else await Bun.sleep(PROPAGATION_WINDOW_MS / 2);
    await this.visit(channel as Channel);
    expect(this.lastResponse?.status).toBe(200);
    expect(buildIdInShell(this.lastBody)).toBe(want);
  }
});

Then("visitors to the {word} origin receive build {string} within the propagation window", async function (this: PointerWorld, channel: string, name: string) {
  const budget = this.mode === "local" ? LOCAL_TTL_MS * 6 : PROPAGATION_WINDOW_MS;
  const took = await this.awaitBuild(channel as Channel, name, budget);
  console.log(`    propagation: ${took} ms of a ${budget} ms budget`);
});

// The claim is that ONE server answers both channels. A certificate list would
// not show that; the machine count does.
Then("both origins are served by one machine", async function (this: PointerWorld) {
  const list = await run(["fly", "machine", "list", "--json"]);
  expect(list.code).toBe(0);
  const running = (JSON.parse(list.stdout) as Array<{ state: string }>).filter(
    (m) => m.state === "started",
  );
  expect(running).toHaveLength(1);
});
