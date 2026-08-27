import { describe, expect, test } from "bun:test";
import { createManifestStore, manifestUrl, parseManifest, type Manifest } from "./manifest.ts";

/** The id a manifest is known by, whichever schema it is. */
const idOf = (m: Manifest | null | undefined): string | undefined =>
  m ? (m.schema === 3 ? m.shell.unitId : m.buildId) : undefined;

const URL_QA = "https://store.test/manifests/eu/qa.json";

const base = (buildId: string) => ({
  buildId,
  commit: `${buildId}0000000000000000000000000000000000000`,
  publishedAt: "2026-08-26T20:14:02.000Z",
  assetBase: `https://store.test/builds/${buildId}/`,
});

/** A build from before the shell split. Still a valid rollback target. */
const v1 = (buildId: string) => ({
  ...base(buildId),
  schema: 1,
  entry: { js: "index-aaaa.js", css: "index-bbbb.css" },
});

const doc = (buildId: string) => ({
  ...base(buildId),
  schema: 2,
  shell: { js: "index-aaaa.js", css: "index-bbbb.css" },
  imports: { preact: "preact-cccc.js", "@pointer/shell": "api-dddd.js" },
  apps: { alpha: { js: "apps/alpha-eeee.js", css: "apps/alpha-ffff.css" } },
});

/** A composition. Each unit carries its own base, which is the whole point. */
const unit = (name: string, id: string, extra: Record<string, unknown> = {}) => ({
  unitId: id,
  commit: `${id}${"0".repeat(40)}`.slice(0, 40),
  assetBase: `https://store.test/units/${name}/${id}/`,
  js: `${name}-aaaa.js`,
  css: `${name}-bbbb.css`,
  marker: "",
  ...extra,
});

