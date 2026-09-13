// What a week is, read without a browser and without the clock.
//
// `weekOf` takes the moment as an ARGUMENT, so every reading here names the
// day it is about. A cold read on 2026-09-13 asked why the Monday rule was
// checked only by a browser scenario running against the real clock: a
// scenario run on a Monday cannot tell "the week containing today" from "the
// next seven days", and nobody would be told which day the suite ran on.
//
// The `.feature` file still names days by POSITION and never by a date,
// because that is a rule about reading a page a panel drew from the clock it
// was given. This file is the other half.

import { describe, expect, test } from "bun:test";
import { label, weekOf } from "./week.ts";

/** A local midnight, so the reading is the visitor's own day and not UTC's. */
const at = (iso: string) => new Date(`${iso}T12:00:00`);

describe("the seven days of a week", () => {
  test("gives seven days", () => {
    expect(weekOf(at("2026-09-13"))).toHaveLength(7);
  });

  // The rule the unit exists to state. `2026-09-13` is a SUNDAY, so a week
  // that started today would read 13 to 19 September and this is the reading
  // that tells them apart.
  test("a Sunday belongs to the week that began six days earlier", () => {
    expect(weekOf(at("2026-09-13"))).toEqual([
      "2026-09-07",
      "2026-09-08",
      "2026-09-09",
      "2026-09-10",
      "2026-09-11",
      "2026-09-12",
      "2026-09-13",
    ]);
  });

  // The day a rolling window and a Monday week AGREE, which is why a mutation
  // that makes the week start today is a no-op one day in seven and is not in
  // `falsify.ts`'s array.
  test("a Monday is the first day of its own week", () => {
    expect(weekOf(at("2026-09-07"))[0]).toBe("2026-09-07");
  });

  test.each([
    ["2026-09-07", "2026-09-07"],
    ["2026-09-08", "2026-09-07"],
    ["2026-09-09", "2026-09-07"],
    ["2026-09-10", "2026-09-07"],
    ["2026-09-11", "2026-09-07"],
    ["2026-09-12", "2026-09-07"],
    ["2026-09-13", "2026-09-07"],
    ["2026-09-14", "2026-09-14"],
  ])("%p is in the week beginning %p", (day, monday) => {
    expect(weekOf(at(day))[0]).toBe(monday);
  });

  test("every day is one day after the one before it", () => {
    const days = weekOf(at("2026-09-13")).map((d) => Date.parse(`${d}T00:00:00Z`));
    for (const [index, day] of days.entries()) {
      if (index > 0) expect(day - days[index - 1]!).toBe(86_400_000);
    }
  });

  // The week the day falls in, always. A window that drifted by a whole week
  // would still be seven consecutive days beginning on a Monday.
  test.each(["2026-09-07", "2026-09-13", "2026-12-31", "2027-01-01", "2024-02-29"])(
    "%p is one of its own seven days",
    (day) => {
      expect(weekOf(at(day))).toContain(day);
    },
  );

  // Month and year boundaries, where a week is the thing that crosses them.
  test("a week crosses the end of a year", () => {
    expect(weekOf(at("2026-12-31"))).toEqual([
      "2026-12-28",
      "2026-12-29",
      "2026-12-30",
      "2026-12-31",
      "2027-01-01",
      "2027-01-02",
      "2027-01-03",
    ]);
  });

  test("a week crosses the end of February in a leap year", () => {
    expect(weekOf(at("2024-02-29"))).toEqual([
      "2024-02-26",
      "2024-02-27",
      "2024-02-28",
      "2024-02-29",
      "2024-03-01",
      "2024-03-02",
      "2024-03-03",
    ]);
  });
});

describe("what a day is called", () => {
  // The weekday comes off the DATE and not off the day's position in the row.
  // Read from the position it could never disagree with the position, so a
  // week anchored on the wrong day drew `MON 6 SEP` and the page said nothing
  // was wrong. These are the readings that make the heading contradict itself.
  test.each([
    ["2026-09-07", "Mon 7 Sep"],
    ["2026-09-08", "Tue 8 Sep"],
    ["2026-09-09", "Wed 9 Sep"],
    ["2026-09-10", "Thu 10 Sep"],
    ["2026-09-11", "Fri 11 Sep"],
    ["2026-09-12", "Sat 12 Sep"],
    ["2026-09-13", "Sun 13 Sep"],
  ])("%p reads %p", (day, reads) => {
    expect(label(day)).toBe(reads);
  });

  test.each([
    ["2026-01-01", "Thu 1 Jan"],
    ["2026-12-31", "Thu 31 Dec"],
    ["2024-02-29", "Thu 29 Feb"],
  ])("%p reads %p", (day, reads) => {
    expect(label(day)).toBe(reads);
  });

  // Every day the panel draws is labelled with the weekday it actually is.
  test("the seven labels of a week run Mon to Sun, in order", () => {
    const names = weekOf(at("2026-09-13")).map((d) => label(d).slice(0, 3));
    expect(names).toEqual(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
  });
});
