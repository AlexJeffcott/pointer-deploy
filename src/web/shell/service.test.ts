import { describe, expect, test } from "bun:test";
import { createStore } from "./api.ts";
import {
  API_VERSION,
  awaiting,
  createClient,
  noteSunset,
  parseDiscovery,
  readData,
  readService,
  type ServiceClient,
} from "./service.ts";

// What the version root answers with. The page keeps no field of it - the
// reading is that the version this shell CALLS answered at all - so its shape
// matters here only as something for the client to receive.
const VERSION_DOC = { routes: [], fields: [] };

const rejects = (parse: (input: unknown) => unknown, input: unknown, field: string) => {
  const path = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(() => parse(input)).toThrow(new RegExp(`^api field ${path} `));
};

describe("the client", () => {
  const spy = (answer: (path: string, init?: RequestInit) => Response) => {
    const calls: { path: string; init?: RequestInit }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      calls.push({ path: new URL(url).pathname, init });
      return answer(new URL(url).pathname, init);
    }) as unknown as typeof fetch;
    return { calls, fetchImpl };
  };

  const ok = (body: unknown) => Response.json(body);

  // The VERSION's own root, `PLAN.md` step 6. `greeting` was this route until
  // the service changed its subject, and what replaced it had to be a route
  // that answers without being given an id: snapshots and slots are both
  // addressed by one, so the reading had nothing else left to stand on.
  test("calls the data route at the version this shell was built against", async () => {
    const s = spy(() => ok({ routes: [], fields: [] }));
    const client = createClient("https://api.test", { fetchImpl: s.fetchImpl });

    await client.data();
    expect(s.calls.map((c) => c.path)).toEqual([`/${API_VERSION}`]);
  });

  test("a trailing slash on the base does not double the one in the path", async () => {
    const s = spy(() => ok({ routes: [], fields: [] }));
    await createClient("https://api.test/", { fetchImpl: s.fetchImpl }).data();
    expect(s.calls[0]!.path).toBe(`/${API_VERSION}`);
  });

  test("a status the service refuses with is reported as the status", async () => {
    const s = spy(() => Response.json({ error: "not found" }, { status: 404 }));
    await expect(
      createClient("https://api.test", { fetchImpl: s.fetchImpl }).data(),
    ).rejects.toThrow(/responded 404/);
  });

  // The reading is whether the version answers, and nothing about the shape of
  // what it answers with. This shell keeps no field of that body, so a body it
  // does not recognise is not a fault it can report - and reporting one put
  // `api field greeting.text is missing` on `data-api` for a service that was
  // answering v1 perfectly well.
  test("a body in a shape this shell does not know is still an answer", async () => {
    const s = spy(() => ok({ salutation: "Hello" }));
    await expect(
      createClient("https://api.test", { fetchImpl: s.fetchImpl }).data(),
    ).resolves.toBeUndefined();
  });

  // A truncated response is NOT an answer, which is why the body is still read
  // even though nothing is taken out of it.
  test("a response whose body never arrives is a fault", async () => {
    const s = spy(() => new Response("{", { headers: { "content-type": "application/json" } }));
    await expect(
      createClient("https://api.test", { fetchImpl: s.fetchImpl }).data(),
    ).rejects.toThrow();
  });
});

const stub = (over: Partial<ServiceClient> = {}): ServiceClient => ({
  data: async () => {},
  discovery: async () => ({ serves: [API_VERSION], versions: null }),
  // A stub that never pushes and never pulls, so a test that reaches either by
  // accident says so rather than quietly doing nothing. `PLAN.md` step 6 put
  // both on the client; `readData` and `readService` call neither.
  push: async () => {
    throw new Error("this stub pushes nothing");
  },
  pull: async () => {
    throw new Error("this stub pulls nothing");
  },
  lastSunset: () => null,
  ...over,
});

// The body is not kept: since `PLAN.md` step 0 no unit draws the service's
// greeting. What the call is for is the response - whether the version this
// shell CALLS answers, which `/versions` cannot say, and the `Sunset` header
// only a data response carries.
describe("the one data call the page makes", () => {
  test("a service that answers reports ok", async () => {
    expect(await readData(stub())).toBe("ok");
  });

  test("a service that cannot be reached names the fault rather than throwing", async () => {
    const said = await readData(
      stub({
        data: async () => {
          throw new Error("Unable to connect");
        },
      }),
    );
    expect(said).toBe("Unable to connect");
  });

  // The page's tasks are in this browser and the service holds none of them, so
  // a service that is not there costs the page a reading and not its contents.
  test("a service that is not there costs the planner nothing", async () => {
    const store = createStore();
    store.addTask("Book the ferry");
    await readData(
      stub({
        data: async () => {
          throw new Error("Unable to connect");
        },
      }),
    );
    expect(store.tasks().map((t) => t.title)).toEqual(["Book the ferry"]);
  });
});

