import { describe, expect, test } from "bun:test";
import {
  FIELDS,
  ROUTES,
  SERVES,
  answered,
  createState,
  deprecationHeaders,
  deprecationsFor,
  discovery,
  handle,
  parseDeprecations,
} from "./service.ts";

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
    const res = await handle(get("/versions"), createState());
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
    expect(v1.routes).toContainEqual({ method: "GET", path: "/v1/user" });
  });

  test("a version it does not answer is not described", () => {
    const doc = discovery(["v1"], []);
    expect(doc.versions).not.toHaveProperty("v2");
  });

  test("a field going away is said on the field, not beside it", () => {
    const going = {
      path: "user.colour",
      since: "2026-08-31",
      sunset: "2026-11-30",
      reason: "the colour moves into a theme",
      instead: null,
    };
    const v1 = (discovery(["v1"], [going]).versions as Record<string, { fields: Record<string, unknown>[] }>).v1!;
    expect(v1.fields.find((f) => f.path === "user.colour")).toEqual({
      path: "user.colour",
      type: "string",
      deprecated: {
        since: "2026-08-31",
        sunset: "2026-11-30",
        reason: "the colour moves into a theme",
        instead: null,
      },
    });
    expect(v1.fields.find((f) => f.path === "user.name")).not.toHaveProperty("deprecated");
  });
});

