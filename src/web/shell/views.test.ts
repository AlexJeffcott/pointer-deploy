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
    expect(placedApps(VIEWS)).toEqual(["alpha", "bravo", "charlie", "delta"]);
  });

  it("reports a built app that no view places", () => {
    const problems = placementProblems(["alpha", "echo"], views({ "/": ["alpha"] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^echo is built and published/);
  });

  it("reports a placed app that nothing builds", () => {
    const problems = placementProblems(["alpha"], views({ "/": ["alpha"], "/totals": ["echo"] }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toMatch(/^echo is placed on \/totals/);
  });

  it("names every route a missing app was placed on", () => {
    const problems = placementProblems([], views({ "/": ["echo"], "/totals": ["echo"] }));
    expect(problems[0]).toContain("placed on /, /totals");
  });

  it("cannot see an app moved from one route to another", () => {
    const moved = views({ "/": ["bravo", "alpha"], "/totals": ["delta", "charlie"] });
    const swapped = views({ "/": ["charlie", "delta"], "/totals": ["alpha", "bravo"] });
    expect(placementProblems(APPS, moved)).toEqual([]);
    expect(placementProblems(APPS, swapped)).toEqual([]);
  });
});
