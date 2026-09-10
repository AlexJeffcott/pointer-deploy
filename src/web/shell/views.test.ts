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

  it("lists each placed app once, in view order", () => {
    expect(placedApps(VIEWS)).toEqual(["hello"]);
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

  it("cannot see an app moved from one route to another", () => {
    const here = views({ "/": ["hello"], "/next": [] });
    const there = views({ "/": [], "/next": ["hello"] });
    expect(placementProblems(APPS, here)).toEqual([]);
    expect(placementProblems(APPS, there)).toEqual([]);
  });
});
