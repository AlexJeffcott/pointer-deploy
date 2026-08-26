import { describe, expect, test } from "bun:test";
import { hostTable, resolveChannel, resolveRegion, resolveTarget } from "./origins.ts";

const dev = hostTable(false);
const prod = hostTable(true);

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

  test("separates the local channels", () => {
    expect(resolveChannel("qa.localhost", dev)).toBe("qa");
    expect(resolveChannel("prod.localhost", dev)).toBe("prod");
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

  // Opposite rule to the host lookup, on purpose: the machine is running
  // somewhere, so refusing all traffic is worse than one wrong region.
  test("falls back to eu for an unknown region and warns", () => {
    const warnings: unknown[] = [];
    const original = console.warn;
    console.warn = (...args: unknown[]) => void warnings.push(args.join(" "));
    try {
      expect(resolveRegion("syd")).toBe("eu");
      expect(resolveRegion(undefined)).toBe("eu");
    } finally {
      console.warn = original;
    }
    expect(warnings).toHaveLength(2);
    expect(String(warnings[0])).toContain("syd");
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
