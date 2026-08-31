import { describe, expect, test } from "bun:test";
import { servedFor } from "./versions.ts";

const NOW = Date.parse("2026-08-31T12:00:00.000Z");
const ago = (ms: number) => new Date(NOW - ms).toISOString();
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

describe("servedFor", () => {
  test("under a minute is not a number worth printing", () => {
    expect(servedFor(ago(30_000), NOW)).toBe("just now");
  });

  test("minutes, up to the hour", () => {
    expect(servedFor(ago(12 * MINUTE), NOW)).toBe("12 min");
    expect(servedFor(ago(59 * MINUTE), NOW)).toBe("59 min");
  });

  test("hours, up to two days - a unit deployed yesterday reads in hours", () => {
    expect(servedFor(ago(HOUR), NOW)).toBe("1 h");
    expect(servedFor(ago(23 * HOUR), NOW)).toBe("23 h");
    expect(servedFor(ago(47 * HOUR), NOW)).toBe("47 h");
  });

  test("days past that", () => {
    expect(servedFor(ago(48 * HOUR), NOW)).toBe("2 d");
    expect(servedFor(ago(30 * 24 * HOUR), NOW)).toBe("30 d");
  });

  test("an instant it cannot read prints nothing", () => {
    expect(servedFor("not a date", NOW)).toBe("");
  });

  test("a stamp ahead of the browser's clock reads as just now, never as negative", () => {
    expect(servedFor(ago(-5 * MINUTE), NOW)).toBe("just now");
  });
});
