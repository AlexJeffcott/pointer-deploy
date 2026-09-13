// TODO §44. The half of the cold-state guarantee that can be read without a
// browser: what the probe's reading MEANS, and what the script does in what
// order. The browser half is arranged by hand and recorded in `PLAN.md`,
// because a mutation that removes the clear turns nothing red while Playwright
// gives each test its own context.

import { describe, expect, test } from "bun:test";
import {
  PLANNER_DB,
  PROBE_KEY,
  PROBE_SCRIPT,
  coldPlannerProblem,
  readProbe,
} from "../cold-planner.ts";

describe("what the probe read", () => {
  test("no reading at all is not a problem", () => {
    expect(readProbe(null)).toBeNull();
    expect(coldPlannerProblem(null, "a scenario")).toBeNull();
  });

  // The whole point. A context nothing has used holds no `pointer-planner`, so
  // the delete reports version 0 and there is nothing to say.
  test("version 0 means no database existed, which is cold", () => {
    expect(readProbe("0")).toBe(0);
    expect(coldPlannerProblem(0, "a scenario")).toBeNull();
  });

  test("a version above 0 means the context was used before", () => {
    expect(readProbe("1")).toBe(1);
    expect(coldPlannerProblem(1, "a scenario")).toContain("did not start from a cold planner");
  });

  test("the reading names the scenario, the database and the version", () => {
    const said = coldPlannerProblem(2, "A task put on a day is drawn on it")!;
    expect(said).toContain("A task put on a day is drawn on it");
    expect(said).toContain(PLANNER_DB);
    expect(said).toContain("version 2");
  });

  // The recovery is a place to look and not a command, because nothing here can
  // know which change made the contexts shared.
  test("the reading names where to look", () => {
    expect(coldPlannerProblem(1, "a scenario")).toContain("playwright.config.ts");
  });

  // A browser with no `indexedDB.databases()` cannot answer. That is not a warm
  // context, and reporting it would fail every run on such a browser for a
  // reason that is not about the planner.
  test("a browser that cannot answer is not reported as warm", () => {
    expect(readProbe("unsupported")).toBe("unsupported");
    expect(coldPlannerProblem("unsupported", "a scenario")).toBeNull();
  });

  // The probe writes this the moment it starts, so a reload inside one scenario
  // finds a mark and takes no second reading. It means "started, not finished".
  test("a probe that started and did not finish is no reading", () => {
    expect(readProbe("unread")).toBeNull();
    expect(coldPlannerProblem(readProbe("unread"), "a scenario")).toBeNull();
  });

  // The finding that took the clear out. A report that offered to clear would
  // be offering the thing measured to hang a reused context.
  test("the reading says why nothing is cleared", () => {
    const said = coldPlannerProblem(1, "a scenario")!;
    expect(said).toContain("Nothing here clears it");
    expect(said).toContain("verify:cold");
  });

  test("a reading that is not a version is no reading", () => {
    expect(readProbe("yesterday")).toBeNull();
    expect(readProbe("-1")).toBeNull();
    expect(readProbe("1.5")).toBeNull();
  });
});

describe("the script the world installs", () => {
  // It reads and does nothing else. An `open` with no version CREATES the
  // database with no object stores, and the shell's own `open(name, 1)` would
  // then find a version 1 holding no `tasks` store. A `deleteDatabase` issued
  // while another page holds a connection is blocked, and queues every later
  // open behind it - measured on 2026-09-13, and why neither is here.
  test("opens nothing and deletes nothing", () => {
    expect(PROBE_SCRIPT).toContain("indexedDB.databases()");
    expect(PROBE_SCRIPT).not.toContain("indexedDB.open");
    expect(PROBE_SCRIPT).not.toContain("deleteDatabase");
  });

  // The mark is written BEFORE the read resolves, so a reload inside one
  // scenario finds it and takes no second reading of a planner the scenario
  // itself has just written.
  test("marks the context before it reads, not after", () => {
    const mark = PROBE_SCRIPT.indexOf(`setItem(${JSON.stringify(PROBE_KEY)}, "unread")`);
    const read = PROBE_SCRIPT.indexOf("indexedDB.databases()");
    expect(mark).toBeGreaterThan(-1);
    expect(read).toBeGreaterThan(-1);
    expect(mark).toBeLessThan(read);
  });

  test("says so rather than throwing when the browser has no databases()", () => {
    expect(PROBE_SCRIPT).toContain('typeof indexedDB.databases !== "function"');
    expect(PROBE_SCRIPT).toContain('"unsupported"');
  });

  test("returns early when the context has already been probed", () => {
    expect(PROBE_SCRIPT).toContain(`sessionStorage.getItem(${JSON.stringify(PROBE_KEY)}) !== null`);
  });

  test("names the planner's database and no other", () => {
    expect(PROBE_SCRIPT).toContain(JSON.stringify(PLANNER_DB));
  });

  // A browser that refuses IndexedDB is step 2's "unstored", which scenarios
  // arrange on purpose. The probe must not turn that into a harness failure.
  test("survives a browser with no IndexedDB", () => {
    expect(PROBE_SCRIPT).toContain("try {");
    expect(PROBE_SCRIPT).toContain("} catch {");
  });
});