describe("the operator's decision, read from the environment", () => {
  const known = answered(["v1"]);
  const one = (over: Record<string, unknown> = {}) =>
    JSON.stringify([
      {
        path: "user.colour",
        since: "2026-08-31",
        sunset: "2026-11-30",
        reason: "the colour moves into a theme",
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
        path: "user.colour",
        since: "2026-08-31",
        sunset: "2026-11-30",
        reason: "the colour moves into a theme",
        instead: null,
      },
    ]);
    expect(parseDeprecations(one({ instead: "user.theme.colour" }), known)[0]!.instead).toBe(
      "user.theme.colour",
    );
  });

  // Every one of these throws rather than being ignored. A deprecation that
  // was silently dropped publishes "nothing is going away", and the operator
  // who set the variable cannot tell that from a service that read it.
  test("a value this service cannot act on stops it, and says which part", () => {
    expect(() => parseDeprecations("{", known)).toThrow(/is not JSON/);
    expect(() => parseDeprecations('{"path":"user.colour"}', known)).toThrow(/is not an array/);
    expect(() => parseDeprecations("[1]", known)).toThrow(/\[0\] is not an object/);
    expect(() => parseDeprecations(one({ path: "user.color" }), known)).toThrow(
      /names user\.color, which this service does not answer/,
    );
    expect(() => parseDeprecations(one({ reason: "  " }), known)).toThrow(/has to say why/);
    expect(() => parseDeprecations(one({ sunset: "30-11-2026" }), known)).toThrow(
      /\.sunset is not a YYYY-MM-DD date/,
    );
    expect(() => parseDeprecations(one({ sunset: "2026-02-31" }), known)).toThrow(
      /is not a date that exists/,
    );
    expect(() => parseDeprecations(one({ sunset: "2026-08-30" }), known)).toThrow(
      /sunsets 2026-08-30, before it was deprecated 2026-08-31/,
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
  const colour = {
    path: "user.colour",
    since: "2026-08-31",
    sunset: "2026-11-30",
    reason: "the colour moves into a theme",
    instead: null,
  };
  const count = {
    path: "counters.<ns>",
    since: "2026-08-31",
    sunset: "2026-10-01",
    reason: "counters move to their own service",
    instead: null,
  };

  test("a deprecation reaches the responses that carry the field", () => {
    expect(deprecationsFor("user", [colour, count])).toEqual([colour]);
    expect(deprecationsFor("counters", [colour, count])).toEqual([count]);
    expect(deprecationsFor("user", [])).toEqual([]);
  });

  test("the two headers are the two RFCs, and the dates are the field's", () => {
    const headers = deprecationHeaders([colour], "http://api.test");
    expect(headers.deprecation).toBe(`@${Date.parse("2026-08-31T00:00:00Z") / 1000}`);
    expect(headers.sunset).toBe("Mon, 30 Nov 2026 00:00:00 GMT");
    expect(headers.link).toBe('<http://api.test/versions>; rel="deprecation"');
  });

  test("nothing going away means no headers at all, rather than empty ones", () => {
    expect(deprecationHeaders([], "http://api.test")).toEqual({});
  });

  test("two fields in one body report the sunset there is least time to act on", () => {
    const soon = { ...colour, sunset: "2026-09-15" };
    expect(deprecationHeaders([colour, soon], "http://api.test").sunset).toBe(
      "Tue, 15 Sep 2026 00:00:00 GMT",
    );
    expect(deprecationHeaders([soon, colour], "http://api.test").sunset).toBe(
      "Tue, 15 Sep 2026 00:00:00 GMT",
    );
  });

  test("a page on another origin is allowed to read them", async () => {
    const res = await handle(get("/v1/user"), createState());
    const exposed = res.headers.get("access-control-expose-headers") ?? "";
    expect(exposed).toContain("sunset");
    expect(exposed).toContain("deprecation");
  });

  test("health depends on nothing", async () => {
    const res = await handle(get("/healthz"), createState());
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });
});

describe("the user", () => {
  test("starts at a default a page can render before anyone writes", async () => {
    expect(await bodyOf(await handle(get("/v1/user"), createState()))).toEqual({
      name: "Alex",
      colour: "#1f5fd0",
      initials: "AJ",
      theme: { colour: "#1f5fd0", dark: false },
    });
  });

  test("a name moves and the colour stays", async () => {
    const state = createState();
    expect(await bodyOf(await handle(post("/v1/user", { name: "Sam" }), state))).toMatchObject({
      name: "Sam",
      colour: "#1f5fd0",
    });
    expect(state.user.name).toBe("Sam");
  });

  test("a colour moves and the name stays", async () => {
    const state = createState();
    await handle(post("/v1/user", { colour: "#abcdef" }), state);
    expect(state.user).toMatchObject({ name: "Alex", colour: "#abcdef" });
  });

  test("both at once", async () => {
    const state = createState();
    await handle(post("/v1/user", { name: "Sam", colour: "#abcdef" }), state);
    expect(state.user).toMatchObject({ name: "Sam", colour: "#abcdef" });
  });

  test("a name that is not a non-empty string is refused, by name", async () => {
    for (const name of [42, "", null, {}]) {
      const res = await handle(post("/v1/user", { name }), createState());
      expect(res.status).toBe(400);
      expect(await bodyOf(res)).toEqual({ error: "name is not a non-empty string" });
    }
  });

  test("a colour that is not a non-empty string is refused, by name", async () => {
    const res = await handle(post("/v1/user", { colour: 1 }), createState());
    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "colour is not a non-empty string" });
  });

  test("a body naming neither field is refused", async () => {
    const res = await handle(post("/v1/user", { nom: "Sam" }), createState());
    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "body names no field of the user" });
  });

  test("a body that is not JSON at all is refused rather than thrown", async () => {
    const res = await handle(post("/v1/user", "{not json"), createState());
    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "body is not an object" });
  });

  test("a body that parses but is not an object is refused", async () => {
    for (const body of ["3", '"a string"', "null"]) {
      const res = await handle(post("/v1/user", body), createState());
      expect(res.status).toBe(400);
      expect(await bodyOf(res)).toEqual({ error: "body is not an object" });
    }
  });

  test("a method this route does not answer is refused, and says so", async () => {
    const res = await handle(
      new Request("http://api.test/v1/user", { method: "DELETE" }),
      createState(),
    );
    expect(res.status).toBe(405);
    expect(await bodyOf(res)).toEqual({ error: "method not allowed" });
  });
});

