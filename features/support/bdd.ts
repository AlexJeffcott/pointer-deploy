import { test as base, createBdd } from "playwright-bdd";
import { PointerWorld } from "./world.ts";

export const test = base.extend<{ world: PointerWorld }>({
  world: async ({}, use) => {
    await use(new PointerWorld());
  },
});

export const { Given, When, Then, Before, After, BeforeAll, AfterAll } = createBdd(test, {
  worldFixture: "world",
});

export const { Before: BeforeWithFixtures } = createBdd(test);
