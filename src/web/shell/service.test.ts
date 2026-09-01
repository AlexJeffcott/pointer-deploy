import { describe, expect, test } from "bun:test";
import { createStore } from "./api.ts";
import {
  API_VERSION,
  awaiting,
  createClient,
  hydrate,
  noteSunset,
  parseCounters,
  parseDiscovery,
  parseFlags,
  parseLabels,
  parseLimits,
  parseMotd,
  parseStats,
  parseUser,
  readService,
  readSettings,
  serviceBacked,
  type ServiceClient,
} from "./service.ts";

const THEME = { colour: "#1f5fd0", dark: false };
const SAM = { name: "Sam", colour: "#abcdef", initials: "SM", theme: THEME };
const ALEX = { name: "Alex", colour: "#1f5fd0", initials: "AJ", theme: THEME };

const SETTINGS = {
  limits: { step: 5, max: 100, allowNegative: true },
  labels: { alpha: { title: "Alpha", emoji: "A" } },
  flags: { showShares: true, showTotals: true, compact: false },
  stats: { total: 0, busiest: null, updatedAt: "2026-08-31T00:00:00.000Z" },
  motd: null,
};

const rejects = (parse: (input: unknown) => unknown, input: unknown, field: string) => {
  const path = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(() => parse(input)).toThrow(new RegExp(`^api field ${path} `));
};

describe("what the service sends is checked, not assumed", () => {
  test("a user with every field is accepted", () => {
    expect(parseUser(ALEX)).toEqual(ALEX);
  });

  // The rule the whole boundary turns on: required is what the page cannot
  // draw without, and everything the service grew later is optional.
  test("a user from a service that predates the newer fields is accepted", () => {
    expect(parseUser({ name: "Alex", colour: "#1f5fd0" })).toEqual({
      name: "Alex",
      colour: "#1f5fd0",
      initials: "",
      theme: { colour: "#1f5fd0", dark: false },
    });
  });

  test("a newer field that is present and wrong is still refused", () => {
    rejects(parseUser, { name: "A", colour: "#fff", initials: 7 }, "user.initials");
    rejects(parseUser, { name: "A", colour: "#fff", theme: 7 }, "user.theme");
    rejects(parseUser, { name: "A", colour: "#fff", theme: { dark: "yes" } }, "user.theme.dark");
  });

  test("a user missing a field is rejected, by field", () => {
    rejects(parseUser, { colour: "#1f5fd0" }, "user.name");
    rejects(parseUser, { name: "Alex" }, "user.colour");
    rejects(parseUser, { name: "", colour: "#1f5fd0" }, "user.name");
    rejects(parseUser, { name: 42, colour: "#1f5fd0" }, "user.name");
  });

  test("a body that is not an object is rejected", () => {
    rejects(parseUser, null, "user");
    rejects(parseUser, [], "user");
    rejects(parseUser, "<!doctype html>", "user");
  });

  test("counters are accepted as a map of numbers", () => {
    expect(parseCounters({ alpha: 3, bravo: 0 })).toEqual({ alpha: 3, bravo: 0 });
    expect(parseCounters({})).toEqual({});
  });

  test("a count that is not a finite number is rejected, by namespace", () => {
    rejects(parseCounters, { alpha: "3" }, "counters.alpha");
    rejects(parseCounters, { alpha: 1, bravo: null }, "counters.bravo");
  });
});

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

  test("reads the user and the counters from the version this shell knows", async () => {
    const s = spy((path) =>
      path.endsWith("/user") ? ok(SAM) : ok({ alpha: 2 }),
    );
    const client = createClient("https://api.test", { fetchImpl: s.fetchImpl });

    expect(await client.user()).toEqual(SAM);
    expect(await client.counters()).toEqual({ alpha: 2 });
    expect(s.calls.map((c) => c.path)).toEqual([`/${API_VERSION}/user`, `/${API_VERSION}/counters`]);
  });

  test("a trailing slash on the base does not double the one in the path", async () => {
    const s = spy(() => ok(SAM));
    await createClient("https://api.test/", { fetchImpl: s.fetchImpl }).user();
    expect(s.calls[0]!.path).toBe(`/${API_VERSION}/user`);
  });

  test("a namespace with characters a path cannot carry is encoded", async () => {
    const s = spy(() => ok({ "one two": 1 }));
    await createClient("https://api.test", { fetchImpl: s.fetchImpl }).writeCounter("one two", {});
    expect(s.calls[0]!.path).toBe(`/${API_VERSION}/counters/one%20two`);
    expect(s.calls[0]!.init?.method).toBe("POST");
  });

  test("a status the service refuses with is reported as the status", async () => {
    const s = spy(() => Response.json({ error: "not found" }, { status: 404 }));
    await expect(createClient("https://api.test", { fetchImpl: s.fetchImpl }).user()).rejects.toThrow(
      /responded 404/,
    );
  });

  test("a body that is not the shape this shell knows is reported as the field", async () => {
    const s = spy(() => ok({ nom: "Sam" }));
    await expect(createClient("https://api.test", { fetchImpl: s.fetchImpl }).user()).rejects.toThrow(
      /^api field user\.name /,
    );
  });
});