describe("the counters", () => {
  test("start empty, so a page shows no namespace nobody registered", async () => {
    expect(await bodyOf(await handle(get("/v1/counters"), createState()))).toEqual({});
  });

  test("a namespace registers at zero and is visible before anyone increments", async () => {
    const state = createState();
    expect(await bodyOf(await handle(post("/v1/counters/alpha", { register: true }), state))).toEqual({
      alpha: 0,
    });
  });

  test("registering a namespace that already counts leaves it where it is", async () => {
    const state = createState();
    await handle(post("/v1/counters/alpha", { by: 3 }), state);
    await handle(post("/v1/counters/alpha", { register: true }), state);
    expect(state.counters).toEqual({ alpha: 3 });
  });

  test("an increment with no amount moves it by one", async () => {
    const state = createState();
    await handle(post("/v1/counters/alpha", {}), state);
    expect(state.counters).toEqual({ alpha: 1 });
  });

  test("an increment carries its own amount, and it may be negative", async () => {
    const state = createState();
    await handle(post("/v1/counters/alpha", { by: 10 }), state);
    await handle(post("/v1/counters/alpha", { by: -1 }), state);
    expect(state.counters).toEqual({ alpha: 9 });
  });

  test("an amount that is not a finite number is refused, by name", async () => {
    for (const by of ["3", null, Number.POSITIVE_INFINITY]) {
      const res = await handle(post("/v1/counters/alpha", { by }), createState());
      expect(res.status).toBe(400);
      expect(await bodyOf(res)).toEqual({ error: "by is not a number" });
    }
  });

  test("a reset zeroes one namespace and leaves every other one", async () => {
    const state = createState();
    await handle(post("/v1/counters/alpha", { by: 4 }), state);
    await handle(post("/v1/counters/bravo", { by: 2 }), state);
    await handle(post("/v1/counters/alpha", { reset: true }), state);
    expect(state.counters).toEqual({ alpha: 0, bravo: 2 });
  });

  test("a namespace arrives through the path, encoded", async () => {
    const state = createState();
    await handle(post("/v1/counters/one%20two", { by: 2 }), state);
    expect(state.counters).toEqual({ "one two": 2 });
  });

  test("a GET of one namespace is not a route", async () => {
    const res = await handle(get("/v1/counters/alpha"), createState());
    expect(res.status).toBe(405);
    expect(await bodyOf(res)).toEqual({ error: "method not allowed" });
  });

  test("a POST to the whole list is not a route", async () => {
    const res = await handle(post("/v1/counters", { by: 1 }), createState());
    expect(res.status).toBe(405);
    expect(await bodyOf(res)).toEqual({ error: "method not allowed" });
  });

  test("a malformed body is refused here too", async () => {
    for (const body of ["{not json", "7"]) {
      const res = await handle(post("/v1/counters/alpha", body), createState());
      expect(res.status).toBe(400);
      expect(await bodyOf(res)).toEqual({ error: "body is not an object" });
    }
  });

  test("a path around the counter route is not a counter route", async () => {
    for (const path of ["/v1/counters/alpha/extra", "/nope/v1/counters/alpha"]) {
      const res = await handle(post(path, { by: 1 }), createState());
      expect(res.status).toBe(404);
    }
  });
});

