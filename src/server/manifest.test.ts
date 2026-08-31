import { describe, expect, test } from "bun:test";
import {
  createDocumentStore,
  createManifestStore,
  manifestUrl,
  parseManifest,
  type Manifest,
} from "./manifest.ts";

const idOf = (m: Manifest | null | undefined): string | undefined =>
  m ? (m.schema === 3 ? m.shell.unitId : m.buildId) : undefined;

const URL_QA = "https://store.test/manifests/eu/qa.json";

const base = (buildId: string) => ({
  buildId,
  commit: `${buildId}0000000000000000000000000000000000000`,
  publishedAt: "2026-08-26T20:14:02.000Z",
  assetBase: `https://store.test/builds/${buildId}/`,
});

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

const loosen = (value: unknown): Record<string, unknown> =>
  value as Record<string, unknown>;

const rejects = (input: unknown, field: string) => {
  const path = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(() => parseManifest(input)).toThrow(new RegExp(`^manifest field ${path} `));
};

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

  test("a read exactly at the TTL refreshes", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(10_000);
    await h.store.get(URL_QA);
    expect(h.state.calls).toBe(2);
  });

  test("a stale read returns the old build without waiting, then updates", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => Response.json(doc("beta"));
    h.tick(11_000);

    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(2);

    await settle();
    expect(idOf(await h.store.get(URL_QA))).toBe("beta");
    expect(h.state.calls).toBe(2);
  });

  test("a clock that has moved backwards refreshes rather than reading as fresh", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => Response.json(doc("beta"));

    h.tick(-60_000);

    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(2);
    await settle();
    expect(idOf(await h.store.get(URL_QA))).toBe("beta");
  });

  test("an entry stamped by the moved clock is fresh again", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(-60_000);
    await h.store.get(URL_QA);
    await settle();
    expect(h.state.calls).toBe(2);

    h.tick(1_000);
    await h.store.get(URL_QA);
    expect(h.state.calls).toBe(2);
  });

  test("a cold peek answers with nothing and does not wait", async () => {
    const h = harness();
    expect(h.store.peek(URL_QA)).toBeNull();
    expect(h.state.calls).toBe(1);
  });

  test("a peek has the value once the fetch it started has landed", async () => {
    const h = harness();
    h.store.peek(URL_QA);
    await settle();
    expect(idOf(h.store.peek(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(1);
  });

  test("a fresh peek makes no network call", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(9_000);
    expect(idOf(h.store.peek(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(1);
  });

  test("a peek exactly at the TTL refreshes", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(10_000);
    h.store.peek(URL_QA);
    expect(h.state.calls).toBe(2);
  });

  test("a stale peek answers with the old value and refreshes behind it", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => Response.json(doc("beta"));
    h.tick(11_000);

    expect(idOf(h.store.peek(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(2);
    await settle();
    expect(idOf(h.store.peek(URL_QA))).toBe("beta");
    expect(h.state.calls).toBe(2);
  });

  test("a burst of peeks causes one fetch", async () => {
    const h = harness();
    const seen = Array.from({ length: 25 }, () => h.store.peek(URL_QA));
    expect(seen.every((m) => m === null)).toBe(true);
    expect(h.state.calls).toBe(1);
  });

  test("a peek after the clock moved backwards refreshes", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(-60_000);
    h.store.peek(URL_QA);
    expect(h.state.calls).toBe(2);
  });

  test("a peek keeps the last good value when the refresh fails", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => {
      throw new Error("the store is gone");
    };
    h.tick(11_000);
    h.store.peek(URL_QA);
    await settle();
    expect(idOf(h.store.peek(URL_QA))).toBe("alpha");
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

describe("defaults", () => {
  function unconfigured() {
    const saved = {
      ttl: Bun.env.MANIFEST_TTL_MS,
      timeout: Bun.env.MANIFEST_TIMEOUT_MS,
    };
    delete Bun.env.MANIFEST_TTL_MS;
    delete Bun.env.MANIFEST_TIMEOUT_MS;
    const state = { clock: 1_000_000, calls: 0 };
    const store = createManifestStore({
      now: () => state.clock,
      onWarn: () => {},
      fetchImpl: (async () => {
        state.calls++;
        return Response.json(doc("alpha"));
      }) as unknown as typeof fetch,
    });
    return {
      store,
      state,
      tick: (ms: number) => (state.clock += ms),
      restore() {
        if (saved.ttl !== undefined) Bun.env.MANIFEST_TTL_MS = saved.ttl;
        if (saved.timeout !== undefined) Bun.env.MANIFEST_TIMEOUT_MS = saved.timeout;
      },
    };
  }

  test("the default TTL is ten seconds", async () => {
    const h = unconfigured();
    try {
      expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
      h.tick(9_999);
      await h.store.get(URL_QA);
      expect(h.state.calls).toBe(1);

      h.tick(1);
      await h.store.get(URL_QA);
      expect(h.state.calls).toBe(2);
    } finally {
      h.restore();
    }
  });

  test("a cold read with the default timeout returns the manifest", async () => {
    const h = unconfigured();
    try {
      expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    } finally {
      h.restore();
    }
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

  test("a non-2xx response is rejected even when its body is a manifest", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.state.respond = async () => Response.json(doc("beta"), { status: 500 });
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

  test("a failed refresh reports through onWarn", async () => {
    const warnings: string[] = [];
    const store = createManifestStore({
      ttlMs: 10_000,
      timeoutMs: 1_000,
      now: () => 1_000_000,
      onWarn: (m) => warnings.push(m),
      fetchImpl: (async () => {
        throw new Error("store unreachable");
      }) as unknown as typeof fetch,
    });

    expect(await store.get(URL_QA)).toBeNull();
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toStartWith("[manifest] ");
  });

  test("a cold read gives up at the timeout", async () => {
    const store = createManifestStore({
      ttlMs: 10_000,
      timeoutMs: 20,
      now: () => 1_000_000,
      onWarn: () => {},
      fetchImpl: ((_url: string, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
        })) as unknown as typeof fetch,
    });

    expect(await store.get(URL_QA)).toBeNull();
    expect(store.stateOf(URL_QA).lastError).toBe("aborted");
  });

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

describe("a refresh that never settles", () => {
  function stuck(timeoutMs = 20) {
    const state = { clock: 1_000_000, calls: 0, hang: false, id: "alpha" };
    const store = createManifestStore({
      ttlMs: 10_000,
      timeoutMs,
      now: () => state.clock,
      onWarn: () => {},
      fetchImpl: (async () => {
        state.calls++;
        if (state.hang) return new Promise<Response>(() => {});
        return Response.json(doc(state.id));
      }) as unknown as typeof fetch,
    });
    return { store, state, tick: (ms: number) => (state.clock += ms) };
  }

  test("the entry is refreshed again once the deadline has passed", async () => {
    const h = stuck();
    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(1);

    h.state.hang = true;
    h.tick(11_000);
    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(2);

    await Bun.sleep(60);

    h.state.hang = false;
    h.state.id = "bravo";
    h.tick(11_000);
    expect(idOf(await h.store.get(URL_QA))).toBe("alpha");
    expect(h.state.calls).toBe(3);
    await settle();
    expect(idOf(await h.store.get(URL_QA))).toBe("bravo");
  });

  test("the abandoned refresh is named, and the age goes on growing", async () => {
    const h = stuck();
    await h.store.get(URL_QA);

    h.state.hang = true;
    h.tick(11_000);
    await h.store.get(URL_QA);
    expect(h.store.stateOf(URL_QA).lastError).toBeNull();

    await Bun.sleep(60);
    const state = h.store.stateOf(URL_QA);
    expect(state.lastError).toContain("did not answer");
    expect(state.ageMs).toBe(11_000);
  });

  test("a cold read gives up even when the abort is ignored", async () => {
    const h = stuck();
    h.state.hang = true;
    const answer = await Promise.race([
      h.store.get(URL_QA),
      Bun.sleep(500).then(() => "still waiting" as const),
    ]);
    expect(answer).toBeNull();
  });
});

describe("state", () => {
  test("a URL nothing has fetched has no age and no error", () => {
    const h = harness();
    expect(h.store.stateOf(URL_QA)).toEqual({ ageMs: null, lastError: null });
  });

  test("a URL whose only fetch failed has no age, and names the failure", async () => {
    const h = harness();
    h.state.respond = async () => {
      throw new Error("the store is gone");
    };
    expect(await h.store.get(URL_QA)).toBeNull();
    expect(h.store.stateOf(URL_QA)).toEqual({ ageMs: null, lastError: "the store is gone" });
  });

  test("a fresh fetch is zero milliseconds old", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    expect(h.store.stateOf(URL_QA)).toEqual({ ageMs: 0, lastError: null });
  });

  test("the age is measured from the last SUCCESSFUL fetch", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(7_000);
    expect(h.store.stateOf(URL_QA).ageMs).toBe(7_000);
  });

  test("a failed refresh names its error and leaves the age growing", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(11_000);
    h.state.respond = async () => {
      throw new Error("the store is gone");
    };
    await h.store.get(URL_QA);
    await settle();

    expect(h.store.stateOf(URL_QA)).toEqual({ ageMs: 11_000, lastError: "the store is gone" });
  });

  test("a failed refresh names the kind of document in the log", async () => {
    const said: string[] = [];
    const store = createDocumentStore(parseManifest, {
      label: "history",
      ttlMs: 10_000,
      timeoutMs: 1_000,
      onWarn: (m) => said.push(m),
      fetchImpl: (async () => {
        throw new Error("the store is gone");
      }) as unknown as typeof fetch,
    });
    expect(await store.get(URL_QA)).toBeNull();
    expect(said[0]).toStartWith(`[history] refresh failed for ${URL_QA}: `);
  });

  test("a refresh that works again clears the error", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(11_000);
    h.state.respond = async () => {
      throw new Error("the store is gone");
    };
    await h.store.get(URL_QA);
    await settle();

    h.state.respond = async () => Response.json(doc("beta"));
    h.tick(11_000);
    await h.store.get(URL_QA);
    await settle();

    expect(h.store.stateOf(URL_QA)).toEqual({ ageMs: 0, lastError: null });
  });

  test("a clock behind the one that stamped the entry reports a negative age", async () => {
    const h = harness();
    await h.store.get(URL_QA);
    h.tick(-60_000);
    expect(h.store.stateOf(URL_QA).ageMs).toBe(-60_000);
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
    rejects({ ...v1("a"), entry: { css: "x.css" } }, "entry.js");
  });

  test("rejects a missing entry stylesheet", () => {
    rejects({ ...v1("a"), entry: { js: "x.js" } }, "entry.css");
  });

  test("rejects a single-bundle manifest with no entry at all", () => {
    const d = loosen(v1("a"));
    delete d.entry;
    rejects(d, "entry.js");
  });

  test("rejects a shell manifest with no apps", () => {
    expect(() => parseManifest({ ...doc("a"), apps: {} })).toThrow("no apps");
  });

  test("rejects an import that names no file", () => {
    rejects({ ...doc("a"), imports: { preact: 42 } }, "imports.preact");
  });

  test("rejects a manifest whose imports is not an object", () => {
    rejects({ ...doc("a"), imports: null }, "imports");
    rejects({ ...doc("a"), imports: "preact-cccc.js" }, "imports");
  });

  test("rejects a manifest whose apps is not an object", () => {
    rejects({ ...doc("a"), apps: null }, "apps");
    rejects({ ...doc("a"), apps: 42 }, "apps");
  });

  test("rejects an app that is not an object", () => {
    rejects({ ...doc("a"), apps: { alpha: null } }, "apps.alpha");
    rejects({ ...doc("a"), apps: { alpha: 42 } }, "apps.alpha");
  });

  test("rejects an app that names no script", () => {
    rejects({ ...doc("a"), apps: { alpha: { css: "x.css" } } }, "apps.alpha.js");
  });

  test("rejects an app stylesheet that is not a string", () => {
    rejects({ ...doc("a"), apps: { alpha: { js: "a.js", css: 42 } } }, "apps.alpha.css");
  });

  test("keeps an app's stylesheet, and accepts an app without one", () => {
    const kept = parseManifest(doc("a"));
    if (kept.schema !== 2) throw new Error("unreachable");
    expect(kept.apps.alpha!.css).toBe("apps/alpha-ffff.css");

    const bare = parseManifest({ ...doc("a"), apps: { alpha: { js: "apps/alpha-eeee.js" } } });
    if (bare.schema !== 2) throw new Error("unreachable");
    expect(bare.apps.alpha!.css).toBeUndefined();
  });

  test("rejects a missing shell script", () => {
    rejects({ ...doc("a"), shell: { css: "x.css" } }, "shell.js");
  });

  test("rejects a missing shell stylesheet", () => {
    rejects({ ...doc("a"), shell: { js: "x.js" } }, "shell.css");
  });

  test("rejects a shell manifest with no shell at all", () => {
    const d = loosen(doc("a"));
    delete d.shell;
    rejects(d, "shell.js");
  });

  test("rejects a non-string assetBase", () => {
    rejects({ ...doc("a"), assetBase: 42 }, "assetBase");
  });

  test("rejects a non-string buildId", () => {
    rejects({ ...doc("a"), buildId: 42 }, "buildId");
  });

  test("rejects a missing commit", () => {
    const d = loosen(doc("a"));
    delete d.commit;
    rejects(d, "commit");
  });

  test("rejects a non-string publishedAt", () => {
    rejects({ ...doc("a"), publishedAt: 42 }, "publishedAt");
  });

  test("rejects an empty string where a name belongs", () => {
    rejects({ ...doc("a"), assetBase: "" }, "assetBase");
  });

  test("rejects a non-object", () => {
    expect(() => parseManifest(null)).toThrow(/^manifest is not an object$/);
    expect(() => parseManifest("{}")).toThrow(/^manifest is not an object$/);
  });

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

  test("keeps a composed unit's stylesheet, and accepts one with no css field", () => {
    const kept = parseManifest(composed("s1"));
    if (kept.schema !== 3) throw new Error("unreachable");
    expect(kept.apps.alpha!.css).toBe("alpha-bbbb.css");

    const doc3 = composed("s1");
    delete loosen(doc3.apps.alpha).css;
    const m = parseManifest(doc3);
    if (m.schema !== 3) throw new Error("unreachable");
    expect(m.apps.alpha!.css).toBeNull();
  });

  test("rejects a composed unit whose stylesheet is not a string", () => {
    const doc3 = composed("s1");
    loosen(doc3.apps.alpha).css = 42;
    rejects(doc3, "apps.alpha.css");
  });

  test("rejects a composition whose shell carries no import map", () => {
    const doc3 = composed("s1");
    delete (doc3.shell as { imports?: unknown }).imports;
    rejects(doc3, "shell.imports");
  });

  test("rejects a composition whose shell import map is empty", () => {
    const doc3 = composed("s1");
    loosen(doc3.shell).imports = {};
    rejects(doc3, "shell.imports");
  });

  test("rejects a composed unit with no base", () => {
    const doc3 = composed("s1");
    delete (doc3.apps.alpha as { assetBase?: unknown }).assetBase;
    rejects(doc3, "apps.alpha.assetBase");
  });

  test("rejects a composed unit with no id", () => {
    const doc3 = composed("s1");
    delete loosen(doc3.apps.alpha).unitId;
    rejects(doc3, "apps.alpha.unitId");
  });

  test("rejects a composed unit with no script", () => {
    const doc3 = composed("s1");
    delete loosen(doc3.apps.alpha).js;
    rejects(doc3, "apps.alpha.js");
  });

  test("rejects a composed unit that is not an object", () => {
    rejects({ ...composed("s1"), apps: { alpha: null } }, "apps.alpha");
    rejects({ ...composed("s1"), apps: { alpha: 42 } }, "apps.alpha");
  });

  test("rejects a composition whose apps is not an object", () => {
    rejects({ ...composed("s1"), apps: null }, "apps");
    rejects({ ...composed("s1"), apps: 42 }, "apps");
  });

  test("rejects a composed unit whose imports is not an object", () => {
    const nulled = composed("s1");
    loosen(nulled.apps.alpha).imports = null;
    rejects(nulled, "apps.alpha.imports");

    const stringy = composed("s1");
    loosen(stringy.apps.alpha).imports = "preact-cccc.js";
    rejects(stringy, "apps.alpha.imports");
  });

  test("rejects a composed unit import that names no file", () => {
    const doc3 = composed("s1");
    loosen(doc3.apps.alpha).imports = { preact: 42 };
    rejects(doc3, "apps.alpha.imports.preact");
  });

  test("rejects a composition whose shell is malformed", () => {
    const doc3 = composed("s1");
    delete loosen(doc3.shell).assetBase;
    rejects(doc3, "shell.assetBase");
  });

  test("rejects a composition naming no apps", () => {
    expect(() => parseManifest({ ...composed("s1"), apps: {} })).toThrow("no apps");
  });

  test("rejects a composition with no timestamp", () => {
    const d = loosen(composed("s1"));
    delete d.composedAt;
    rejects(d, "composedAt");
  });

  test("rejects a composition with no contract", () => {
    const d = loosen(composed("s1"));
    delete d.contract;
    rejects(d, "contract");
  });

  test("keeps the digests a unit carries", () => {
    const doc3 = composed("s1");
    loosen(doc3.apps.alpha).integrity = {
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

  test("accepts a composed unit with no digests at all", () => {
    const m = parseManifest(composed("s1"));
    if (m.schema !== 3) throw new Error("unreachable");
    expect(m.apps.alpha!.integrity).toBeUndefined();
  });

  test("rejects a digest that is not a string", () => {
    const doc3 = composed("s1");
    loosen(doc3.apps.alpha).integrity = { "alpha-aaaa.js": 7 };
    rejects(doc3, "apps.alpha.integrity.alpha-aaaa.js");
  });

  test("rejects a composed unit whose integrity is not an object", () => {
    const nulled = composed("s1");
    loosen(nulled.apps.alpha).integrity = null;
    rejects(nulled, "apps.alpha.integrity");

    const stringy = composed("s1");
    loosen(stringy.apps.alpha).integrity = "sha384-one";
    rejects(stringy, "apps.alpha.integrity");
  });

  test("keeps a composed unit's commit and marker, and defaults each to empty", () => {
    const doc3 = composed("s1");
    loosen(doc3.apps.alpha).marker = "e2e";
    const m = parseManifest(doc3);
    if (m.schema !== 3) throw new Error("unreachable");
    expect(m.apps.alpha!.commit).toBe(unit("alpha", "a1").commit);
    expect(m.apps.alpha!.marker).toBe("e2e");

    const older = composed("s1");
    delete loosen(older.apps.alpha).commit;
    delete loosen(older.apps.alpha).marker;
    const m2 = parseManifest(older);
    if (m2.schema !== 3) throw new Error("unreachable");
    expect(m2.apps.alpha!.commit).toBe("");
    expect(m2.apps.alpha!.marker).toBe("");
  });
});
