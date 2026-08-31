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

const connectSrc = (world: PointerWorld): string => {
  const header = world.lastResponse?.headers.get("content-security-policy");
  if (!header) throw new Error("the response carries no content policy at all");
  return (
    header
      .split(";")
      .map((d) => d.trim())
      .find((d) => d.startsWith("connect-src "))
      ?.slice("connect-src ".length) ?? ""
  );
};

Then("the shell's policy permits that service and no other host", function (this: PointerWorld) {
  expect(connectSrc(this)).toBe(new URL(this.serviceBase).origin);
});

Then("the shell's policy permits nothing to be fetched", function (this: PointerWorld) {
  expect(connectSrc(this)).toBe("'none'");
});

// The check the unit tests could not make. They read the policy the server
// writes; these read what a browser does with it.
//
// The fetch is made from the page rather than waited for, because which shell
// the channel serves is not this scenario's subject: a shell published before
// the service client calls nothing, and the policy is the same either way.
const fetchFromPage = async (world: PointerWorld, url: string): Promise<string> =>
  world.browserPage.evaluate(async (target: string) => {
    try {
      const res = await fetch(target);
      return `allowed ${res.status}`;
    } catch (e) {
      return `refused: ${e instanceof Error ? e.message : String(e)}`;
    }
  }, url);

const serviceOnPage = async (world: PointerWorld): Promise<string> => {
  const base = await world.browserPage.evaluate(() => {
    const el = document.getElementById("__BUILD__");
    if (!el?.textContent) return "";
    return (JSON.parse(el.textContent) as { apiBase?: string }).apiBase ?? "";
  });
  if (!base) throw new Error("the page names no service to reach");
  return base;
};

Then("the page is allowed to fetch from that service", async function (this: PointerWorld) {
  const base = await serviceOnPage(this);
  expect(await fetchFromPage(this, `${base}/v1/user`)).toBe("allowed 200");
});

Then("it is not allowed to fetch from the store", async function (this: PointerWorld) {
  // Read off the page rather than configured: the store to refuse is the one
  // the page loads its scripts from.
  const store = await this.browserPage.evaluate(() => {
    const src = document.querySelector('script[type="module"]')?.getAttribute("src") ?? "";
    return src ? new URL(src).origin : "";
  });
  if (!store) throw new Error("the page names no store to reach");
  expect(await fetchFromPage(this, `${store}/units/catalogue.json`)).toContain("refused");
});