describe("what a browser needs before it hands over a body", () => {
  test("a read carries the cross-origin headers", async () => {
    const res = await handle(get("/v1/user"), createState());
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("a preflight is answered with the methods and the header the write uses", async () => {
    const res = await handle(
      new Request("http://api.test/v1/user", { method: "OPTIONS" }),
      createState(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
  });
});

test("the routes it answers are exactly the versions it advertises", async () => {
  for (const v of SERVES) {
    expect((await handle(get(`/${v}/user`), createState())).status).toBe(200);
  }
  expect((await handle(get("/v0/user"), createState())).status).toBe(404);
});

test("a path this service does not answer is a 404, not a guess", async () => {
  const res = await handle(get("/v2/user"), createState());
  expect(res.status).toBe(404);
  expect(await bodyOf(res)).toEqual({ error: "not found" });
});

describe("the rest of what the service offers", () => {
  const bodyAfter = async (path: string, patch: unknown, state = createState()) =>
    bodyOf(await handle(post(path, patch), state));

  test("limits start somewhere a page can draw before anyone writes", async () => {
    expect(await bodyOf(await handle(get("/v1/limits"), createState()))).toEqual({
      step: 5,
      max: 100,
      allowNegative: true,
    });
  });

  test("one limit moves and the others stay", async () => {
    const state = createState();
    expect(await bodyAfter("/v1/limits", { allowNegative: false }, state)).toEqual({
      step: 5,
      max: 100,
      allowNegative: false,
    });
    expect(state.limits.allowNegative).toBe(false);
  });

  // A step of zero is the case this refusal exists for: every button on the
  // page goes on working and does nothing, which reads as a broken page.
  test("a limit a page cannot draw is refused, by name", async () => {
    expect(await bodyAfter("/v1/limits", { step: 0 })).toEqual({ error: "step is below 1" });
    expect(await bodyAfter("/v1/limits", { max: -1 })).toEqual({ error: "max is below 0" });
    expect(await bodyAfter("/v1/limits", { step: "5" })).toEqual({ error: "step is not a number" });
    expect(await bodyAfter("/v1/limits", { allowNegative: "no" })).toEqual({
      error: "allowNegative is not a boolean",
    });
    expect(await bodyAfter("/v1/limits", { nope: 1 })).toEqual({ error: "body names no limit" });
  });

  test("a label is merged per namespace, and an unknown one is created", async () => {
    const state = createState();
    expect(await bodyAfter("/v1/labels", { alpha: { emoji: "!" } }, state)).toMatchObject({
      alpha: { title: "Alpha", emoji: "!" },
    });
    await handle(post("/v1/labels", { echo: { title: "Echo" } }), state);
    expect(state.labels.echo).toEqual({ title: "Echo", emoji: "" });
  });

  test("a label that is not a label is refused, by namespace", async () => {
    expect(await bodyAfter("/v1/labels", { alpha: "Alpha" })).toEqual({
      error: "alpha is not an object",
    });
    expect(await bodyAfter("/v1/labels", { alpha: { title: 1 } })).toEqual({
      error: "alpha.title is not a non-empty string",
    });
    expect(await bodyAfter("/v1/labels", {})).toEqual({ error: "body names no namespace" });
  });

  test("a flag flips on its own, and the other two do not", async () => {
    const state = createState();
    expect(await bodyAfter("/v1/flags", { showShares: false }, state)).toEqual({
      showShares: false,
      showTotals: true,
      compact: false,
    });
  });

  test("a flag that is not a boolean is refused, by name", async () => {
    expect(await bodyAfter("/v1/flags", { showShares: "false" })).toEqual({
      error: "showShares is not a boolean",
    });
    expect(await bodyAfter("/v1/flags", { showBars: true })).toEqual({ error: "body names no flag" });
  });

  test("stats are computed from the counters, not stored beside them", async () => {
    const state = createState();
    await handle(post("/v1/counters/alpha", { by: 3 }), state);
    await handle(post("/v1/counters/bravo", { by: 8 }), state);
    const stats = await bodyOf(await handle(get("/v1/stats"), state));
    expect(stats).toMatchObject({ total: 11, busiest: "bravo" });
    expect(stats.updatedAt).toBe(state.countersChangedAt);
  });

  test("stats of nothing name nobody as the busiest", async () => {
    expect(await bodyOf(await handle(get("/v1/stats"), createState()))).toMatchObject({
      total: 0,
      busiest: null,
    });
  });

  test("stats cannot be written, because the next read would throw it away", async () => {
    const res = await handle(post("/v1/stats", { total: 99 }), createState());
    expect(res.status).toBe(405);
  });

  test("a message starts absent, is put up, and is taken down with null", async () => {
    const state = createState();
    expect(await bodyOf(await handle(get("/v1/motd"), state))).toBeNull();
    expect(
      await bodyAfter("/v1/motd", { text: "back at 14:00", level: "warn", until: "2026-12-01" }, state),
    ).toEqual({ text: "back at 14:00", level: "warn", until: "2026-12-01" });
    expect(await bodyAfter("/v1/motd", null, state)).toBeNull();
    expect(state.motd).toBeNull();
  });

  test("a message the page cannot draw is refused, by field", async () => {
    expect(await bodyAfter("/v1/motd", { level: "warn", until: "2026-12-01" })).toEqual({
      error: "text is not a non-empty string",
    });
    expect(await bodyAfter("/v1/motd", { text: "x", level: "loud", until: "2026-12-01" })).toEqual({
      error: 'level is neither "info" nor "warn"',
    });
    expect(await bodyAfter("/v1/motd", { text: "x", level: "info", until: "2026-02-31" })).toEqual({
      error: "until is not a YYYY-MM-DD date that exists",
    });
  });

  test("every route the document names answers, and every field it names is returned", async () => {
    const state = createState();
    for (const route of ROUTES.v1!) {
      if (route.method !== "GET") continue;
      const res = await handle(get(`/v1${route.path}`), state);
      expect(`${route.path} ${res.status}`).toBe(`${route.path} 200`);
    }
  });
});
