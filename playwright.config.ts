// The runner.
//
// The .feature files did not change. What changed is what executes them:
// playwright-bdd generates a Playwright spec per feature, and Playwright runs
// it. What that buys, and it is two of the three things the item expected: a
// trace of a failed browser scenario, and a screenshot beside it. Parallelism
// is the third and it did not arrive - see `workers` below, where the reason
// is.
//
// It still runs on BUN. `bun node_modules/@playwright/test/cli.js test` keeps
// Bun as the runtime of the workers, which the whole harness needs - it uses
// Bun.spawn, Bun.serve, Bun.file and Bun.CryptoHasher, and it imports
// scripts/store.ts and scripts/contract.ts, which are Bun code and are the same
// files build, publish and promote run. Measured, because the difference is
// invisible: `bun x playwright test` runs the workers under NODE - no Bun
// global, no bun:test - and the same suite fails to import its own harness.
// The scripts name the runner the long way for exactly that reason, the same
// way `verify` already named cucumber's own bin.

import { defineConfig } from "@playwright/test";
import { defineBddConfig } from "playwright-bdd";

const testDir = defineBddConfig({
  features: "features/**/*.feature",
  // The world and the hooks live in support/, and playwright-bdd has to see
  // them to collect the fixtures each scenario needs.
  // Not `support/**`: `support/__tests__/` holds a `bun test` unit test, and
  // the runner must not import bun:test into a Playwright worker.
  steps: ["features/steps/*.ts", "features/support/*.ts"],
  outputDir: ".features-gen",
});

export default defineConfig({
  testDir,

  // One worker, and it is not a default left in place. The live scenarios
  // publish builds and promote them to two channels the suite shares, and
  // features/support/world.ts keeps one module-level map of build name to unit
  // ids. Two scenarios at once would race on the pointer and on that map, and
  // the failure would look like propagation rather than like a race. Making
  // @local parallel is possible - each of those scenarios starts its own stub
  // store and its own server on port 0 - and it is a separate piece of work.
  workers: 1,
  fullyParallel: false,

  // Was setDefaultTimeout(180_000). A promote waits out a propagation window
  // of 15 s and the suite waits for a composition to reach an origin.
  timeout: 180_000,

  reporter: process.env.CI ? [["list"], ["html", { open: "never" }]] : [["list"]],

  use: {
    // The Chrome already on the machine, so nothing downloads a second one.
    channel: "chrome",
    headless: true,
    // The reason for the port. A browser scenario that fails leaves a trace
    // and a screenshot rather than a line of text.
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    video: "off",
  },
});
