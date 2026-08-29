import { describe, expect, test } from "bun:test";
import { SERVES, createState, handle } from "./service.ts";

const get = (path: string) => new Request(`http://api.test${path}`);
const post = (path: string, body: unknown) =>
  new Request(`http://api.test${path}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });

/** The body, whatever it is. Every route here answers JSON. */
const bodyOf = async (res: Response) => (await res.json()) as Record<string, unknown>;

describe("the discovery document", () => {
  // A client that does not know which versions exist has to be able to ask, so
  // this one cannot sit behind a version itself.
  test("names every version this build answers", async () => {
    const res = await handle(get("/versions"), createState());
    expect(res.status).toBe(200);
    expect(await bodyOf(res)).toEqual({ serves: [...SERVES] });
  });

  // Health that read the state would turn one bad write into a dead machine,
  // which is the same rule the shell's own health check is written to.
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
    });
  });

  // Each field alone, because a POST that carried one and silently reset the
  // other would be a page losing a value nobody touched.
  test("a name moves and the colour stays", async () => {
    const state = createState();
    expect(await bodyOf(await handle(post("/v1/user", { name: "Sam" }), state))).toEqual({
      name: "Sam",
      colour: "#1f5fd0",
    });
    expect(state.user.name).toBe("Sam");
  });

  test("a colour moves and the name stays", async () => {
    const state = createState();
    await handle(post("/v1/user", { colour: "#abcdef" }), state);
    expect(state.user).toEqual({ name: "Alex", colour: "#abcdef" });
  });

  test("both at once", async () => {
    const state = createState();
    await handle(post("/v1/user", { name: "Sam", colour: "#abcdef" }), state);
    expect(state.user).toEqual({ name: "Sam", colour: "#abcdef" });
  });

  // The field is named because the caller has to know which one to fix. A 400
  // saying only that something was wrong costs a round of guessing.
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

  // A caller that thinks it changed something and did not is worse off than one
  // that is told it named nothing.
  test("a body naming neither field is refused", async () => {
    const res = await handle(post("/v1/user", { nom: "Sam" }), createState());
    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "body names neither name nor colour" });
  });

  test("a body that is not JSON at all is refused rather than thrown", async () => {
    const res = await handle(post("/v1/user", "{not json"), createState());
    expect(res.status).toBe(400);
    expect(await bodyOf(res)).toEqual({ error: "body is not an object" });
  });

  // A JSON body may be a number or a string and still parse. Every field read
  // below indexes into it, and indexing a number throws - so this guard is what
  // stands between a malformed request and a 500.
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

  // Registering twice must not undo a count. The shell registers on every
  // mount, so this runs far more often than the increment does.
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

  // A namespace is a name from the page, not an identifier this service picked.
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

  // The list is a read. A write with no namespace names nothing to write to.
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

  // Both ends of the pattern. Without the anchors a namespace could be read out
  // of the middle of a path this service does not answer, and the write would
  // land somewhere the caller did not name.
  test("a path around the counter route is not a counter route", async () => {
    for (const path of ["/v1/counters/alpha/extra", "/nope/v1/counters/alpha"]) {
      const res = await handle(post(path, { by: 1 }), createState());
      expect(res.status).toBe(404);
    }
  });
});

describe("what a browser needs before it hands over a body", () => {
  // The page is on another origin, so without these the browser discards the
  // response and the shell sees a network error it cannot explain.
  test("a read carries the cross-origin headers", async () => {
    const res = await handle(get("/v1/user"), createState());
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
    expect(res.headers.get("cache-control")).toBe("no-store");
    // Stated, because a consumer that switches on it gets nothing useful from
    // an empty one and this response is JSON in every case.
    expect(res.headers.get("content-type")).toContain("application/json");
  });

  // A POST of JSON is preflighted. Without this the write never leaves the
  // browser at all.
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

// The document and the routes are one fact, not two. A service that advertised
// v2 and went on answering v1 would make the server's gate judge a claim, and
// the page would work while the gate said it could not.
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