describe("what the service says it holds, §26", () => {
  const doc = (over: Record<string, unknown> = {}) => ({
    serves: ["v1"],
    versions: {
      v1: {
        routes: [{ method: "GET", path: "/v1/greeting" }],
        fields: [
          { path: "greeting.text", type: "string" },
          {
            path: "greeting.audience",
            type: "string",
            deprecated: {
              since: "2026-09-10",
              sunset: "2026-12-10",
              reason: "the audience moves onto the visitor",
              instead: null,
            },
          },
        ],
      },
    },
    ...over,
  });

  test("the versions and the fields are read", () => {
    const read = parseDiscovery(doc());
    expect(read.serves).toEqual(["v1"]);
    expect(read.versions!.v1!.fields.map((f) => f.path)).toEqual([
      "greeting.text",
      "greeting.audience",
    ]);
    expect(read.versions!.v1!.fields[0]!.going).toBeNull();
    expect(read.versions!.v1!.fields[1]!.going).toEqual({
      since: "2026-09-10",
      sunset: "2026-12-10",
      reason: "the audience moves onto the visitor",
      instead: null,
    });
  });

  // The reading this whole shape exists for: the service is deployed on its own
  // schedule, so a shell has to survive both a document older than itself and
  // one newer than itself.
  test("a service that publishes no schema is read, not refused", () => {
    expect(parseDiscovery({ serves: ["v1"] })).toEqual({ serves: ["v1"], versions: null });
  });

  test("members this shell does not know are ignored", () => {
    const read = parseDiscovery(doc({ mint: "2026-09", versions: { v1: { fields: [], extra: 1 } } }));
    expect(read.serves).toEqual(["v1"]);
    expect(read.versions!.v1).toEqual({ routes: [], fields: [] });
  });

  test("a document this shell cannot read names the member", () => {
    rejects(parseDiscovery, { serves: "v1" }, "serves");
    rejects(parseDiscovery, { serves: [1] }, "serves[0]");
    rejects(parseDiscovery, { serves: [], versions: [] }, "versions");
    rejects(
      parseDiscovery,
      { serves: [], versions: { v1: { fields: [{ type: "string" }] } } },
      "versions.v1.fields[0].path",
    );
    rejects(
      parseDiscovery,
      { serves: [], versions: { v1: { fields: [{ path: "a", type: "b", deprecated: { sunset: "x" } }] } } },
      "versions.v1.fields[0].deprecated.since",
    );
  });

  test("a read fills the store, and a sub-app asks it by field", async () => {
    const store = createStore();
    store.setService(awaiting("https://api.test"));
    expect(store.service().state).toBe("unread");

    expect(await readService(store, stub({ discovery: async () => parseDiscovery(doc()) }))).toBe(
      "ok",
    );
    const report = store.service();
    expect(report.state).toBe("ok");
    expect(report.base).toBe("https://api.test");
    expect(report.calling).toBe(API_VERSION);
    expect(report.serves).toEqual(["v1"]);
    expect(report.readAt).not.toBeNull();
    expect(store.goingAway("greeting.audience")?.sunset).toBe("2026-12-10");
    expect(store.goingAway("greeting.text")).toBeNull();
    expect(store.goingAway("greeting.nothing")).toBeNull();
  });

  test("a service that does not answer leaves the fault on the report, not on the page", async () => {
    const store = createStore();
    store.setService(awaiting("https://api.test"));
    const said = await readService(
      store,
      stub({
        discovery: async () => {
          throw new Error("Unable to connect");
        },
      }),
    );
    expect(said).toBe("Unable to connect");
    expect(store.service().state).toBe("failed");
    expect(store.service().error).toBe("Unable to connect");
    expect(store.service().base).toBe("https://api.test");
  });

  test("a version this shell calls that the service does not publish leaves the fields empty", async () => {
    const store = createStore();
    store.setService(awaiting("https://api.test"));
    await readService(
      store,
      stub({ discovery: async () => ({ serves: ["v9"], versions: { v9: { routes: [], fields: [] } } }) }),
    );
    expect(store.service().state).toBe("ok");
    expect(store.service().serves).toEqual(["v9"]);
    expect(store.service().fields).toEqual([]);
  });

  test("the Sunset a data response carried is folded in, once", () => {
    const store = createStore();
    const c = stub({ lastSunset: () => "Thu, 10 Dec 2026 00:00:00 GMT" });
    noteSunset(store, c);
    expect(store.service().headerSunset).toBe("Thu, 10 Dec 2026 00:00:00 GMT");
    const before = store.service();
    noteSunset(store, c);
    expect(store.service()).toBe(before);
  });

  test("the client reads the document from the root, and remembers the Sunset", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(new URL(url).pathname);
      if (new URL(url).pathname === "/versions") return Response.json({ serves: ["v1"] });
      return Response.json(VERSION_DOC, { headers: { sunset: "Thu, 10 Dec 2026 00:00:00 GMT" } });
    }) as unknown as typeof fetch;

    const c = createClient("https://api.test", { fetchImpl });
    expect(c.lastSunset()).toBeNull();
    expect(await c.discovery()).toEqual({ serves: ["v1"], versions: null });
    expect(seen).toEqual(["/versions"]);
    await c.data();
    expect(c.lastSunset()).toBe("Thu, 10 Dec 2026 00:00:00 GMT");
  });
});

