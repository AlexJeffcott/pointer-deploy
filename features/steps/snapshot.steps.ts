// The planner to the service and back, `PLAN.md` step 6.
//
// `/backup` is drawn by the FRAME and no unit is placed on it, so every step
// here drives the shell's own controls: a button that pushes, a box that takes
// an address and a button that pulls. Nothing reaches into the store and
// nothing calls the service directly - a step that pushed with `fetch` would
// prove the service and not the page.
//
// The address is kept on the world rather than read back off the page at every
// assertion, because a second browser is opened in the middle of the scenario
// that needs it: the page that was handed the address is not the page that
// types it in, which is the whole boundary these scenarios cross.

import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/bdd.ts";
import type { PointerWorld } from "../support/world.ts";
import { plannerDocument, titleList } from "../support/planner-document.ts";

const BACKUP = "[data-backup]";

/** A sha256 in hex, which is what an address is and the only shape one takes. */
const ADDRESS = /^[0-9a-f]{64}$/;

When("they push the planner", async function (this: PointerWorld) {
  const page = this.browserPage;
  await page.click(`${BACKUP} [data-push]`);
  // Waits for the ANSWER and not for the click. A push is a network call to a
  // service on its own deploy schedule, so a step that returned on the click
  // would hand the next step an address that had not arrived.
  await page.waitForSelector(`${BACKUP} [data-pushed], ${BACKUP} [data-push-refused]`, {
    timeout: 20_000,
  });
  const refused = await page.$(`${BACKUP} [data-push-refused]`);
  if (refused) {
    throw new Error(`the push did not land: ${(await refused.textContent())?.trim()}`);
  }
  this.pushedAddress =
    (await page.getAttribute(`${BACKUP} [data-pushed]`, "data-pushed")) ?? "";
});

Then("the backup view names an address", function (this: PointerWorld) {
  expect(this.pushedAddress).toMatch(ADDRESS);
});

const pullAddress = async (world: PointerWorld, address: string): Promise<void> => {
  const page = world.browserPage;
  await page.fill(`${BACKUP} [data-pull-address]`, address);
  await page.click(`${BACKUP} [data-pull]`);
  await page.waitForSelector(`${BACKUP} [data-pull-read], ${BACKUP} [data-pull-refused]`, {
    timeout: 20_000,
  });
};

When("they pull the address they were given", async function (this: PointerWorld) {
  if (!ADDRESS.test(this.pushedAddress)) {
    throw new Error("no push in this scenario has been given an address yet");
  }
  await pullAddress(this, this.pushedAddress);
});

/** Whatever the scenario names, which is how a refusal gets its subject. */
When("they pull the address {string}", async function (this: PointerWorld, address: string) {
  await pullAddress(this, address);
});

Then(
  "the backup view reads {int} tasks out of the snapshot",
  async function (this: PointerWorld, n: number) {
    await this.browserPage.waitForSelector(`${BACKUP} [data-pull-read="${n}"]`, {
      timeout: 10_000,
    });
  },
);

const snapshotRefusal = async (world: PointerWorld): Promise<string> => {
  await world.browserPage.waitForSelector(`${BACKUP} [data-pull-refused]`, { timeout: 20_000 });
  return world.browserPage.$eval(
    `${BACKUP} [data-pull-refused]`,
    (n) => n.textContent?.replace(/\s+/g, " ").trim() ?? "",
  );
};

Then("the backup view refuses the snapshot", async function (this: PointerWorld) {
  expect(await snapshotRefusal(this)).toContain("refused");
});

/**
 * Every word the refusal has to carry, given as one comma-separated list.
 *
 * Substrings and not the whole sentence, for the reason the file door's
 * equivalent gives: what a person needs is the field to look at and the values
 * that disagree, and a step asserting the wording would go red on a rewrite and
 * stay green on a refusal that named the wrong thing.
 */
Then("the refusal of the snapshot names {string}", async function (this: PointerWorld, wanted: string) {
  const said = await snapshotRefusal(this);
  for (const word of titleList(wanted)) expect(said).toContain(word);
});

// --- snapshots this shell could not have written ----------------------------
//
// Two of the pull door's refusals are about a snapshot no page in this tree can
// produce: one a NEWER shell pushed, and one that was never a planner. So the
// harness pushes them, directly at the service, which is the one place in these
// steps that does not go through the page. That is deliberate and it is the
// same shape as `the database gives up part-way through a write`: the door is
// the subject, and the thing it refuses has to be arranged.
//
// The service is read off the page rather than configured, so this pushes to
// the service the page was told about and not to one a runner happened to name.

const serviceOnPage = async (world: PointerWorld): Promise<string> => {
  const base = await world.browserPage.evaluate(() => {
    const el = document.getElementById("__BUILD__");
    if (!el?.textContent) return "";
    return (JSON.parse(el.textContent) as { apiBase?: string }).apiBase ?? "";
  });
  if (!base) throw new Error("the page names no service to push to");
  return base;
};

const pushDirectly = async (world: PointerWorld, body: unknown): Promise<void> => {
  const base = await serviceOnPage(world);
  const res = await fetch(`${base}/v1/snapshots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (res.status !== 201) {
    throw new Error(`the service would not keep the arranged snapshot: ${res.status}`);
  }
  const said = (await res.json()) as { snapshot?: string };
  if (!said.snapshot) throw new Error("the arranged push carried no address");
  world.arrangedAddress = said.snapshot;
};

Given("the service holds a planner a newer shell wrote", async function (this: PointerWorld) {
  await pushDirectly(this, { ...plannerDocument(["Fix the gate"]), schemaVersion: 9 });
});

Given("the service holds something that was never a planner", async function (this: PointerWorld) {
  // Any JSON object is a snapshot as far as the service is concerned: it writes
  // bytes under the hash of those bytes and reads no field of them. What stands
  // in front of a browser is the pull door.
  await pushDirectly(this, { note: "not a planner at all" });
});

When("they pull that address", async function (this: PointerWorld) {
  if (!this.arrangedAddress) {
    throw new Error("no step in this scenario has arranged a snapshot");
  }
  await pullAddress(this, this.arrangedAddress);
});
