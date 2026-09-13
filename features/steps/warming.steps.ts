// What the page warmed, read off the browser's own resource timings.
//
// `PLAN.md` step 4. The reading is deliberately NOT a count of requests: a
// count says the same thing with the warm and without it, because with no warm
// the import issues the one fetch itself. `PerformanceResourceTiming` carries
// what started each fetch and when, and those are what differ.
//
// `initiatorType` is the discriminator, and the values are MEASURED rather than
// assumed. Chrome, on 2026-09-11, against the deployed origin:
//
//   <link rel="modulepreload">        board-e04tvq9m.js    other    5 ms
//   <link rel="preload" as="style">   board-nbca5xwf.css   link     5 ms
//   a dynamic import()                shared-51rbczf7.js   script   234 ms
//
// So a warmed module reads "other" and not "link", which is the reading the
// first version of this file guessed wrong. What holds either way is that
// nothing a dynamic import started reads anything but "script" - and the entry
// for `board`'s bundle is still "other" AFTER the navigation, which is the
// import reusing the warmed response rather than fetching a second time.
//
// `transferSize` is 0 on every entry here and carries nothing: the store is a
// different origin and sends no `Timing-Allow-Origin`, so the browser zeroes
// the sizes. The reading is what started the fetch and when, not how big it was.

import { Then } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";

type Timing = { name: string; initiatorType: string };

/** Every resource timing this page holds for one unit's own directory. */
const timingsFor = (world: PointerWorld, unit: string): Promise<Timing[]> =>
  world.browserPage.evaluate(
    (name) =>
      performance
        .getEntriesByType("resource")
        .filter((e) => e.name.includes(`/units/${name}/`))
        .map((e) => ({
          name: e.name,
          initiatorType: (e as PerformanceResourceTiming).initiatorType,
        })),
    unit,
  );

Then(
  "the browser has already fetched {string}, started by the page itself",
  async function (this: PointerWorld, unit: string) {
    const page = this.browserPage;
    // The tags are in the document's head, so the fetches start with the page
    // and nothing waits on them. Polling rather than reading once: a warm that
    // has not landed yet is not a warm that never started.
    await page.waitForFunction(
      (name) =>
        performance.getEntriesByType("resource").filter((e) => e.name.includes(`/units/${name}/`))
          .length === 2,
      unit,
      { timeout: 20_000 },
    );

    const timings = await timingsFor(this, unit);
    // Both files. A page that warmed the script and forgot the stylesheet
    // leaves the panel drawing unstyled for exactly as long as the old fetch
    // took, which is the cost this is here to remove.
    expect(timings.map((t) => t.name.split(".").pop()).sort()).toEqual(["css", "js"]);

    // Nothing here was started by a dynamic import. That is the half of the
    // design a timing can state: a hint fills the cache, and an import would
    // have RUN the module for a visitor who may never open the view.
    for (const timing of timings) {
      expect(`${timing.name.split("/").pop()} started by ${timing.initiatorType}`).not.toBe(
        `${timing.name.split("/").pop()} started by script`,
      );
    }
  },
);

Then(
  "nothing on the landing view imported {string}",
  async function (this: PointerWorld, unit: string) {
    // The other half of "a hint and never a background import". A module that
    // was imported has RUN, and this unit writes its marker into the panel it
    // draws - so the absence of that panel is the reading a timing cannot give.
    expect(await this.browserPage.$(`[data-app="${unit}"]`)).toBeNull();
    const timings = await timingsFor(this, unit);
    expect(timings.map((t) => t.initiatorType)).not.toContain("script");
  },
);

Then("each of {string}'s files was fetched once", async function (this: PointerWorld, unit: string) {
  const timings = await timingsFor(this, unit);
  const counted = new Map<string, number>();
  for (const timing of timings) counted.set(timing.name, (counted.get(timing.name) ?? 0) + 1);

  const twice = [...counted].filter(([, n]) => n > 1).map(([name, n]) => `${name} x${n}`);
  expect(`fetched more than once: ${twice.join(", ")}`).toBe("fetched more than once: ");
  expect(counted.size).toBe(2);
});
