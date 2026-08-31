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
