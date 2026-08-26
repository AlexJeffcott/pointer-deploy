import { describe, expect, test } from "bun:test";
import { createManifestStore, manifestUrl, parseManifest } from "./manifest.ts";

const URL_QA = "https://store.test/manifests/eu/qa.json";

const doc = (buildId: string) => ({
  schema: 1,
  buildId,
  commit: `${buildId}0000000000000000000000000000000000000`,
  publishedAt: "2026-08-26T20:14:02.000Z",
  assetBase: `https://store.test/builds/${buildId}/`,
  entry: { js: "index-aaaa.js", css: "index-bbbb.css" },
});

function harness(ttlMs = 10_000) {
  const state = {
    clock: 1_000_000,
    calls: 0,
    respond: async (): Promise<Response> => Response.json(doc("alpha")),
  };
  const store = createManifestStore({
    ttlMs,
    timeoutMs: 1_000,
    now: () => state.clock,
    onWarn: () => {},
    fetchImpl: (async () => {
      state.calls++;
      return state.respond();
    }) as unknown as typeof fetch,
  });
  return { store, state, tick: (ms: number) => (state.clock += ms) };
}

const settle = () => Bun.sleep(2);

test("manifestUrl joins base, region and channel", () => {
  expect(manifestUrl("https://store.test/manifests/", "eu", "qa")).toBe(URL_QA);
  expect(manifestUrl("https://store.test/manifests", "eu", "qa")).toBe(URL_QA);
});

describe("caching", () => {
  test("a cold read fetches once and returns the manifest", async () => {
    const h = harness();
    expect((await h.store.get(URL_QA))?.buildId).toBe("alpha");
    expect(h.state.calls).toBe(1);
  });

  test("a fresh read makes no network call", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(9_000);
    expect((await h.store.get(URL_QA))?.buildId).toBe("alpha");
    expect(h.state.calls).toBe(1);
  });

  test("a stale read returns the old build without waiting, then updates", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => Response.json(doc("beta"));
    h.tick(11_000);

    // Rule 2: the visitor gets the previous build immediately.
    expect((await h.store.get(URL_QA))?.buildId).toBe("alpha");
    expect(h.state.calls).toBe(2);

    await settle();
    expect((await h.store.get(URL_QA))?.buildId).toBe("beta");
    expect(h.state.calls).toBe(2);
  });

  test("a burst of cold readers causes one fetch", async () => {
    const h = harness();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => h.store.get(URL_QA)),
    );
    expect(results.every((m) => m?.buildId === "alpha")).toBe(true);
    expect(h.state.calls).toBe(1);
  });
});

describe("failure", () => {
  test("a failed refresh keeps the last good build", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => {
      throw new Error("store unreachable");
    };
    h.tick(11_000);

    expect((await h.store.get(URL_QA))?.buildId).toBe("alpha");
    await settle();
    h.tick(11_000);
    expect((await h.store.get(URL_QA))?.buildId).toBe("alpha");
  });

  test("a malformed document does not replace a good build", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => Response.json({ schema: 1, buildId: 42 });
    h.tick(11_000);
    await h.store.get(URL_QA);
    await settle();

    h.tick(11_000);
    expect((await h.store.get(URL_QA))?.buildId).toBe("alpha");
  });

  test("a non-2xx response does not replace a good build", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => new Response("nope", { status: 500 });
    h.tick(11_000);
    await h.store.get(URL_QA);
    await settle();

    h.tick(11_000);
    expect((await h.store.get(URL_QA))?.buildId).toBe("alpha");
  });

  test("a cold read with a dead store yields null", async () => {
    const h = harness();
    h.state.respond = async () => {
      throw new Error("store unreachable");
    };
    expect(await h.store.get(URL_QA)).toBeNull();
  });

  // Rule 6. Without this a dead store is hit once per request.
  test("a dead store is retried on the TTL, not on every read", async () => {
    const h = harness();
    h.state.respond = async () => {
      throw new Error("store unreachable");
    };
    await h.store.get(URL_QA);
    expect(h.state.calls).toBe(1);

    for (let i = 0; i < 20; i++) expect(await h.store.get(URL_QA)).toBeNull();
    expect(h.state.calls).toBe(1);

    h.tick(11_000);
    await h.store.get(URL_QA);
    expect(h.state.calls).toBe(2);
  });
});

describe("parseManifest", () => {
  test("accepts a complete manifest", () => {
    expect(parseManifest(doc("alpha")).buildId).toBe("alpha");
  });

  test("rejects an unsupported schema", () => {
    expect(() => parseManifest({ ...doc("a"), schema: 2 })).toThrow("schema");
  });

  test("rejects a missing entry file", () => {
    expect(() => parseManifest({ ...doc("a"), entry: { css: "x.css" } })).toThrow("entry.js");
  });

  test("rejects a non-string assetBase", () => {
    expect(() => parseManifest({ ...doc("a"), assetBase: 42 })).toThrow("assetBase");
  });

  test("rejects a non-object", () => {
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest("{}")).toThrow();
  });
});
