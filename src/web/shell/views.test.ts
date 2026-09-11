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

  // Which unit is on which route, asserted rather than assumed. A unit that
  // moved route leaves both sets identical, so `placementProblems` cannot see
  // it and this is the only check that says where `list` is.
  it("places list on the landing route and nothing anywhere else", () => {
    expect(placedApps(VIEWS)).toEqual(["list"]);
    expect(VIEWS["/"]!.apps).toEqual(["list"]);
  });

  // The claim `PLAN.md` step 0 exists for, and it keeps its subject at step 1
  // on the four routes that place nothing. Two of them are waiting for a unit -
  // `/board` at step 4, `/week` at step 5 - and two never get one.
  it("keeps four views that name no unit at all", () => {
    const empty = Object.entries(VIEWS)
      .filter(([, v]) => v.apps.length === 0)
      .map(([path]) => path);
    expect(empty).toEqual(["/board", "/week", "/service", "/backup"]);
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
  // change. The units are named here rather than taken from APPS, so the
  // reading stays the same whatever this slate happens to build.
  it("cannot see an app moved from one route to another", () => {
    const here = views({ "/": ["hello"], "/next": [] });
    const there = views({ "/": [], "/next": ["hello"] });
    expect(placementProblems(["hello"], here)).toEqual([]);
    expect(placementProblems(["hello"], there)).toEqual([]);
  });
});
