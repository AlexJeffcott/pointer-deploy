import { describe, expect, it } from "bun:test";
import { APPS } from "../../../scripts/contract.ts";
import { placedApps, placementProblems, VIEWS, type View } from "./views.ts";

const views = (apps: Record<string, string[]>): Record<string, View> =>
  Object.fromEntries(
    Object.entries(apps).map(([path, list]) => [path, { title: path, apps: list, note: "" }]),
  );

describe("placement", () => {
  it("places every unit this repository builds", () => {
    expect(placementProblems(APPS)).toEqual([]);
  });

  // Every view on this slate names no unit, which is what PLAN.md step 0 is.
  // Asserted rather than assumed: a view that quietly gained a unit would make
  // `placementProblems` refuse the build, and this says which of the two moved.
  it("places nothing, because this slate builds nothing to place", () => {
    expect(placedApps(VIEWS)).toEqual([]);
    expect(Object.values(VIEWS).flatMap((v) => [...v.apps])).toEqual([]);
  });

  it("names five routes, and the frame draws every one of them", () => {
    expect(Object.keys(VIEWS)).toEqual(["/", "/board", "/week", "/service", "/backup"]);
  });

  // A view the shell draws by itself places nothing, and that is not a fault.
  it("accepts a view that names no app", () => {
    expect(placementProblems(["hello"], views({ "/": ["hello"], "/service": [] }))).toEqual([]);
  });

  it("reports a built app that no view places", () => {
    const problems = placementProblems(["hello", "foxtrot"], views({ "/": ["hello"] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^foxtrot is built and published/);
  });

  it("reports a placed app that nothing builds", () => {
    const problems = placementProblems(["hello"], views({ "/": ["hello"], "/next": ["foxtrot"] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^foxtrot is placed on \/next/);
  });

  it("names every route a missing app was placed on", () => {
    const problems = placementProblems([], views({ "/": ["foxtrot"], "/next": ["foxtrot"] }));
    expect(problems[0]).toContain("placed on /, /next");
  });

  // The direction the build-time check is blind to, stated so it stays stated.
  // Both sets are identical either way, so only a scenario catches a route
  // change - and the units are named here rather than taken from APPS, which is
  // empty on this slate and would make the reading vacuous.
  it("cannot see an app moved from one route to another", () => {
    const here = views({ "/": ["hello"], "/next": [] });
    const there = views({ "/": [], "/next": ["hello"] });
    expect(placementProblems(["hello"], here)).toEqual([]);
    expect(placementProblems(["hello"], there)).toEqual([]);
  });
});
