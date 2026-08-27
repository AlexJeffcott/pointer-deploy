import { describe, expect, test } from "bun:test";
import {
  hostTable,
  resolveChannel,
  resolveRegion,
  resolveTarget,
  type Region,
} from "./origins.ts";

const dev = hostTable(false);
const prod = hostTable(true);

/** Runs fn with console.warn captured, and always puts console.warn back. */
function withWarnings<T>(fn: () => T): { result: T; warnings: string[] } {
  const warnings: string[] = [];
  const original = console.warn;
  console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
  try {
    return { result: fn(), warnings };
  } finally {
    console.warn = original;
  }
}

describe("resolveChannel", () => {
  test("maps the deployed host to its channel", () => {
    expect(resolveChannel("pointer-deploy.fly.dev", prod)).toBe("qa");
  });

  test("ignores case", () => {
    expect(resolveChannel("Pointer-Deploy.Fly.Dev", prod)).toBe("qa");
  });

  test("ignores the port", () => {
    expect(resolveChannel("qa.localhost:3000", dev)).toBe("qa");
  });

  test("ignores a trailing dot on a fully qualified name", () => {
    expect(resolveChannel("pointer-deploy.fly.dev.", prod)).toBe("qa");
  });

  test("separates the deployed channels", () => {
    expect(resolveChannel("pointer-deploy.fly.dev", prod)).toBe("qa");
    expect(resolveChannel("prod.pointer-deploy.test", prod)).toBe("prod");
  });

  // The live acceptance suite promotes throwaway builds. If its hosts resolved
  // to qa or prod, every run would deploy one of them - which is what happened
  // before these existed.
  test("gives the acceptance suite channels of its own", () => {
    expect(resolveChannel("test-qa.pointer-deploy.test", prod)).toBe("test-qa");
    expect(resolveChannel("test-prod.pointer-deploy.test", prod)).toBe("test-prod");
  });

  test("keeps the suite's channels out of the ones visitors are served", () => {
    const suite = new Set(["test-qa", "test-prod"]);
    expect(suite.has(resolveChannel("pointer-deploy.fly.dev", prod)!)).toBe(false);
    expect(suite.has(resolveChannel("prod.pointer-deploy.test", prod)!)).toBe(false);
  });

  test("separates the local channels", () => {
    expect(resolveChannel("qa.localhost", dev)).toBe("qa");
    expect(resolveChannel("prod.localhost", dev)).toBe("prod");
  });

  // Every name in the development table, because each one is a separate entry
  // that can be lost on its own. The bare host and the loopback address are
  // what a developer types; the two below are what the e2e script drives.
  test("serves every development name a channel", () => {
    expect(resolveChannel("localhost", dev)).toBe("qa");
    expect(resolveChannel("127.0.0.1", dev)).toBe("qa");
  });

  // scripts/e2e-independent-deploy.ts drives Chrome at these two. Live, the
  // suite's channels are reached by a Host header, which no browser can be made
  // to send, so a name that resolves is the only way a browser reaches them.
  test("gives the suite's channels a name a browser can reach", () => {
    expect(resolveChannel("test-qa.localhost", dev)).toBe("test-qa");
    expect(resolveChannel("test-prod.localhost", dev)).toBe("test-prod");
  });

  // The point of the whole file: an unknown host must never be given a channel.
  test("refuses an unknown host rather than defaulting", () => {
    expect(resolveChannel("evil.example.com", prod)).toBeNull();
    expect(resolveChannel("", prod)).toBeNull();
    expect(resolveChannel(null, prod)).toBeNull();
    expect(resolveChannel(undefined, prod)).toBeNull();
  });

  test("does not expose the local hosts in production", () => {
    expect(resolveChannel("prod.localhost", prod)).toBeNull();
    expect(resolveChannel("localhost", prod)).toBeNull();
  });
});

describe("resolveRegion", () => {
  test("maps a known Fly region", () => {
    expect(resolveRegion("ams")).toBe("eu");
    expect(resolveRegion("lhr")).toBe("eu");
  });

  // Without a region that is not the fallback, deleting the lookup entirely
  // leaves every test green. Stryker found this.
  test("maps a Fly region that is not the fallback", () => {
    expect(resolveRegion("iad")).toBe("us");
    expect(resolveRegion("sjc")).toBe("us");
  });

  // Every entry, and the warning is half of the assertion. An entry that
  // returns "eu" cannot be told from the fallback by what it RETURNS - delete
  // it and "eu" still comes back. What separates them is that a mapped region
  // is silent, and that silence is the only signal the table is complete. A new
  // Fly region serving the wrong manifest announces itself here or nowhere.
  test("maps every Fly region it knows, and warns about none of them", () => {
    const KNOWN: ReadonlyArray<readonly [string, Region]> = [
      ["ams", "eu"],
      ["lhr", "eu"],
      ["fra", "eu"],
      ["cdg", "eu"],
      ["arn", "eu"],
      ["mad", "eu"],
      ["iad", "us"],
      ["ord", "us"],
      ["sjc", "us"],
      ["lax", "us"],
    ];
    for (const [fly, region] of KNOWN) {
      const { result, warnings } = withWarnings(() => resolveRegion(fly));
      // The Fly code travels into the assertion so a failure names which one.
      expect([fly, result, warnings.length]).toEqual([fly, region, 0]);
    }
  });

  // Opposite rule to the host lookup, on purpose: the machine is running
  // somewhere, so refusing all traffic is worse than one wrong region.
  test("falls back to eu for an unknown region and warns", () => {
    const { warnings } = withWarnings(() => {
      expect(resolveRegion("syd")).toBe("eu");
      expect(resolveRegion(undefined)).toBe("eu");
    });
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain("syd");
  });
});

describe("resolveTarget", () => {
  test("carries the region alongside the channel", () => {
    expect(resolveTarget("prod.localhost", dev, "eu")).toEqual({ region: "eu", channel: "prod" });
  });

  test("is null when the host is unknown", () => {
    expect(resolveTarget("nope.example.com", dev, "eu")).toBeNull();
  });
});
