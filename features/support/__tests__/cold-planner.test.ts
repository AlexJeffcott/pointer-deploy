// TODO §44. The half of the cold-state guarantee that can be read without a
// browser: what the probe's reading MEANS, and what the script does in what
// order. The browser half is `bun run verify:cold`, a committed script, because
// a mutation removing the probe turns nothing red while Playwright gives each
// test its own context.
//
// Three of these are STRING checks on the script's text - it opens nothing,
// deletes nothing, and marks the context before it reads. A check that greps a
// string is weaker than one that runs it, and the reason it is here is that the
// script runs in a page and this file does not start a browser. What runs it is
// `verify:cold`; these are what a mutation can reach cheaply.

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
  // the probe reports version 0 and there is nothing to say.
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
  // know which change made the contexts shared. What it names has to be things
  // that CAN share a context: a sentence naming `fullyParallel` and a worker
  // count stood here until 2026-09-13, and neither can - more workers is more
  // isolation.
  test("the reading names what can actually share a context", () => {
    const said = coldPlannerProblem(1, "a scenario")!;
    expect(said).toContain("launchPersistentContext");
    expect(said).toContain("storageState");
    expect(said).toContain("playwright.config.ts");
  });

  test("and says that more workers is not the cause", () => {
    expect(coldPlannerProblem(1, "a scenario")).toContain("More workers is more isolation");
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

  // `Number("")` is 0 and `Number("0x10")` is 16, so reading through `Number`
  // turned an empty value into "cold" and a hex string into a version. The
  // three strings this test used to check are three `Number` also rejects,
  // which is why it passed against the wrong reader. Found by a cold read on
  // 2026-09-13.
  test.each(["yesterday", "-1", "1.5", "", " ", "0x10", " 1 ", "1e3", "+1", "Infinity"])(
    "a reading of %p is no reading",
    (raw) => {
      expect(readProbe(raw)).toBeNull();
    },
  );

  test.each(["0", "1", "2", "10"])("a reading of %p is a version", (raw) => {
    expect(readProbe(raw)).toBe(Number(raw));
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
