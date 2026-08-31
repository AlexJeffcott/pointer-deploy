import { describe, expect, test } from "bun:test";
import { createServedLog, SERVED_CAPACITY, type ServedEntry } from "./served.ts";

function clock(start = Date.parse("2026-08-30T09:00:00.000Z")) {
  let t = start;
  return { now: () => t, advance: (ms: number) => void (t += ms) };
}

const entry = (over: Partial<ServedEntry> = {}): ServedEntry => ({
  channel: "qa",
  region: "eu",
  buildId: "sh1",
  units: { shell: "sh1", alpha: "a1" },
  contract: "c1",
  overridden: false,
  ...over,
});

describe("a fresh log", () => {
  test("has counted nothing and names nothing", () => {
    const reading = createServedLog().read();
    expect(reading.schema).toBe(1);
    expect(reading.responses).toBe(0);
    expect(reading.compositions).toEqual([]);
    expect(reading.evicted).toBe(0);
  });

  test("stamps itself from the real clock when none is given", () => {
    const reading = createServedLog().read();
    expect(Number.isNaN(Date.parse(reading.since))).toBe(false);
    expect(Number.isNaN(Date.parse(reading.readAt))).toBe(false);
  });

  test("reports the capacity it is holding to", () => {
    expect(createServedLog().read().capacity).toBe(SERVED_CAPACITY);
    expect(createServedLog({ capacity: 3 }).read().capacity).toBe(3);
  });
});

describe("counting what was handed out", () => {
  test("names the composition, once, with what it was assembled from", () => {
    const c = clock();
    const log = createServedLog({ now: c.now });
    log.record(entry());

    const [row, ...rest] = log.read().compositions;
    expect(rest).toEqual([]);
    expect(row).toEqual({
      channel: "qa",
      region: "eu",
      buildId: "sh1",
      units: { shell: "sh1", alpha: "a1" },
      contract: "c1",
      responses: 1,
      overrides: 0,
      firstAt: "2026-08-30T09:00:00.000Z",
      lastAt: "2026-08-30T09:00:00.000Z",
    });
  });

  test("counts a second response for the same composition on the same row", () => {
    const c = clock();
    const log = createServedLog({ now: c.now });
    log.record(entry());
    c.advance(5_000);
    log.record(entry());

    const reading = log.read();
    expect(reading.responses).toBe(2);
    expect(reading.compositions).toHaveLength(1);
    expect(reading.compositions[0]!.responses).toBe(2);
    expect(reading.compositions[0]!.firstAt).toBe("2026-08-30T09:00:00.000Z");
    expect(reading.compositions[0]!.lastAt).toBe("2026-08-30T09:00:05.000Z");
  });

  test("does not split one composition over the order its units are named in", () => {
    const log = createServedLog();
    log.record(entry({ units: { shell: "sh1", alpha: "a1" } }));
    log.record(entry({ units: { alpha: "a1", shell: "sh1" } }));
    expect(log.read().compositions).toHaveLength(1);
  });

  test("keeps a channel's count apart from another channel's", () => {
    const log = createServedLog();
    log.record(entry({ channel: "qa" }));
    log.record(entry({ channel: "prod" }));
    expect(log.read().compositions.map((r) => r.channel).sort()).toEqual(["prod", "qa"]);
  });

  test("keeps a region's count apart from another region's", () => {
    const log = createServedLog();
    log.record(entry({ region: "eu" }));
    log.record(entry({ region: "us" }));
    expect(log.read().compositions).toHaveLength(2);
  });

  test("separates two compositions that differ in one unit", () => {
    const log = createServedLog();
    log.record(entry({ units: { shell: "sh1", alpha: "a1" } }));
    log.record(entry({ units: { shell: "sh1", alpha: "a2" } }));
    expect(log.read().compositions.map((r) => r.units.alpha).sort()).toEqual(["a1", "a2"]);
  });

  test("separates one set of units served at two contracts", () => {
    const log = createServedLog();
    log.record(entry({ contract: "c1" }));
    log.record(entry({ contract: "c2" }));
    expect(log.read().compositions.map((r) => r.contract).sort()).toEqual(["c1", "c2"]);
  });

  test("names a manifest below schema 3 by its build alone", () => {
    const log = createServedLog();
    log.record(entry({ buildId: "old", units: {}, contract: null }));
    const [row] = log.read().compositions;
    expect(row!.buildId).toBe("old");
    expect(row!.units).toEqual({});
    expect(row!.contract).toBeNull();
  });

  test("lists the most recently served composition first", () => {
    const log = createServedLog();
    log.record(entry({ buildId: "first" }));
    log.record(entry({ buildId: "second" }));
    expect(log.read().compositions.map((r) => r.buildId)).toEqual(["second", "first"]);
    log.record(entry({ buildId: "first" }));
    expect(log.read().compositions.map((r) => r.buildId)).toEqual(["first", "second"]);
  });
});