describe("filling the store from the service", () => {
  const client = (over: Partial<ServiceClient> = {}): ServiceClient => ({
    user: async () => SAM,
    counters: async () => ({ alpha: 3, bravo: 0 }),
    setUser: async (p) => ({ ...SAM, ...p }),
    writeCounter: async () => ({}),
    limits: async () => SETTINGS.limits,
    labels: async () => SETTINGS.labels,
    flags: async () => SETTINGS.flags,
    stats: async () => SETTINGS.stats,
    motd: async () => SETTINGS.motd,
    discovery: async () => ({ serves: [API_VERSION], versions: null }),
    lastSunset: () => null,
    ...over,
  });

  test("the page shows what the service holds", async () => {
    const store = createStore();
    expect(await hydrate(store, client())).toBe("ok");
    expect(store.user()).toEqual(SAM);
    expect(store.countOf("alpha")).toBe(3);
    expect(store.snapshot()).toEqual([
      ["alpha", 3],
      ["bravo", 0],
    ]);
  });

  test("a service that cannot be reached leaves the defaults and names the fault", async () => {
    const store = createStore();
    const said = await hydrate(
      store,
      client({
        user: async () => {
          throw new Error("Unable to connect");
        },
      }),
    );
    expect(said).toBe("Unable to connect");
    expect(store.user().name).toBe("Alex");
    expect(store.snapshot()).toEqual([]);
  });

  test("a response this shell cannot read names the field, not the service", async () => {
    const store = createStore();
    const said = await hydrate(
      store,
      client({
        counters: async () => parseCounters({ alpha: "3" }),
      }),
    );
    expect(said).toMatch(/^api field counters\.alpha /);
  });
});

describe("the store, with every write sent on", () => {
  const record = () => {
    const sent: string[] = [];
    const client: ServiceClient = {
      user: async () => ALEX,
      counters: async () => ({}),
      setUser: async (patch) => {
        sent.push(`user ${JSON.stringify(patch)}`);
        return { ...ALEX, ...patch };
      },
      writeCounter: async (ns, body) => {
        sent.push(`${ns} ${JSON.stringify(body)}`);
        return {};
      },
      limits: async () => SETTINGS.limits,
      labels: async () => SETTINGS.labels,
      flags: async () => SETTINGS.flags,
      stats: async () => SETTINGS.stats,
      motd: async () => SETTINGS.motd,
      discovery: async () => ({ serves: [API_VERSION], versions: null }),
      lastSunset: () => null,
    };
    return { sent, client };
  };

  const errors: string[] = [];
  const backed = () => {
    const r = record();
    const store = createStore();
    return { ...r, store, wrapped: serviceBacked(store, r.client, (m) => errors.push(m)) };
  };

  test("a write lands locally at once and is sent on", async () => {
    const b = backed();
    b.wrapped.setName("Sam");
    b.wrapped.setColour("#abcdef");
    b.wrapped.register("alpha");
    b.wrapped.increment("alpha", 4);
    b.wrapped.reset("alpha");

    expect(b.store.user()).toMatchObject({ name: "Sam", colour: "#abcdef" });
    expect(b.store.countOf("alpha")).toBe(0);

    await Bun.sleep(1);
    expect(b.sent).toEqual([
      'user {"name":"Sam"}',
      'user {"colour":"#abcdef"}',
      'alpha {"register":true}',
      'alpha {"by":4}',
      'alpha {"reset":true}',
    ]);
  });

  test("an increment with no amount is sent as one", async () => {
    const b = backed();
    b.wrapped.increment("alpha");
    await Bun.sleep(1);
    expect(b.sent).toEqual(['alpha {"by":1}']);
  });

  test("reads go to the store and nowhere else", async () => {
    const b = backed();
    b.wrapped.increment("alpha", 2);
    expect(b.wrapped.countOf("alpha")).toBe(2);
    expect(b.wrapped.snapshot()).toEqual([["alpha", 2]]);
    expect(b.wrapped.user()).toEqual(ALEX);
    await Bun.sleep(1);
    expect(b.sent).toEqual(['alpha {"by":2}']);
  });

  test("a write the service refuses is reported, and the page keeps the value", async () => {
    const store = createStore();
    const said: string[] = [];
    const wrapped = serviceBacked(
      store,
      {
        user: async () => ALEX,
        counters: async () => ({}),
        setUser: async () => {
          throw new Error("POST /v1/user responded 400");
        },
        writeCounter: async () => {
          throw new Error("Unable to connect");
        },
        limits: async () => SETTINGS.limits,
        labels: async () => SETTINGS.labels,
        flags: async () => SETTINGS.flags,
        stats: async () => SETTINGS.stats,
        motd: async () => SETTINGS.motd,
        discovery: async () => ({ serves: [API_VERSION], versions: null }),
        lastSunset: () => null,
      },
      (m) => said.push(m),
    );

    wrapped.setName("Sam");
    wrapped.increment("alpha");
    await Bun.sleep(1);

    expect(said).toEqual(["POST /v1/user responded 400", "Unable to connect"]);
    expect(store.user().name).toBe("Sam");
    expect(store.countOf("alpha")).toBe(1);
  });
});

