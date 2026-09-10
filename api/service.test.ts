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
    expect(v1.routes).toContainEqual({ method: "GET", path: "/v1/greeting" });
  });

  test("a version it does not answer is not described", () => {
    const doc = discovery(["v1"], []);
    expect(doc.versions).not.toHaveProperty("v2");
  });

  test("a field going away is said on the field, not beside it", () => {
    const going = {
      path: "greeting.audience",
      since: "2026-09-10",
      sunset: "2026-12-10",
      reason: "the audience moves onto the visitor",
      instead: null,
    };
    const v1 = (discovery(["v1"], [going]).versions as Record<string, { fields: Record<string, unknown>[] }>).v1!;
    expect(v1.fields.find((f) => f.path === "greeting.audience")).toEqual({
      path: "greeting.audience",
      type: "string",
      deprecated: {
        since: "2026-09-10",
        sunset: "2026-12-10",
        reason: "the audience moves onto the visitor",
        instead: null,
      },
    });
    expect(v1.fields.find((f) => f.path === "greeting.text")).not.toHaveProperty("deprecated");
  });
});

describe("the operator's decision, read from the environment", () => {
  const known = answered(["v1"]);
  const one = (over: Record<string, unknown> = {}) =>
    JSON.stringify([
      {
        path: "greeting.audience",
        since: "2026-09-10",
        sunset: "2026-12-10",
        reason: "the audience moves onto the visitor",
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
        path: "greeting.audience",
        since: "2026-09-10",
        sunset: "2026-12-10",
        reason: "the audience moves onto the visitor",
        instead: null,
      },
    ]);
    expect(parseDeprecations(one({ instead: "greeting.text" }), known)[0]!.instead).toBe(
      "greeting.text",
    );
  });

  // Every one of these throws rather than being ignored. A deprecation that
  // was silently dropped publishes "nothing is going away", and the operator
  // who set the variable cannot tell that from a service that read it.
  test("a value this service cannot act on stops it, and says which part", () => {
    expect(() => parseDeprecations("{", known)).toThrow(/is not JSON/);
    expect(() => parseDeprecations('{"path":"greeting.audience"}', known)).toThrow(/is not an array/);
    expect(() => parseDeprecations("[1]", known)).toThrow(/\[0\] is not an object/);
    expect(() => parseDeprecations(one({ path: "greeting.audiance" }), known)).toThrow(
      /names greeting\.audiance, which this service does not answer/,
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
    path: "greeting.audience",
    since: "2026-09-10",
    sunset: "2026-12-10",
    reason: "the audience moves onto the visitor",
    instead: null,
  };
  const text = {
    path: "greeting.text",
    since: "2026-09-10",
    sunset: "2026-10-01",
    reason: "the text moves to a translated resource",
    instead: null,
  };

  test("a deprecation reaches the responses that carry the field", () => {
    expect(deprecationsFor("greeting", [audience])).toEqual([audience]);
    expect(deprecationsFor("greeting", [audience, text])).toEqual([audience, text]);
    expect(deprecationsFor("nothing", [audience])).toEqual([]);
    expect(deprecationsFor("greeting", [])).toEqual([]);
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
    const res = await handle(get("/v1/greeting"), createState());
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

describe("the greeting", () => {
  const bodyAfter = async (patch: unknown, state = createState()) =>
    bodyOf(await handle(post("/v1/greeting", patch), state));

  test("starts at a default a page can render before anyone writes", async () => {
    expect(await bodyOf(await handle(get("/v1/greeting"), createState()))).toEqual({
      text: "Hello",
      audience: "world",
    });
  });

  test("the text moves and the audience stays", async () => {
    expect(await bodyAfter({ text: "Bonjour" })).toEqual({ text: "Bonjour", audience: "world" });
  });

  test("the audience moves and the text stays", async () => {
    expect(await bodyAfter({ audience: "Berlin" })).toEqual({ text: "Hello", audience: "Berlin" });
  });

  test("both at once", async () => {
    expect(await bodyAfter({ text: "Hei", audience: "Oslo" })).toEqual({
      text: "Hei",
      audience: "Oslo",
    });
  });

  // Empty is how a greeting is addressed to nobody in particular. It is a
  // value the page draws, so the route has to accept it.
  test("an empty audience is accepted, and an empty text is not", async () => {
    expect(await bodyAfter({ audience: "" })).toEqual({ text: "Hello", audience: "" });
    expect(await bodyAfter({ text: "" })).toEqual({ error: "text is not a non-empty string" });
  });

  test("a field that is not a string is refused, by name", async () => {
    expect(await bodyAfter({ text: 7 })).toEqual({ error: "text is not a non-empty string" });
    expect(await bodyAfter({ audience: 7 })).toEqual({ error: "audience is not a string" });
  });

  test("a body naming neither field is refused", async () => {
    expect(await bodyAfter({ salutation: "Hello" })).toEqual({
      error: "body names no field of the greeting",
    });
  });

  test("a body that is not JSON at all is refused rather than thrown", async () => {
    expect(await bodyAfter("{")).toEqual({ error: "body is not an object" });
  });

  test("a body that parses but is not an object is refused", async () => {
    expect(await bodyAfter([1])).toEqual({ error: "body is not an object" });
    expect(await bodyAfter(null)).toEqual({ error: "body is not an object" });
  });

  test("a write is what the next read returns", async () => {
    const state = createState();
    await handle(post("/v1/greeting", { text: "Hei", audience: "Oslo" }), state);
    expect(await bodyOf(await handle(get("/v1/greeting"), state))).toEqual({
      text: "Hei",
      audience: "Oslo",
    });
  });

  test("a write moves the clock the service keeps", async () => {
    const state = createState();
    const before = state.changedAt;
    await Bun.sleep(2);
    await handle(post("/v1/greeting", { audience: "Berlin" }), state);
    expect(state.changedAt).not.toBe(before);
  });

  test("a method this route does not answer is refused, and says so", async () => {
    const res = await handle(
      new Request("http://api.test/v1/greeting", { method: "DELETE" }),
      createState(),
    );
    expect(res.status).toBe(405);
    expect(await bodyOf(res)).toEqual({ error: "method not allowed" });
  });
});

describe("what a browser needs before it hands over a body", () => {
  test("a read carries the cross-origin headers", async () => {
    const res = await handle(get("/v1/greeting"), createState());
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  test("a preflight is answered with the methods and the header the write uses", async () => {
    const res = await handle(
      new Request("http://api.test/v1/greeting", { method: "OPTIONS" }),
      createState(),
    );
    expect(res.status).toBe(204);
    expect(res.headers.get("access-control-allow-methods")).toContain("POST");
    expect(res.headers.get("access-control-allow-headers")).toContain("content-type");
  });
});

test("the routes it answers are exactly the versions it advertises", async () => {
  for (const v of SERVES) {
    expect((await handle(get(`/${v}/greeting`), createState())).status).toBe(200);
  }
  expect((await handle(get("/v0/greeting"), createState())).status).toBe(404);
});

test("a path this service does not answer is a 404, not a guess", async () => {
  const res = await handle(get("/v2/greeting"), createState());
  expect(res.status).toBe(404);
  expect(await bodyOf(res)).toEqual({ error: "not found" });

  const inside = await handle(get("/v1/greeting/extra"), createState());
  expect(inside.status).toBe(404);
});

test("every route the document names answers, and every field it names is returned", async () => {
  const state = createState();
  for (const route of ROUTES.v1!) {
    if (route.method !== "GET") continue;
    const res = await handle(get(`/v1${route.path}`), state);
    expect(`${route.path} ${res.status}`).toBe(`${route.path} 200`);
  }
  const body = await bodyOf(await handle(get("/v1/greeting"), state));
  for (const f of FIELDS.v1!) {
    expect(`${f.path} ${f.path.split(".")[1]! in body}`).toBe(`${f.path} true`);
  }
});