describe("pushing a planner and pulling one back, `PLAN.md` step 6", () => {
  const answer = (path: string, body: unknown, status = 200) => ({ path, body, status });
  const wired = (answers: ReturnType<typeof answer>[]) => {
    const sent: { path: string; method: string; body: string | null }[] = [];
    const fetchImpl = (async (url: string, init?: RequestInit) => {
      const path = new URL(url).pathname;
      sent.push({
        path,
        method: init?.method ?? "GET",
        body: typeof init?.body === "string" ? init.body : null,
      });
      const found = answers.find((a) => a.path === path);
      if (!found) return Response.json({ error: "not found" }, { status: 404 });
      return Response.json(found.body, { status: found.status });
    }) as unknown as typeof fetch;
    return { sent, client: createClient("https://api.test", { fetchImpl }) };
  };

  const kept = {
    snapshot: "a".repeat(64),
    digest: "a".repeat(64),
    createdAt: "2026-09-14T10:00:00.000Z",
    format: "pointer-planner",
    schemaVersion: 1,
    tasks: [{ id: "t1" }],
  };

  test("a push sends the bytes it was given, unchanged", async () => {
    const body = '{"format":"pointer-planner","schemaVersion":1,"tasks":[]}';
    const w = wired([answer(`/${API_VERSION}/snapshots`, kept, 201)]);
    await w.client.push(body);
    expect(w.sent).toEqual([
      { path: `/${API_VERSION}/snapshots`, method: "POST", body },
    ]);
  });

  test("a push returns the address and when the service kept it", async () => {
    const w = wired([answer(`/${API_VERSION}/snapshots`, kept, 201)]);
    expect(await w.client.push("{}")).toEqual({
      snapshot: kept.snapshot,
      createdAt: kept.createdAt,
    });
  });

  // The one member the page puts on screen for a person to copy into another
  // browser. A response with no address in it would otherwise draw "undefined"
  // as the thing to copy.
  test("a push whose answer carries no address is a fault", async () => {
    const w = wired([answer(`/${API_VERSION}/snapshots`, { createdAt: kept.createdAt }, 201)]);
    await expect(w.client.push("{}")).rejects.toThrow(/snapshot.snapshot/);
  });

  test("a pull rebuilds the document the rule reads", async () => {
    const w = wired([answer(`/${API_VERSION}/snapshots/${kept.digest}`, kept)]);
    expect(await w.client.pull(kept.digest)).toEqual({
      digest: kept.digest,
      document: {
        format: "pointer-planner",
        schemaVersion: 1,
        // The SERVICE's stamp. v1 does not answer with the `exportedAt` the
        // pushed document carried, so the honest value is when these bytes were
        // kept rather than a field this shell invented.
        exportedAt: kept.createdAt,
        tasks: [{ id: "t1" }],
      },
    });
  });

  // Nothing is checked on the way through, deliberately. A snapshot whose
  // `format` is "" is the service reporting a body that was never a planner,
  // and `readPlanner` is what names that field to a person - a parser here
  // would refuse it first with a sentence about an API field.
  test("a snapshot that was never a planner arrives as it is, to be refused by the door", async () => {
    const w = wired([
      answer(`/${API_VERSION}/snapshots/${kept.digest}`, {
        ...kept,
        format: "",
        schemaVersion: null,
        tasks: [],
      }),
    ]);
    const got = await w.client.pull(kept.digest);
    expect(got.document).toEqual({
      format: "",
      schemaVersion: null,
      exportedAt: kept.createdAt,
      tasks: [],
    });
  });

  test("an address the service holds nothing at carries the service's own sentence", async () => {
    const w = wired([]);
    await expect(w.client.pull(kept.digest)).rejects.toThrow(/404: not found/);
  });
});
