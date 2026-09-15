import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PROPAGATION_WINDOW_MS, PointerWorld } from "../support/world.ts";
import { urlsInManifest, warmAll } from "../../scripts/store.ts";

const FIXTURE = "features/support/fixtures/schema-2.json";

type SchemaTwo = {
  schema: 2;
  buildId: string;
  assetBase: string;
  shell: { js: string; css: string };
  imports: Record<string, string>;
  apps: Record<string, { js: string; css?: string }>;
};

async function fixture(): Promise<SchemaTwo> {
  const doc = (await Bun.file(FIXTURE)
    .json()
    .catch(() => null)) as SchemaTwo | null;
  if (!doc || doc.schema !== 2) {
    throw new Error(
      `${FIXTURE} is missing or is not a schema 2 manifest. ` +
        `Write it with \`bun run build && bun run fixture:schema-2\`.`,
    );
  }
  return doc;
}

Given("the qa channel points at the kept schema 2 manifest", async function (this: PointerWorld) {
  const doc = await fixture();

  const urls = urlsInManifest(doc);
  const { failed } = await warmAll(urls);
  if (failed.length) {
    throw new Error(
      `${failed.length} of the ${urls.length} files the fixture names could not be fetched, ` +
        `so nothing below would be evidence:\n  ${failed.join("\n  ")}`,
    );
  }

  await this.pointChannelAtDocument("qa", doc);
  await this.awaitBuildId("qa", doc.buildId, PROPAGATION_WINDOW_MS + 15_000);
});

/**
 * Opens `/` and waits for the panels the FIXTURE names, not the ones this tree
 * builds.
 *
 * The two are different on this slate: the kept manifest was published when
 * `hello` existed, and `PLAN.md` step 0 removed it. Reading the app list off the
 * fixture is what keeps these scenarios about the page that was served then.
 */
Given("a visitor opens the landing view of that manifest", async function (this: PointerWorld) {
  const doc = await fixture();
  await this.openView("/", Object.keys(doc.apps));
});

/**
 * Writes through the panel's own input. Nothing is put back, from step 6.
 *
 * The panel is the fixture's, so this is the one place in the suite that still
 * drives a sub-app. It used to need an undo: the old shell wrote the audience
 * to the service, the service held it in memory, and the next visitor read what
 * this scenario left. `PLAN.md` step 6 took the greeting off the service, so
 * `POST /v1/greeting` is now a route it does not answer and there is nothing
 * for an After hook to restore.
 *
 * The scenario still measures what it measured. Measured on 2026-09-14 by
 * reading the kept bundle: `setGreeting` writes the store SYNCHRONOUSLY and
 * only then calls the service, reporting a rejection rather than waiting for
 * one - so the panel draws the new audience whether or not any service answers,
 * which is the import-map claim this scenario is about.
 */
When("they set the audience to {string}", async function (this: PointerWorld, audience: string) {
  const page = this.browserPage;
  const doc = await fixture();
  const input = `[data-app="${Object.keys(doc.apps)[0]}"] input`;
  await page.fill(input, audience);
});

Then("the panel greets {string}", async function (this: PointerWorld, audience: string) {
  const page = this.browserPage;
  await page.waitForFunction(
    (want) => (document.querySelector("[data-greeting]")?.textContent ?? "").includes(want as string),
    audience,
    { timeout: 5_000 },
  );
  const drawn = await page.$eval("[data-greeting]", (n) => n.textContent?.trim() ?? "");
  expect(drawn).toContain(audience);
});

Then("the page names one build and no composition", async function (this: PointerWorld) {
  const doc = await fixture();

  const raw = await this.browserPage.evaluate(
    () => document.getElementById("__BUILD__")?.textContent ?? "",
  );
  const build = JSON.parse(raw) as { buildId?: string; units?: unknown; contract?: unknown };

  expect(build.buildId).toBe(doc.buildId);
  expect(build.units).toBeUndefined();
  expect(build.contract).toBeUndefined();
});

Then(
  "every file the page fetched from the store came from that one directory",
  async function (this: PointerWorld) {
    const doc = await fixture();
    const store = new URL(doc.assetBase).origin;
    const fetched = this.requests.filter((url) => url.startsWith(store));

    expect(fetched.length).toBeGreaterThan(4);
    expect(fetched.filter((url) => !url.startsWith(doc.assetBase))).toEqual([]);
  },
);
