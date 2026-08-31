import { expect } from "@playwright/test";
import { Given, Then } from "../support/bdd.ts";
import type { PointerWorld } from "../support/world.ts";

const buildBlock = (world: PointerWorld): Record<string, unknown> => {
  const m = /id="__BUILD__">(.*?)<\/script>/s.exec(world.lastBody);
  expect(m ? "present" : `no __BUILD__ block in:\n${world.lastBody.slice(0, 400)}`).toBe("present");
  return JSON.parse(m![1]!) as Record<string, unknown>;
};

Given("a service that answers {string}", async function (this: PointerWorld, serves: string) {
  await this.startServiceAndServer(serves);
});

Then("the shell names that service as the one to read", function (this: PointerWorld) {
  expect(buildBlock(this).apiBase).toBe(this.serviceBase);
});

Then("the shell names no service", function (this: PointerWorld) {
  expect(Object.keys(buildBlock(this))).not.toContain("apiBase");
});

Then("the origin reports the API gate as {string}", function (this: PointerWorld, state: string) {
  expect(this.lastResponse?.headers.get("x-shell-api")).toBe(state);
});
