import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/bdd.ts";
import type { PointerWorld } from "../support/world.ts";

type Field = { path: string; type: string; deprecated?: Record<string, unknown> };
type Doc = { serves: string[]; versions?: Record<string, { fields: Field[]; routes: unknown[] }> };

const REASON = "the colour moves into a theme object";

const decision = (path: string, sunset: string) =>
  JSON.stringify([{ path, since: "2026-08-31", sunset, reason: REASON, instead: null }]);

const doc = (world: PointerWorld): Doc => {
  const held = world.serviceDoc;
  if (!held) throw new Error("no step has asked the service what it holds yet");
  return held as Doc;
};

const fieldsOf = (world: PointerWorld, version: string): Field[] => {
  const spec = doc(world).versions?.[version];
  if (!spec) throw new Error(`the document describes no ${version}: ${JSON.stringify(doc(world))}`);
  return spec.fields;
};

const fieldNamed = (world: PointerWorld, path: string): Field => {
  const hit = fieldsOf(world, "v1").find((f) => f.path === path);
  if (!hit) throw new Error(`the document names no field ${path}`);
  return hit;
};

const lastResponse = (world: PointerWorld): Response => {
  if (!world.serviceResponse) throw new Error("no step has read from the service yet");
  return world.serviceResponse;
};

Given(
  "a service that answers {string} and retires {string} on {string}",
  async function (this: PointerWorld, serves: string, path: string, sunset: string) {
    await this.startServiceAndServer(serves, decision(path, sunset));
  },
);

// The refusal cases never reach a listening service, so they cannot go through
// the world's starter: it waits for a line the process will not print.
Given(
  "a service told to retire {string}, which it does not answer",
  async function (this: PointerWorld, path: string) {
    this.serviceRefusal = await refusedStart(decision(path, "2026-11-30"));
  },
);

Given("a service told to retire something that is not JSON", async function (this: PointerWorld) {
  this.serviceRefusal = await refusedStart("user.colour goes in November");
});

async function refusedStart(deprecated: string): Promise<{ code: number; said: string }> {
  const proc = Bun.spawn(["bun", "api/index.ts"], {
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", PORT: "0", API_DEPRECATED: deprecated },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, said: `${out}${err}` };
}

When("the service is asked what it holds", async function (this: PointerWorld) {
  const res = await fetch(`${this.serviceBase}/versions`);
  expect(res.status).toBe(200);
  this.serviceDoc = (await res.json()) as Doc;
});

When("a page reads the user from that service", async function (this: PointerWorld) {
  this.serviceResponse = await fetch(`${this.serviceBase}/v1/user`);
});

When("a page reads the counters from that service", async function (this: PointerWorld) {
  this.serviceResponse = await fetch(`${this.serviceBase}/v1/counters`);
});

Then(
  "it still names {string} among the versions it serves",
  function (this: PointerWorld, version: string) {
    expect(doc(this).serves).toContain(version);
  },
);

Then(
  "it names {string} as a field of {string}",
  function (this: PointerWorld, path: string, version: string) {
    expect(fieldsOf(this, version).map((f) => f.path)).toContain(path);
  },
);

Then("nothing in {string} is going away", function (this: PointerWorld, version: string) {
  expect(fieldsOf(this, version).filter((f) => f.deprecated)).toEqual([]);
});

Then("it describes no version it does not answer", function (this: PointerWorld) {
  expect(Object.keys(doc(this).versions ?? {})).toEqual(doc(this).serves);
});

Then(
  "it says {string} goes on {string}",
  function (this: PointerWorld, path: string, sunset: string) {
    expect(fieldNamed(this, path).deprecated).toMatchObject({ sunset });
  },
);

Then("it gives a reason for retiring {string}", function (this: PointerWorld, path: string) {
  expect(fieldNamed(this, path).deprecated).toMatchObject({ reason: REASON });
});

// The point of the whole mechanism: going away is a warning and not a refusal,
// so the field keeps being answered until the day it is not.
Then("it still answers {string}", async function (this: PointerWorld, path: string) {
  const [top, member] = path.split(".");
  const body = (await (await fetch(`${this.serviceBase}/v1/${top}`)).json()) as Record<string, unknown>;
  expect(Object.keys(body)).toContain(member!);
});

Then("it refuses to start, and names what it does answer", function (this: PointerWorld) {
  const refusal = this.serviceRefusal!;
  expect(refusal.code).not.toBe(0);
  expect(refusal.said).toContain("which this service does not answer");
  expect(refusal.said).toContain("user.colour");
});

Then("it refuses to start, and says which part it could not read", function (this: PointerWorld) {
  const refusal = this.serviceRefusal!;
  expect(refusal.code).not.toBe(0);
  expect(refusal.said).toContain("API_DEPRECATED is not JSON");
});

Then(
  "that response is marked deprecated and sunset on {string}",
  function (this: PointerWorld, sunset: string) {
    const res = lastResponse(this);
    expect(res.status).toBe(200);
    expect(res.headers.get("sunset")).toBe(new Date(`${sunset}T00:00:00Z`).toUTCString());
    expect(res.headers.get("deprecation")).toMatch(/^@\d+$/);
  },
);

Then("it points at the document for the reason", function (this: PointerWorld) {
  expect(lastResponse(this).headers.get("link")).toBe(
    `<${this.serviceBase}/versions>; rel="deprecation"`,
  );
});

Then("that response is not marked deprecated", function (this: PointerWorld) {
  const res = lastResponse(this);
  expect(res.status).toBe(200);
  expect(res.headers.get("sunset")).toBeNull();
  expect(res.headers.get("deprecation")).toBeNull();
});

Then("another origin is permitted to read the sunset", function (this: PointerWorld) {
  const exposed = lastResponse(this).headers.get("access-control-expose-headers") ?? "";
  expect(exposed).toContain("sunset");
  expect(exposed).toContain("deprecation");
});

// --- what an operator changes at runtime, §27 -------------------------------

const send = async (world: PointerWorld, resource: string, body: string): Promise<Response> =>
  fetch(`${world.serviceBase}/v1/${resource}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

When(
  "an operator sets {string} to {}",
  async function (this: PointerWorld, resource: string, body: string) {
    this.serviceResponse = await send(this, resource, body);
  },
);

When(
  "a page reads {string} from that service",
  async function (this: PointerWorld, resource: string) {
    const res = await fetch(`${this.serviceBase}/v1/${resource}`);
    expect(res.status).toBe(200);
    this.serviceRead = await res.json();
  },
);

When(
  "a page raises the {string} counter by {int}",
  async function (this: PointerWorld, ns: string, by: number) {
    this.serviceResponse = await send(this, `counters/${ns}`, JSON.stringify({ by }));
    expect(this.serviceResponse.status).toBe(200);
  },
);

Then("it reads back {}", function (this: PointerWorld, expected: string) {
  expect(this.serviceRead).toEqual(JSON.parse(expected));
});

Then("the service refuses it, saying {string}", async function (this: PointerWorld, why: string) {
  const res = lastResponse(this);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: why });
});

Then(
  "what it read names {int} as the total and {string} as the busiest",
  function (this: PointerWorld, total: number, busiest: string) {
    expect(this.serviceRead).toMatchObject({ total, busiest });
  },
);
