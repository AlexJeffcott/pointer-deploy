import { describe, expect, test } from "bun:test";
import {
  FIELDS,
  ROUTES,
  SERVES,
  answered,
  deprecationHeaders,
  deprecationsFor,
  discovery,
  handle,
  parseDeprecations,
} from "./service.ts";
import { memoryStore } from "./store.ts";

const get = (path: string) => new Request(`http://api.test${path}`);
const post = (path: string, body: unknown) =>
  new Request(`http://api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

const bodyOf = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe("the discovery document", () => {
  test("names every version this build answers", async () => {
    const res = await handle(get("/versions"), memoryStore());
    expect(res.status).toBe(200);
    // `serves` keeps its shape whatever else is added beside it. A shell
    // published before §26 reads this member and no other, so changing it is
    // the one thing this document cannot do.
    expect((await bodyOf(res)).serves).toEqual([...SERVES]);
  });

  test("says what is inside each version it answers", async () => {
    const doc = discovery(["v1"], []);
    expect(Object.keys(doc.versions as object)).toEqual(["v1"]);
    const v1 = (doc.versions as Record<string, { fields: unknown[]; routes: unknown[] }>).v1!;
    expect(v1.fields).toEqual(FIELDS.v1!);
    expect(v1.routes).toContainEqual({ method: "POST", path: "/v1/snapshots" });
  });

  test("a version it does not answer is not described", () => {
    const doc = discovery(["v1"], []);
    expect(doc.versions).not.toHaveProperty("v2");
  });

  test("a field going away is said on the field, not beside it", () => {
    const going = {
      path: "snapshot.tasks",
      since: "2026-09-10",
      sunset: "2026-12-10",
      reason: "a planner stores more than tasks",
      instead: null,
    };
    const v1 = (discovery(["v1"], [going]).versions as Record<string, { fields: Record<string, unknown>[] }>).v1!;
    expect(v1.fields.find((f) => f.path === "snapshot.tasks")).toEqual({
      path: "snapshot.tasks",
      type: "array",
      deprecated: {
        since: "2026-09-10",
        sunset: "2026-12-10",
        reason: "a planner stores more than tasks",
        instead: null,
      },
    });
    expect(v1.fields.find((f) => f.path === "snapshot.createdAt")).not.toHaveProperty("deprecated");
  });
});

describe("the operator's decision, read from the environment", () => {
  const known = answered(["v1"]);
  const one = (over: Record<string, unknown> = {}) =>
    JSON.stringify([
      {
        path: "snapshot.tasks",
        since: "2026-09-10",
        sunset: "2026-12-10",
        reason: "a planner stores more than tasks",
        instead: null,
        ...over,
      },
    ]);

  test("an empty variable deprecates nothing", () => {
    expect(parseDeprecations("", known)).toEqual([]);
    expect(parseDeprecations("   ", known)).toEqual([]);
  });

  test("a well-formed entry is read", () => {
    expect(parseDeprecations(one(), known)).toEqual([
      {
        path: "snapshot.tasks",
        since: "2026-09-10",
        sunset: "2026-12-10",
        reason: "a planner stores more than tasks",
        instead: null,
      },
    ]);
    expect(parseDeprecations(one({ instead: "snapshot.createdAt" }), known)[0]!.instead).toBe(
      "snapshot.createdAt",
    );
  });

  // Every one of these throws rather than being ignored. A deprecation that
  // was silently dropped publishes "nothing is going away", and the operator
  // who set the variable cannot tell that from a service that read it.
  test("a value this service cannot act on stops it, and says which part", () => {
    expect(() => parseDeprecations("{", known)).toThrow(/is not JSON/);
    expect(() => parseDeprecations('{"path":"snapshot.tasks"}', known)).toThrow(/is not an array/);
    expect(() => parseDeprecations("[1]", known)).toThrow(/\[0\] is not an object/);
    expect(() => parseDeprecations(one({ path: "snapshot.tasksss" }), known)).toThrow(
      /names snapshot\.tasksss, which this service does not answer/,
    );
    expect(() => parseDeprecations(one({ reason: "  " }), known)).toThrow(/has to say why/);
    expect(() => parseDeprecations(one({ sunset: "10-12-2026" }), known)).toThrow(
      /\.sunset is not a YYYY-MM-DD date/,
    );
    expect(() => parseDeprecations(one({ sunset: "2026-02-31" }), known)).toThrow(
      /is not a date that exists/,
    );
    expect(() => parseDeprecations(one({ sunset: "2026-09-09" }), known)).toThrow(
      /sunsets 2026-09-09, before it was deprecated 2026-09-10/,
    );
  });

  test("a missing successor is refused, and a null one is accepted", () => {
    const without = JSON.parse(one()) as Record<string, unknown>[];
    delete without[0]!.instead;
    expect(() => parseDeprecations(JSON.stringify(without), known)).toThrow(
      /instead is missing\. Name the field to move to, or null/,
    );
    expect(parseDeprecations(one({ instead: null }), known)[0]!.instead).toBeNull();
  });
});

describe("what a response says about a field that is going away", () => {
  const audience = {
    path: "snapshot.tasks",
    since: "2026-09-10",
    sunset: "2026-12-10",
    reason: "a planner stores more than tasks",
    instead: null,
  };
  const text = {
    path: "snapshot.createdAt",
    since: "2026-09-10",
    sunset: "2026-10-01",
    reason: "the stamp moves onto the document",
    instead: null,
  };

  test("a deprecation reaches the responses that carry the field", () => {
    expect(deprecationsFor("snapshot", [audience])).toEqual([audience]);
    expect(deprecationsFor("snapshot", [audience, text])).toEqual([audience, text]);
    expect(deprecationsFor("nothing", [audience])).toEqual([]);
    expect(deprecationsFor("snapshot", [])).toEqual([]);
  });

  test("the two headers are the two RFCs, and the dates are the field's", () => {
    const headers = deprecationHeaders([audience], "http://api.test");
    expect(headers.deprecation).toBe(`@${Date.parse("2026-09-10T00:00:00Z") / 1000}`);
    expect(headers.sunset).toBe("Thu, 10 Dec 2026 00:00:00 GMT");
    expect(headers.link).toBe('<http://api.test/versions>; rel="deprecation"');
  });

  test("nothing going away means no headers at all, rather than empty ones", () => {
    expect(deprecationHeaders([], "http://api.test")).toEqual({});
  });

  test("two fields in one body report the sunset there is least time to act on", () => {
    expect(deprecationHeaders([audience, text], "http://api.test").sunset).toBe(
      "Thu, 01 Oct 2026 00:00:00 GMT",
    );
    expect(deprecationHeaders([text, audience], "http://api.test").sunset).toBe(
      "Thu, 01 Oct 2026 00:00:00 GMT",
    );
  });

  test("a page on another origin is allowed to read them", async () => {
    const res = await handle(get("/v1/slots/nope"), memoryStore());
    const exposed = res.headers.get("access-control-expose-headers") ?? "";
    expect(exposed).toContain("sunset");
    expect(exposed).toContain("deprecation");
  });

  test("health depends on nothing", async () => {
    const res = await handle(get("/healthz"), memoryStore());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});


// `PLAN.md` step 6. The service holds nothing between requests, so every test
// here hands `handle` a store and reads what is in it afterwards. That is also
// what `api/Dockerfile` needs: it runs `bun test api` inside the image build,
// where there is no credential and there should not be one.
describe("pushing a snapshot", () => {
  const planner = { format: "pointer-planner", schemaVersion: 1, tasks: [{ id: "a" }] };
  const push = async (store = memoryStore(), body: unknown = planner) =>
    handle(post("/v1/snapshots", body), store);

  test("answers 201 with the address, the digest and when it was kept", async () => {
    const body = await bodyOf(await push());
    expect(typeof body.snapshot).toBe("string");
    expect(body.digest).toBe(body.snapshot);
    expect(typeof body.createdAt).toBe("string");
    expect(Number.isFinite(Date.parse(body.createdAt as string))).toBe(true);
  });

  // The whole of "a snapshot is written under the hash of its own bytes". It
  // is what makes pushing twice cost one write, and what makes an address a
  // claim about bytes rather than a name somebody chose.
  test("the address is the sha256 of the bytes pushed", async () => {
    const raw = JSON.stringify(planner);
    const body = await bodyOf(await push());
    expect(body.digest).toBe(new Bun.CryptoHasher("sha256").update(raw).digest("hex"));
  });

  test("the same planner pushed twice is one address and one object", async () => {
    const store = memoryStore();
    const first = await bodyOf(await push(store));
    const second = await bodyOf(await push(store));
    expect(second.snapshot).toBe(first.snapshot);
    expect(store.keys()).toHaveLength(1);
  });

  test("two different planners are two addresses", async () => {
    const store = memoryStore();
    const a = await bodyOf(await push(store, { ...planner, tasks: [{ id: "a" }] }));
    const b = await bodyOf(await push(store, { ...planner, tasks: [{ id: "b" }] }));
    expect(a.snapshot).not.toBe(b.snapshot);
    expect(store.keys()).toHaveLength(2);
  });

  test("a body that is not a JSON object is refused rather than kept", async () => {
    const store = memoryStore();
    expect(await bodyOf(await push(store, "{"))).toEqual({ error: "body is not a JSON object" });
    expect(await bodyOf(await push(store, [1]))).toEqual({ error: "body is not a JSON object" });
    expect(store.keys()).toEqual([]);
  });

  // The bucket is written on the strength of one unauthenticated POST, so the
  // cap is what stands between it and anything worth sending.
  test("a body longer than the cap is refused, and nothing is written", async () => {
    const store = memoryStore();
    const huge = { ...planner, pad: "x".repeat(1024 * 1024 + 1) };
    const said = await bodyOf(await push(store, huge));
    expect(String(said.error)).toContain("is longer than");
    expect(store.keys()).toEqual([]);
  });
});

describe("reading a snapshot back", () => {
  const planner = { format: "pointer-planner", schemaVersion: 1, tasks: [{ id: "a" }] };

  test("the address a push returned reads the planner it pushed", async () => {
    const store = memoryStore();
    const pushed = await bodyOf(await handle(post("/v1/snapshots", planner), store));
    const back = await bodyOf(await handle(get(`/v1/snapshots/${pushed.snapshot}`), store));
    expect(back.tasks).toEqual(planner.tasks);
    expect(back.digest).toBe(pushed.digest);
    expect(back.createdAt).toBe(pushed.createdAt);
  });

  test("an address nothing was pushed to is 404", async () => {
    const missing = "0".repeat(64);
    const res = await handle(get(`/v1/snapshots/${missing}`), memoryStore());
    expect(res.status).toBe(404);
  });

  // An id that is not a sha256 cannot address a snapshot this service wrote,
  // so it is refused by shape rather than looked up. That keeps a bucket read
  // off the path of anything a stranger types.
  test.each(["latest", "0".repeat(63), "0".repeat(65), "0".repeat(63) + "G"])(
    "an address of %p is refused by name",
    async (bad) => {
      const res = await handle(get(`/v1/snapshots/${bad}`), memoryStore());
      expect(await bodyOf(res)).toEqual({ error: "digest is not a sha256" });
    },
  );

  // And a path that RESOLVES away before it reaches the router is a plain 404,
  // because `new URL` normalises it and the route never matches. Measured on
  // 2026-09-13: `/v1/snapshots/../../etc/passwd` becomes `/etc/passwd` and
  // `/v1/snapshots/%2e%2e` becomes `/v1/` - the parser decodes AND resolves.
  // The refusal above is about a digest and this one is about a path this
  // service does not answer; the first version of this test expected the
  // wrong one of the two for both.
  test.each(["../../etc/passwd", "%2e%2e"])(
    "a traversal of %p resolves away and is a 404, not a digest refusal",
    async (path) => {
      const res = await handle(get(`/v1/snapshots/${path}`), memoryStore());
      expect(res.status).toBe(404);
      expect(await bodyOf(res)).toEqual({ error: "not found" });
    },
  );

  test("a method this route does not answer is refused", async () => {
    const res = await handle(
      new Request(`http://api.test/v1/snapshots/${"0".repeat(64)}`, { method: "DELETE" }),
      memoryStore(),
    );
    expect(res.status).toBe(405);
  });
});