describe("an override is counted apart", () => {
  test("a response the query string composed is counted as one", () => {
    const log = createServedLog();
    log.record(entry({ buildId: "old", overridden: true }));
    const [row] = log.read().compositions;
    expect(row!.responses).toBe(1);
    expect(row!.overrides).toBe(1);
  });

  test("the pointer's own responses are not counted as overrides", () => {
    const log = createServedLog();
    log.record(entry());
    log.record(entry());
    expect(log.read().compositions[0]!.overrides).toBe(0);
  });

  test("counts a second override on a row it already holds", () => {
    const log = createServedLog();
    log.record(entry({ buildId: "old", overridden: true }));
    log.record(entry({ buildId: "old", overridden: true }));
    const [row] = log.read().compositions;
    expect(row!.responses).toBe(2);
    expect(row!.overrides).toBe(2);
  });

  test("separates the operator's traffic from the rest on one row", () => {
    const log = createServedLog();
    log.record(entry({ buildId: "old", overridden: true }));
    log.record(entry({ buildId: "old", overridden: false }));
    const [row] = log.read().compositions;
    expect(row!.responses).toBe(2);
    expect(row!.overrides).toBe(1);
  });
});

describe("the cap", () => {
  test("holds every composition up to it", () => {
    const log = createServedLog({ capacity: 2 });
    log.record(entry({ buildId: "one" }));
    log.record(entry({ buildId: "two" }));
    const reading = log.read();
    expect(reading.compositions).toHaveLength(2);
    expect(reading.evicted).toBe(0);
  });

  test("drops the least recently served composition, and says how many", () => {
    const log = createServedLog({ capacity: 2 });
    log.record(entry({ buildId: "one" }));
    log.record(entry({ buildId: "two" }));
    log.record(entry({ buildId: "three" }));
    const reading = log.read();
    expect(reading.compositions.map((r) => r.buildId)).toEqual(["three", "two"]);
    expect(reading.evicted).toBe(1);
  });

  test("a composition still being served is not the one dropped", () => {
    const log = createServedLog({ capacity: 2 });
    log.record(entry({ buildId: "one" }));
    log.record(entry({ buildId: "two" }));
    log.record(entry({ buildId: "one" }));
    log.record(entry({ buildId: "three" }));
    expect(log.read().compositions.map((r) => r.buildId)).toEqual(["three", "one"]);
  });

  test("counts every response, including ones whose row was dropped", () => {
    const log = createServedLog({ capacity: 1 });
    log.record(entry({ buildId: "one" }));
    log.record(entry({ buildId: "one" }));
    log.record(entry({ buildId: "two" }));
    const reading = log.read();
    expect(reading.responses).toBe(3);
    expect(reading.compositions).toHaveLength(1);
    expect(reading.evicted).toBe(1);
  });
});

describe("the reading is a copy", () => {
  test("a later response does not change a reading already taken", () => {
    const log = createServedLog();
    log.record(entry());
    const reading = log.read();
    log.record(entry());
    expect(reading.compositions[0]!.responses).toBe(1);
  });

  test("the caller's own units object is not held onto", () => {
    const log = createServedLog();
    const units = { shell: "sh1", alpha: "a1" };
    log.record(entry({ units }));
    units.alpha = "a2";
    expect(log.read().compositions[0]!.units).toEqual({ shell: "sh1", alpha: "a1" });
  });
});

describe("what the reading says it does not answer", () => {
  const reading = createServedLog().read();

  test("says what it does answer", () => {
    expect(reading.answers).toBe("the shells this process has handed out since `since`");
  });

  test("names the open tab it cannot see", () => {
    expect(reading.blindTo).toContain(
      "a tab opened before a promote: it keeps its composition and never asks again, so what is still running is not counted here",
    );
  });

  test("names the machine the count is lost with", () => {
    expect(reading.blindTo).toContain(
      "every other machine, and this one before it was last replaced: the count is in memory and starts again at zero",
    );
  });

  test("names what the cap dropped", () => {
    expect(reading.blindTo).toContain(
      "compositions dropped once `capacity` was reached, counted in `evicted` and no longer named",
    );
  });
});
