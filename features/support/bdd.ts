// The bindings, and the one file that names the runner.
//
// Steps are cucumber-style: `this` is the PointerWorld and the Gherkin
// parameters are the arguments, which is what `worldFixture` buys. That is why
// changing the runner did not mean rewriting a step.
//
// One exception, deliberately. A hook declared PLAYWRIGHT-style takes the
// runner's fixtures instead of `this`, and the @browser hook has to, because
// the page must come from the runner: a page the harness launched itself is a
// page no trace, screenshot or video is ever attached to, which is the whole
// reason for the port.
//
// The cost of that is worth knowing. playwright-bdd collects the fixtures the
// steps and hooks of a generated FILE use, so a file containing one @browser
// scenario asks for `page` for every scenario in it. Generating with a tag
// expression is what keeps a @local run from ever starting a browser:
// `bddgen test --tags @local` emits no @browser scenario, so nothing asks.

import { test as base, createBdd } from "playwright-bdd";
import { PointerWorld } from "./world.ts";

/** One world per scenario, exactly as `setWorldConstructor` gave. */
export const test = base.extend<{ world: PointerWorld }>({
  world: async ({}, use) => {
    await use(new PointerWorld());
  },
});

export const { Given, When, Then, Before, After, BeforeAll, AfterAll } = createBdd(test, {
  worldFixture: "world",
});

/**
 * Playwright-style hooks, for the ones that need the runner's own fixtures.
 *
 * Only `@browser` uses this. Everything else takes `this`.
 */
export const { Before: BeforeWithFixtures } = createBdd(test);