const composed = (shellId: string, alphaId = "a1") => ({
  schema: 3,
  composedAt: "2026-08-27T10:00:00.000Z",
  contract: "9e79879",
  shell: unit("shell", shellId, {
    js: "index-aaaa.js",
    css: "index-bbbb.css",
    imports: { preact: "preact-cccc.js", "@pointer/shell": "api-dddd.js" },
  }),
  apps: { alpha: unit("alpha", alphaId) },
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
    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(1);
  });

  test("a fresh read makes no network call", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(9_000);
    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(1);
  });

  test("a stale read returns the old build without waiting, then updates", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => Response.json(doc("beta"));
    h.tick(11_000);

    // Rule 2: the visitor gets the previous build immediately.
    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(2);

    await settle();
    expect(idOf(await h.store.get(URL_QA))).toBe("beta");
    expect(h.state.calls).toBe(2);
  });

  test("a burst of cold readers causes one fetch", async () => {
    const h = harness();
    const results = await Promise.all(
      Array.from({ length: 25 }, () => h.store.get(URL_QA)),
    );
    expect(results.every((m) => idOf(m) === "alpha")).toBe(true);
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

    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    await settle();
    h.tick(11_000);
    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
  });

  test("a malformed document does not replace a good build", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => Response.json({ schema: 1, buildId: 42 });
    h.tick(11_000);
    await h.store.get(URL_QA);
    await settle();

    h.tick(11_000);
    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
  });

  test("a non-2xx response does not replace a good build", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => new Response("nope", { status: 500 });
    h.tick(11_000);
    await h.store.get(URL_QA);
    await settle();

    h.tick(11_000);
    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
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
  test("accepts a shell manifest with its apps", () => {
    const m = parseManifest(doc("alpha"));
    expect(idOf(m)).toBe("alpha");
    expect(m.schema).toBe(2);
    if (m.schema !== 2) throw new Error("unreachable");
    expect(Object.keys(m.apps)).toEqual(["alpha"]);
    expect(m.imports["@pointer/shell"]).toBe("api-dddd.js");
  });

  // A build published before the shell split must stay a working rollback
  // target rather than becoming a 503.
  test("still accepts a single-bundle manifest", () => {
    const m = parseManifest(v1("old"));
    expect(m.schema).toBe(1);
    if (m.schema !== 1) throw new Error("unreachable");
    expect(m.entry.js).toBe("index-aaaa.js");
  });

  test("rejects an unsupported schema", () => {
    expect(() => parseManifest({ ...doc("a"), schema: 4 })).toThrow("schema");
  });

  test("rejects a missing entry file", () => {
    expect(() => parseManifest({ ...v1("a"), entry: { css: "x.css" } })).toThrow("entry.js");
  });

  test("rejects a shell manifest with no apps", () => {
    expect(() => parseManifest({ ...doc("a"), apps: {} })).toThrow("no apps");
  });

  test("rejects an import that names no file", () => {
    expect(() => parseManifest({ ...doc("a"), imports: { preact: 42 } })).toThrow("imports.preact");
  });

  test("rejects an app that names no script", () => {
    expect(() => parseManifest({ ...doc("a"), apps: { alpha: { css: "x.css" } } })).toThrow(
      "apps.alpha.js",
    );
  });

  test("rejects a missing shell script", () => {
    expect(() => parseManifest({ ...doc("a"), shell: { css: "x.css" } })).toThrow("shell.js");
  });

  test("rejects a non-string assetBase", () => {
    expect(() => parseManifest({ ...doc("a"), assetBase: 42 })).toThrow("assetBase");
  });

  test("rejects a non-object", () => {
    expect(() => parseManifest(null)).toThrow();
    expect(() => parseManifest("{}")).toThrow();
  });

  // Schema 3. The units are composed from separate publishes, so the thing to
  // check is that each one keeps its OWN base rather than borrowing a shared
  // one - that is the single field the whole feature rests on.
  test("accepts a composition and keeps each unit's own base", () => {
    const m = parseManifest(composed("s1", "a9"));
    expect(m.schema).toBe(3);
    if (m.schema !== 3) throw new Error("unreachable");
    expect(m.shell.unitId).toBe("s1");
    expect(m.apps.alpha!.unitId).toBe("a9");
    expect(m.shell.assetBase).toBe("https://store.test/units/shell/s1/");
    expect(m.apps.alpha!.assetBase).toBe("https://store.test/units/alpha/a9/");
    expect(m.contract).toBe("9e79879");
  });

  test("accepts a composed app with no stylesheet", () => {
    const doc3 = composed("s1");
    doc3.apps.alpha.css = null as unknown as string;
    const m = parseManifest(doc3);
    if (m.schema !== 3) throw new Error("unreachable");
    expect(m.apps.alpha!.css).toBeNull();
  });

  test("rejects a composition whose shell carries no import map", () => {
    const doc3 = composed("s1");
    delete (doc3.shell as { imports?: unknown }).imports;
    // Without it every sub-app's bare specifiers fail to resolve in the
    // browser and the page renders empty, while the server stays green.
    expect(() => parseManifest(doc3)).toThrow("shell.imports");
  });

  test("rejects a composed unit with no base", () => {
    const doc3 = composed("s1");
    delete (doc3.apps.alpha as { assetBase?: unknown }).assetBase;
    expect(() => parseManifest(doc3)).toThrow("apps.alpha.assetBase");
  });

  test("rejects a composition naming no apps", () => {
    expect(() => parseManifest({ ...composed("s1"), apps: {} })).toThrow("no apps");
  });

  test("keeps the digests a unit carries", () => {
    const doc3 = composed("s1");
    (doc3.apps.alpha as Record<string, unknown>).integrity = {
      "alpha-aaaa.js": "sha384-one",
      "alpha-bbbb.css": "sha384-two",
    };
    const m = parseManifest(doc3);
    if (m.schema !== 3) throw new Error("unreachable");
    expect(m.apps.alpha!.integrity).toEqual({
      "alpha-aaaa.js": "sha384-one",
      "alpha-bbbb.css": "sha384-two",
    });
  });

  // A unit published before digests were recorded carries none, and a
  // composition naming one is what a rollback that far IS. Refusing it here
  // would turn the oldest rollback into a 503.
  test("accepts a composed unit with no digests at all", () => {
    const m = parseManifest(composed("s1"));
    if (m.schema !== 3) throw new Error("unreachable");
    expect(m.apps.alpha!.integrity).toBeUndefined();
  });

  test("rejects a digest that is not a string", () => {
    const doc3 = composed("s1");
    (doc3.apps.alpha as Record<string, unknown>).integrity = { "alpha-aaaa.js": 7 };
    expect(() => parseManifest(doc3)).toThrow("apps.alpha.integrity.alpha-aaaa.js");
  });
});