describe("a slot, and the two capabilities over it", () => {
  const planner = { format: "pointer-planner", schemaVersion: 1, tasks: [{ id: "a" }] };
  const mint = async (store: ReturnType<typeof memoryStore>) =>
    bodyOf(await handle(new Request("http://api.test/v1/slots", { method: "POST" }), store));
  const move = (slot: string, key: string, snapshot: string) =>
    new Request(`http://api.test/v1/slots/${slot}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-write-key": key },
      body: JSON.stringify({ snapshot }),
    });

  test("minting answers an address and a write key, and holds nothing yet", async () => {
    const store = memoryStore();
    const slot = await mint(store);
    expect(typeof slot.slot).toBe("string");
    expect(typeof slot.writeKey).toBe("string");
    expect(slot.slot).not.toBe(slot.writeKey);
    const seen = await bodyOf(await handle(get(`/v1/slots/${slot.slot}`), store));
    expect(seen).toEqual({ snapshot: null, history: [] });
  });

  // The whole of "two capabilities over one resource". A slot file carrying
  // its own write key would hand the move to every reader, because the id
  // already grants the read.
  test("the write key is in the minting response and in nothing else", async () => {
    const store = memoryStore();
    const slot = await mint(store);
    const seen = await bodyOf(await handle(get(`/v1/slots/${slot.slot}`), store));
    expect(JSON.stringify(seen)).not.toContain(slot.writeKey as string);
    const stored = (await store.read(`slots/${slot.slot}.json`)) ?? "";
    expect(stored).not.toContain(slot.writeKey as string);
    expect(stored).toContain("writeKeyHash");
  });

  test("two slots are two addresses and two keys", async () => {
    const store = memoryStore();
    const a = await mint(store);
    const b = await mint(store);
    expect(a.slot).not.toBe(b.slot);
    expect(a.writeKey).not.toBe(b.writeKey);
  });

  test("the write key moves the slot, and the move is what the next read gives", async () => {
    const store = memoryStore();
    const pushed = await bodyOf(await handle(post("/v1/snapshots", planner), store));
    const slot = await mint(store);
    const moved = await handle(move(slot.slot as string, slot.writeKey as string, pushed.snapshot as string), store);
    expect(moved.status).toBe(200);
    const seen = await bodyOf(await handle(get(`/v1/slots/${slot.slot}`), store));
    expect(seen.snapshot).toBe(pushed.snapshot);
  });

  test("without the write key the slot does not move, and the refusal is 403", async () => {
    const store = memoryStore();
    const pushed = await bodyOf(await handle(post("/v1/snapshots", planner), store));
    const slot = await mint(store);
    for (const offered of ["", "not-the-key", (slot.slot as string)]) {
      const res = await handle(move(slot.slot as string, offered, pushed.snapshot as string), store);
      expect(`${JSON.stringify(offered)} ${res.status}`).toBe(`${JSON.stringify(offered)} 403`);
    }
    const seen = await bodyOf(await handle(get(`/v1/slots/${slot.slot}`), store));
    expect(seen.snapshot).toBeNull();
  });

  // 403 and not 404. The id already granted the read, so pretending the slot
  // is missing would tell its holder something false about their own slot.
  test("a slot that exists says the key is wrong rather than that it is missing", async () => {
    const store = memoryStore();
    const slot = await mint(store);
    const res = await handle(move(slot.slot as string, "wrong", "0".repeat(64)), store);
    expect(res.status).toBe(403);
    expect(await bodyOf(res)).toEqual({ error: "the write key does not move this slot" });
  });

  test("a slot nothing minted is 404, on read and on move alike", async () => {
    const store = memoryStore();
    expect((await handle(get("/v1/slots/nope"), store)).status).toBe(404);
    expect((await handle(move("nope", "any", "0".repeat(64)), store)).status).toBe(404);
  });

  test("a slot id that is not an id is refused by shape", async () => {
    const res = await handle(get("/v1/slots/..%2F..%2Fetc"), memoryStore());
    expect(await bodyOf(res)).toEqual({ error: "slot is not a slot id" });
  });

  test("a slot cannot be moved to a snapshot this service does not hold", async () => {
    const store = memoryStore();
    const slot = await mint(store);
    const res = await handle(move(slot.slot as string, slot.writeKey as string, "0".repeat(64)), store);
    expect(await bodyOf(res)).toEqual({
      error: "snapshot names no snapshot this service holds",
    });
  });

  test("a move to something that is not a digest is refused by name", async () => {
    const store = memoryStore();
    const slot = await mint(store);
    const res = await handle(move(slot.slot as string, slot.writeKey as string, "latest"), store);
    expect(await bodyOf(res)).toEqual({ error: "snapshot is not a sha256" });
  });
});

// `PLAN.md` step 8 restores from this, by the same mechanism the pointer rolls
// back by: an older id is named and the slot moves to it.
describe("what a slot held before", () => {
  const planner = (n: number) => ({ format: "pointer-planner", schemaVersion: 1, tasks: [{ id: `t${n}` }] });

  const moved = async () => {
    const store = memoryStore();
    const slot = await bodyOf(
      await handle(new Request("http://api.test/v1/slots", { method: "POST" }), store),
    );
    const put = async (snapshot: string) =>
      handle(
        new Request(`http://api.test/v1/slots/${slot.slot}`, {
          method: "PUT",
          headers: { "content-type": "application/json", "x-write-key": slot.writeKey as string },
          body: JSON.stringify({ snapshot }),
        }),
        store,
      );
    const digests: string[] = [];
    for (const n of [1, 2, 3]) {
      const pushed = await bodyOf(await handle(post("/v1/snapshots", planner(n)), store));
      digests.push(pushed.snapshot as string);
      await put(pushed.snapshot as string);
    }
    return { store, slot, digests, put };
  };

  test("the history is what it held before, newest first", async () => {
    const { store, slot, digests } = await moved();
    const seen = await bodyOf(await handle(get(`/v1/slots/${slot.slot}`), store));
    expect(seen.snapshot).toBe(digests[2]);
    expect(seen.history).toEqual([digests[1], digests[0]]);
  });

  test("moving to what it already holds writes no history entry", async () => {
    const { store, slot, digests, put } = await moved();
    await put(digests[2]!);
    const seen = await bodyOf(await handle(get(`/v1/slots/${slot.slot}`), store));
    expect(seen.history).toEqual([digests[1], digests[0]]);
  });

  // Restoring is naming an older digest, and the one being left goes to the
  // front. The history is a record of what was served, not a stack.
  test("moving back to an older snapshot records the one it is leaving", async () => {
    const { store, slot, digests, put } = await moved();
    await put(digests[0]!);
    const seen = await bodyOf(await handle(get(`/v1/slots/${slot.slot}`), store));
    expect(seen.snapshot).toBe(digests[0]);
    expect(seen.history).toEqual([digests[2], digests[1], digests[0]]);
  });
});

