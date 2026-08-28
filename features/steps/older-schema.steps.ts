// Steps for the schema no browser has ever loaded.
//
// The fixture is read from disk on every step rather than carried on the
// World: it is a file that nothing in a run writes, so re-reading it is the
// cheapest way to keep the steps independent of each other.

import { Given, Then } from "../support/bdd.ts";
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

  // Warm first, then write the pointer - the order promote.ts uses, and for
  // the same reason. A cold Tigris edge cost one visitor over 30 s once, and
  // here that reads as a flaky browser run rather than as the fact it is.
  const urls = urlsInManifest(doc);
  const { failed } = await warmAll(urls);
  if (failed.length) {
    throw new Error(
      `${failed.length} of the ${urls.length} files the fixture names could not be fetched, ` +
        `so nothing below would be evidence:\n  ${failed.join("\n  ")}`,
    );
  }

  await this.pointChannelAtDocument("qa", doc);
  // The store caches a pointer for 5 s and the server has a TTL of its own, so
  // the first page load after the write can still be the previous manifest.
  await this.awaitBuildId("qa", doc.buildId, PROPAGATION_WINDOW_MS + 15_000);
});

Then("the page names one build and no composition", async function (this: PointerWorld) {
  const doc = await fixture();

  // Read out of the DOM, not out of a curl. The claim is about the page the
  // browser is showing.
  const raw = await this.browserPage.evaluate(
    () => document.getElementById("__BUILD__")?.textContent ?? "",
  );
  const build = JSON.parse(raw) as { buildId?: string; units?: unknown; contract?: unknown };

  expect(build.buildId).toBe(doc.buildId);
  // Schema 3 reports a unit id per unit and the contract they composed at.
  // Schema 2 has neither, and their absence is what says which schema answered.
  expect(build.units).toBeUndefined();
  expect(build.contract).toBeUndefined();
});

Then(
  "every file the page fetched from the store came from that one directory",
  async function (this: PointerWorld) {
    const doc = await fixture();
    const store = new URL(doc.assetBase).origin;
    const fetched = this.requests.filter((url) => url.startsWith(store));

    // The shell, its stylesheet, the shared runtime and two sub-apps, at least.
    // Without a floor an empty list passes and proves nothing.
    expect(fetched.length).toBeGreaterThan(4);
    expect(fetched.filter((url) => !url.startsWith(doc.assetBase))).toEqual([]);
  },
);