describe("what the service says it holds, §26", () => {
  const client = (over: Partial<ServiceClient> = {}): ServiceClient => ({
    user: async () => SAM,
    counters: async () => ({}),
    setUser: async () => SAM,
    writeCounter: async () => ({}),
    limits: async () => SETTINGS.limits,
    labels: async () => SETTINGS.labels,
    flags: async () => SETTINGS.flags,
    stats: async () => SETTINGS.stats,
    motd: async () => SETTINGS.motd,
    discovery: async () => ({ serves: [API_VERSION], versions: null }),
    lastSunset: () => null,
    ...over,
  });

  const doc = (over: Record<string, unknown> = {}) => ({
    serves: ["v1"],
    versions: {
      v1: {
        routes: [{ method: "GET", path: "/v1/user" }],
        fields: [
          { path: "user.name", type: "string" },
          {
            path: "user.colour",
            type: "string",
            deprecated: {
              since: "2026-08-31",
              sunset: "2026-11-30",
              reason: "the colour moves into a theme",
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
    expect(read.versions!.v1!.fields.map((f) => f.path)).toEqual(["user.name", "user.colour"]);
    expect(read.versions!.v1!.fields[0]!.going).toBeNull();
    expect(read.versions!.v1!.fields[1]!.going).toEqual({
      since: "2026-08-31",
      sunset: "2026-11-30",
      reason: "the colour moves into a theme",
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

    expect(await readService(store, client({ discovery: async () => parseDiscovery(doc()) }))).toBe(
      "ok",
    );
    const report = store.service();
    expect(report.state).toBe("ok");
    expect(report.base).toBe("https://api.test");
    expect(report.calling).toBe(API_VERSION);
    expect(report.serves).toEqual(["v1"]);
    expect(report.readAt).not.toBeNull();
    expect(store.goingAway("user.colour")?.sunset).toBe("2026-11-30");
    expect(store.goingAway("user.name")).toBeNull();
    expect(store.goingAway("user.nothing")).toBeNull();
  });

  test("a service that does not answer leaves the fault on the report, not on the page", async () => {
    const store = createStore();
    store.setService(awaiting("https://api.test"));
    const said = await readService(
      store,
      client({
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
      client({ discovery: async () => ({ serves: ["v9"], versions: { v9: { routes: [], fields: [] } } }) }),
    );
    expect(store.service().state).toBe("ok");
    expect(store.service().serves).toEqual(["v9"]);
    expect(store.service().fields).toEqual([]);
  });

  test("the Sunset a data response carried is folded in, once", () => {
    const store = createStore();
    const c = client({ lastSunset: () => "Mon, 30 Nov 2026 00:00:00 GMT" });
    noteSunset(store, c);
    expect(store.service().headerSunset).toBe("Mon, 30 Nov 2026 00:00:00 GMT");
    const before = store.service();
    noteSunset(store, c);
    expect(store.service()).toBe(before);
  });

  test("the client reads the document from the root, and remembers the Sunset", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(new URL(url).pathname);
      if (new URL(url).pathname === "/versions") return Response.json({ serves: ["v1"] });
      return Response.json(
        SAM,
        { headers: { sunset: "Mon, 30 Nov 2026 00:00:00 GMT" } },
      );
    }) as unknown as typeof fetch;

    const c = createClient("https://api.test", { fetchImpl });
    expect(c.lastSunset()).toBeNull();
    expect(await c.discovery()).toEqual({ serves: ["v1"], versions: null });
    expect(seen).toEqual(["/versions"]);
    await c.user();
    expect(c.lastSunset()).toBe("Mon, 30 Nov 2026 00:00:00 GMT");
  });
});

describe("the rest of what the service offers, §27", () => {
  const client = (over: Partial<ServiceClient> = {}): ServiceClient => ({
    user: async () => SAM,
    counters: async () => ({}),
    setUser: async () => SAM,
    writeCounter: async () => ({}),
    limits: async () => SETTINGS.limits,
    labels: async () => SETTINGS.labels,
    flags: async () => SETTINGS.flags,
    stats: async () => SETTINGS.stats,
    motd: async () => SETTINGS.motd,
    discovery: async () => ({ serves: [API_VERSION], versions: null }),
    lastSunset: () => null,
    ...over,
  });

  test("each shape is read, and each is refused by field", () => {
    expect(parseLimits({ step: 5, max: 100, allowNegative: true })).toEqual(SETTINGS.limits);
    rejects(parseLimits, { step: "5", max: 100, allowNegative: true }, "limits.step");
    rejects(parseLimits, { step: 5, max: 100 }, "limits.allowNegative");

    expect(parseLabels({ a: { title: "A", emoji: "" } })).toEqual({ a: { title: "A", emoji: "" } });
    rejects(parseLabels, { a: "A" }, "labels.a");
    rejects(parseLabels, { a: { title: 1, emoji: "" } }, "labels.a.title");
    rejects(parseLabels, { a: { title: "A", emoji: 1 } }, "labels.a.emoji");

    expect(parseFlags(SETTINGS.flags)).toEqual(SETTINGS.flags);
    rejects(parseFlags, { showShares: "yes", showTotals: true, compact: false }, "flags.showShares");

    expect(parseStats({ total: 3, busiest: "alpha", updatedAt: "t" })).toEqual({
      total: 3,
      busiest: "alpha",
      updatedAt: "t",
    });
    expect(parseStats({ total: 0, busiest: null, updatedAt: "t" }).busiest).toBeNull();
    rejects(parseStats, { total: 0, busiest: 7, updatedAt: "t" }, "stats.busiest");

    expect(parseMotd(null)).toBeNull();
    expect(parseMotd({ text: "x", level: "warn", until: "2026-12-01" })).toEqual({
      text: "x",
      level: "warn",
      until: "2026-12-01",
    });
    rejects(parseMotd, { text: "x", level: "loud", until: "2026-12-01" }, "motd.level");
  });

  // An empty emoji is the service saying it holds none, not a broken response.
  test("an empty emoji is a value, and an empty title is not", () => {
    expect(parseLabels({ a: { title: "A", emoji: "" } }).a!.emoji).toBe("");
    rejects(parseLabels, { a: { title: "", emoji: "x" } }, "labels.a.title");
  });

  test("a read fills every one of them", async () => {
    const store = createStore();
    expect(await readSettings(store, client())).toEqual([]);
    expect(store.limits()).toEqual(SETTINGS.limits);
    expect(store.flags()).toEqual(SETTINGS.flags);
    expect(store.stats()).toEqual(SETTINGS.stats);
    expect(store.motd()).toBeNull();
    expect(store.labelFor("alpha")).toEqual({ title: "Alpha", emoji: "A" });
  });

  // The reading that lets the service grow a resource without breaking a shell
  // already published, and lets a new shell run against a service that has not
  // been given the resource yet.
  test("a resource an older service does not answer costs only that resource", async () => {
    const store = createStore();
    const missing = await readSettings(
      store,
      client({
        flags: async () => {
          throw new Error("GET /v1/flags responded 404");
        },
        motd: async () => {
          throw new Error("GET /v1/motd responded 404");
        },
      }),
    );
    expect(missing).toEqual(["flags", "motd"]);
    expect(store.limits()).toEqual(SETTINGS.limits);
    expect(store.stats()).toEqual(SETTINGS.stats);
    // Kept at the default, which is a value every panel can draw.
    expect(store.flags()).toEqual({ showShares: true, showTotals: true, compact: false });
  });

  test("a namespace the service holds no label for is drawn from its own name", () => {
    const store = createStore();
    expect(store.labelFor("zulu")).toEqual({ title: "zulu", emoji: "" });
  });

  test("the client asks for each one at the version this shell calls", async () => {
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      const { pathname } = new URL(url);
      seen.push(pathname);
      if (pathname.endsWith("/limits")) return Response.json(SETTINGS.limits);
      if (pathname.endsWith("/labels")) return Response.json(SETTINGS.labels);
      if (pathname.endsWith("/flags")) return Response.json(SETTINGS.flags);
      if (pathname.endsWith("/stats")) return Response.json(SETTINGS.stats);
      return Response.json(null);
    }) as unknown as typeof fetch;

    const c = createClient("https://api.test", { fetchImpl });
    await Promise.all([c.limits(), c.labels(), c.flags(), c.stats(), c.motd()]);
    expect(seen.sort()).toEqual(
      [`/${API_VERSION}/flags`, `/${API_VERSION}/labels`, `/${API_VERSION}/limits`, `/${API_VERSION}/motd`, `/${API_VERSION}/stats`].sort(),
    );
  });
});