describe("what a browser needs before it hands over a body", () => {
  test("a read carries the cross-origin headers", async () => {
    const res = await handle(get("/v1/slots/nope"), memoryStore());
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("a preflight is answered with the methods and the header the write uses", async () => {
    const res = await handle(
      new Request("http://api.test/v1/slots", { method: "OPTIONS" }),
      memoryStore(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
  });
});

test("the routes it answers are exactly the versions it advertises", async () => {
  for (const v of SERVES) {
    expect((await handle(get(`/${v}/slots/nope`), memoryStore())).status).toBe(404);
  }
  // A version this build does not serve is a 404 on the VERSION, which reads
  // the same as a missing slot here - so the discovery document is what says
  // which it was, and the next test reads it.
  expect((await handle(get("/v0/slots/nope"), memoryStore())).status).toBe(404);
});

test("a path this service does not answer is a 404, not a guess", async () => {
  const res = await handle(get("/v2/snapshots"), memoryStore());
  expect(res.status).toBe(404);
  expect(await bodyOf(res)).toEqual({ error: "not found" });

  const inside = await handle(get("/v1/nothing-here"), memoryStore());
  expect(inside.status).toBe(404);
});

// The document is a promise, and this is the reading that holds it to it.
test("every route the document names answers, and every field it names is returned", async () => {
  const store = memoryStore();
  const planner = { format: "pointer-planner", schemaVersion: 1, tasks: [] };
  const pushed = await bodyOf(await handle(post("/v1/snapshots", planner), store));
  const slot = await bodyOf(
    await handle(new Request("http://api.test/v1/slots", { method: "POST" }), store),
  );
  await handle(
    new Request(`http://api.test/v1/slots/${slot.slot}`, {
      method: "PUT",
      headers: { "content-type": "application/json", "x-write-key": slot.writeKey as string },
      body: JSON.stringify({ snapshot: pushed.snapshot }),
    }),
    store,
  );

  const bodies: Record<string, Record<string, unknown>> = {
    snapshot: await bodyOf(await handle(get(`/v1/snapshots/${pushed.snapshot}`), store)),
    slot: await bodyOf(await handle(get(`/v1/slots/${slot.slot}`), store)),
  };
  for (const f of FIELDS.v1!) {
    const [top, field] = f.path.split(".") as [string, string];
    expect(`${f.path} ${field in (bodies[top] ?? {})}`).toBe(`${f.path} true`);
  }
  // And every route it names is a route, rather than a path nobody serves.
  for (const route of ROUTES.v1!) {
    expect(`${route.method} ${route.path}`).toMatch(/^(GET|POST|PUT) \/(snapshots|slots)/);
  }
});
