import { describe, expect, test } from "bun:test";
import { createStore } from "./api.ts";
import {
  API_VERSION,
  createClient,
  hydrate,
  parseCounters,
  parseUser,
  serviceBacked,
  type ServiceClient,
} from "./service.ts";

/**
 * The parser's own message, naming the field.
 *
 * Anchored and with the trailing space, for the reason `manifest.test.ts` gives:
 * a bare toThrow() passes on the TypeError one line further in, which is exactly
 * what a deleted guard produces, and the field path is what an operator acts on.
 */
const rejects = (parse: (input: unknown) => unknown, input: unknown, field: string) => {
  const path = field.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  expect(() => parse(input)).toThrow(new RegExp(`^api field ${path} `));
};

// Nothing compiles what the service actually sends, so every one of these is a
// shape this page can really receive: an older version of the service, a
// proxy's error document, a field renamed by somebody who never read this repo.
describe("what the service sends is checked, not assumed", () => {
  test("a user with both fields is accepted", () => {
    expect(parseUser({ name: "Alex", colour: "#1f5fd0" })).toEqual({
      name: "Alex",
      colour: "#1f5fd0",
    });
  });

  test("a user missing a field is rejected, by field", () => {
    rejects(parseUser, { colour: "#1f5fd0" }, "user.name");
    rejects(parseUser, { name: "Alex" }, "user.colour");
    rejects(parseUser, { name: "", colour: "#1f5fd0" }, "user.name");
    rejects(parseUser, { name: 42, colour: "#1f5fd0" }, "user.name");
  });

  // An HTML error page, an array, a null. All three parse as JSON and none of
  // them is a user.
  test("a body that is not an object is rejected", () => {
    rejects(parseUser, null, "user");
    rejects(parseUser, [], "user");
    rejects(parseUser, "<!doctype html>", "user");
  });

  test("counters are accepted as a map of numbers", () => {
    expect(parseCounters({ alpha: 3, bravo: 0 })).toEqual({ alpha: 3, bravo: 0 });
    expect(parseCounters({})).toEqual({});
  });

  // The page adds these and renders a total, so one bad value would show on
  // every row rather than on the one that arrived wrong.
  test("a count that is not a finite number is rejected, by namespace", () => {
    rejects(parseCounters, { alpha: "3" }, "counters.alpha");
    rejects(parseCounters, { alpha: 1, bravo: null }, "counters.bravo");
  });

});

describe("the client", () => {
  /** Records what was asked for, and answers with whatever the test names. */
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
      path.endsWith("/user") ? ok({ name: "Sam", colour: "#abcdef" }) : ok({ alpha: 2 }),
    );
    const client = createClient("https://api.test", { fetchImpl: s.fetchImpl });

    expect(await client.user()).toEqual({ name: "Sam", colour: "#abcdef" });
    expect(await client.counters()).toEqual({ alpha: 2 });
    expect(s.calls.map((c) => c.path)).toEqual([`/${API_VERSION}/user`, `/${API_VERSION}/counters`]);
  });

  test("a trailing slash on the base does not double the one in the path", async () => {
    const s = spy(() => ok({ name: "Sam", colour: "#abcdef" }));
    await createClient("https://api.test/", { fetchImpl: s.fetchImpl }).user();
    expect(s.calls[0]!.path).toBe(`/${API_VERSION}/user`);
  });

  test("a namespace with characters a path cannot carry is encoded", async () => {
    const s = spy(() => ok({ "one two": 1 }));
    await createClient("https://api.test", { fetchImpl: s.fetchImpl }).writeCounter("one two", {});
    expect(s.calls[0]!.path).toBe(`/${API_VERSION}/counters/one%20two`);
    expect(s.calls[0]!.init?.method).toBe("POST");
  });

  // A 404 body is JSON too, and { error: "not found" } parses as a user with no
  // name. Reading the status first is what makes the message name the real
  // fault instead of a field.
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
    user: async () => ({ name: "Sam", colour: "#abcdef" }),
    counters: async () => ({ alpha: 3, bravo: 0 }),
    setUser: async (p) => ({ name: "Sam", colour: "#abcdef", ...p }) as never,
    writeCounter: async () => ({}),
    ...over,
  });

  test("the page shows what the service holds", async () => {
    const store = createStore();
    expect(await hydrate(store, client())).toBe("ok");
    expect(store.user()).toEqual({ name: "Sam", colour: "#abcdef" });
    expect(store.countOf("alpha")).toBe(3);
    // Registered rather than skipped: a namespace at zero has to be VISIBLE, or
    // the page shows fewer rows than the service holds.
    expect(store.snapshot()).toEqual([
      ["alpha", 3],
      ["bravo", 0],
    ]);
  });

  // Rule 2 of the boundary. The store already has defaults and the page has
  // already rendered them, so an unreachable service costs a different page
  // rather than a blank one.
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
      user: async () => ({ name: "Alex", colour: "#1f5fd0" }),
      counters: async () => ({}),
      setUser: async (patch) => {
        sent.push(`user ${JSON.stringify(patch)}`);
        return { name: "Alex", colour: "#1f5fd0", ...patch } as never;
      },
      writeCounter: async (ns, body) => {
        sent.push(`${ns} ${JSON.stringify(body)}`);
        return {};
      },
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

    // Local first, with nothing awaited. A sub-app's button cannot wait for a
    // fourth deploy to answer.
    expect(b.store.user()).toEqual({ name: "Sam", colour: "#abcdef" });
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
    expect(b.wrapped.user()).toEqual({ name: "Alex", colour: "#1f5fd0" });
    await Bun.sleep(1);
    expect(b.sent).toEqual(['alpha {"by":2}']);
  });

  // A write the service refuses must not throw where the sub-app called it: the
  // caller is a click handler, and an unhandled rejection there is a page that
  // reports nothing at all.
  test("a write the service refuses is reported, and the page keeps the value", async () => {
    const store = createStore();
    const said: string[] = [];
    const wrapped = serviceBacked(
      store,
      {
        user: async () => ({ name: "Alex", colour: "#1f5fd0" }),
        counters: async () => ({}),
        setUser: async () => {
          throw new Error("POST /v1/user responded 400");
        },
        writeCounter: async () => {
          throw new Error("Unable to connect");
        },
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
