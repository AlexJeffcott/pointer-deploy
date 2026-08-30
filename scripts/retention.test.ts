// §5, the retention floor. Build-time code, so `bun test scripts` is its home.
//
// Every case here hands `retentionPlan` a clock, so "90 days ago" is a fact the
// test owns rather than a property of the day it runs on.

import { describe, expect, test } from "bun:test";
import {
  FLOOR_DAYS,
  groupOf,
  heldByReason,
  retentionPlan,
  type HistoryReading,
  type PlanInput,
  type StoredObject,
} from "./retention.ts";

const NOW = Date.parse("2026-08-30T12:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * 24 * 60 * 60 * 1000).toISOString();

const object = (key: string, age: number): StoredObject => ({ key, lastModified: daysAgo(age) });

const history = (
  channel: string,
  units: HistoryReading["units"],
  updatedAt = daysAgo(1),
): HistoryReading => ({ channel, updatedAt, units });

const plan = (input: Partial<PlanInput>) =>
  retentionPlan({
    now: NOW,
    floorDays: FLOOR_DAYS,
    objects: [],
    pointed: new Set(),
    histories: [],
    retained: new Set(["e0160a6"]),
    ...input,
  });

const reasonFor = (result: ReturnType<typeof plan>, group: string) =>
  result.held.find((h) => h.group === group)?.reason;

describe("which files a sweep may remove", () => {
  test("a unit a channel serves stays, however old it is", () => {
    const result = plan({
      objects: [object("units/alpha/aaaa1111/index.js", 400)],
      pointed: new Set(["units/alpha/aaaa1111"]),
    });
    expect(result.deleteKeys).toEqual([]);
    expect(reasonFor(result, "units/alpha/aaaa1111")).toBe("served");
  });

  test("a unit the switcher still offers stays", () => {
    const result = plan({
      objects: [object("units/alpha/aaaa1111/index.js", 400)],
      histories: [
        history("qa", {
          alpha: [{ unitId: "aaaa1111", contracts: ["e0160a6"], supersededAt: daysAgo(300) }],
        }),
      ],
    });
    expect(result.deleteKeys).toEqual([]);
    expect(reasonFor(result, "units/alpha/aaaa1111")).toBe("offered");
  });

  // The floor's first half, and the state the sweep was in before it existed:
  // a unit published an hour ago, superseded by the next promote, and deletable
  // the moment its contract set stopped being retained.
  test("a unit written inside the floor stays, even with nothing naming it", () => {
    const result = plan({ objects: [object("units/alpha/aaaa1111/index.js", 1)] });
    expect(result.deleteKeys).toEqual([]);
    expect(reasonFor(result, "units/alpha/aaaa1111")).toBe("young");
  });

  // The floor's second half, and the one an age-since-publish rule gets wrong.
  // A year-old unit that was serving traffic yesterday is a day out of use.
  test("an old unit a channel stopped serving inside the floor stays", () => {
    const result = plan({
      objects: [object("units/alpha/aaaa1111/index.js", 400)],
      histories: [
        history("qa", {
          alpha: [{ unitId: "aaaa1111", contracts: ["gone1234"], supersededAt: daysAgo(2) }],
        }),
      ],
    });
    expect(result.deleteKeys).toEqual([]);
    expect(reasonFor(result, "units/alpha/aaaa1111")).toBe("recently served");
  });

  test("an old unit nothing has served since the floor is removed, files and all", () => {
    const result = plan({
      objects: [
        object("units/alpha/aaaa1111/index.js", 200),
        object("units/alpha/aaaa1111/index.css", 200),
      ],
      histories: [
        history("qa", {
          alpha: [{ unitId: "aaaa1111", contracts: ["gone1234"], supersededAt: daysAgo(180) }],
        }),
      ],
    });
    expect(result.deleteKeys.sort()).toEqual([
      "units/alpha/aaaa1111/index.css",
      "units/alpha/aaaa1111/index.js",
    ]);
    expect(result.historyDrops).toEqual([
      { channel: "qa", unit: "alpha", unitId: "aaaa1111" },
    ]);
  });

  // The drop exists so the switcher cannot offer a build whose files are gone.
  // Dropping one whose files STAY would retire a build the floor is keeping.
  test("a history entry is kept when the floor keeps its unit", () => {
    const result = plan({
      objects: [object("units/alpha/aaaa1111/index.js", 2)],
      histories: [
        history("qa", {
          alpha: [{ unitId: "aaaa1111", contracts: ["gone1234"], supersededAt: daysAgo(1) }],
        }),
      ],
    });
    expect(result.historyDrops).toEqual([]);
  });

  // Every entry written before promote recorded the stamp. The latest moment it
  // could have stopped being served is the last time that history was written,
  // so that is what it counts as.
  test("an entry with no stamp counts as the last promote on its channel", () => {
    const result = plan({
      objects: [object("units/alpha/aaaa1111/index.js", 400)],
      histories: [history("qa", { alpha: [{ unitId: "aaaa1111", contracts: ["gone1234"] }] }, daysAgo(3))],
    });
    expect(reasonFor(result, "units/alpha/aaaa1111")).toBe("recently served");
  });

  test("and is removed once that promote is itself past the floor", () => {
    const result = plan({
      objects: [object("units/alpha/aaaa1111/index.js", 400)],
      histories: [history("qa", { alpha: [{ unitId: "aaaa1111", contracts: ["gone1234"] }] }, daysAgo(120))],
    });
    expect(result.deleteKeys).toEqual(["units/alpha/aaaa1111/index.js"]);
  });

  // A missing reading is not a zero. The safe direction for one is to keep.
  test("an object the store gave no date for stays", () => {
    const result = plan({ objects: [{ key: "units/alpha/aaaa1111/index.js", lastModified: "" }] });
    expect(result.deleteKeys).toEqual([]);
    expect(reasonFor(result, "units/alpha/aaaa1111")).toBe("young");
  });

  test("a unit is judged whole: one young file keeps the directory", () => {
    const result = plan({
      objects: [
        object("units/alpha/aaaa1111/index.js", 200),
        object("units/alpha/aaaa1111/late.js", 1),
      ],
    });
    expect(result.deleteKeys).toEqual([]);
  });

  test("the older layouts are judged on their own age", () => {
    const result = plan({
      objects: [object("builds/old/index.js", 200), object("probe/recent.json", 2)],
    });
    expect(result.deleteKeys).toEqual(["builds/old/index.js"]);
    expect(reasonFor(result, "probe/recent.json")).toBe("young");
  });

  test("a shorter floor removes what the 90-day one keeps", () => {
    const objects = [object("units/alpha/aaaa1111/index.js", 30)];
    expect(plan({ objects }).deleteKeys).toEqual([]);
    expect(plan({ objects, floorDays: 7 }).deleteKeys).toEqual([
      "units/alpha/aaaa1111/index.js",
    ]);
  });
});

describe("reading a plan", () => {
  test("a unit's files group under its directory, and nothing else does", () => {
    expect(groupOf("units/alpha/aaaa1111/index.js")).toBe("units/alpha/aaaa1111");
    expect(groupOf("units/alpha/aaaa1111/nested/deep.js")).toBe("units/alpha/aaaa1111");
    expect(groupOf("builds/old/index.js")).toBe("builds/old/index.js");
  });

  test("the held rows count by reason", () => {
    const result = plan({
      objects: [
        object("units/alpha/aaaa1111/index.js", 1),
        object("units/bravo/bbbb2222/index.js", 400),
      ],
      pointed: new Set(["units/bravo/bbbb2222"]),
    });
    expect(heldByReason(result.held)).toEqual({
      served: 1,
      offered: 0,
      young: 1,
      "recently served": 0,
    });
  });
});
