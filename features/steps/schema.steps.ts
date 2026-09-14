import { expect } from "@playwright/test";
import { Given, Then, When } from "../support/bdd.ts";
import type { PointerWorld } from "../support/world.ts";
import { plannerDocument, titleList } from "../support/planner-document.ts";

type Field = { path: string; type: string; deprecated?: Record<string, unknown> };
type Doc = { serves: string[]; versions?: Record<string, { fields: Field[]; routes: unknown[] }> };

const REASON = "a planner stores more than tasks";

/** The version this shell is built against, and the one these steps call. */
const V = "v1";

const decision = (path: string, sunset: string) =>
  JSON.stringify([{ path, since: "2026-09-10", sunset, reason: REASON, instead: null }]);

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
    this.serviceRefusal = await refusedStart(decision(path, "2026-12-10"));
  },
);

Given("a service told to retire something that is not JSON", async function (this: PointerWorld) {
  this.serviceRefusal = await refusedStart("snapshot.tasks goes in December");
});

async function refusedStart(deprecated: string): Promise<{ code: number; said: string }> {
  const proc = Bun.spawn(["bun", "api/index.ts"], {
    // No bucket, for the reason `startServiceAndServer` gives: the credential
    // in this process's environment is the ASSET bucket's. This service never
    // gets as far as writing, and a spawn that depended on that would be one
    // edit away from doing so.
    env: {
      ...process.env,
      FORCE_COLOR: "0",
      NO_COLOR: "1",
      PORT: "0",
      API_DEPRECATED: deprecated,
      AWS_ACCESS_KEY_ID: "",
      AWS_SECRET_ACCESS_KEY: "",
      BUCKET_NAME: "",
    },
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

// --- the version's own root, `PLAN.md` step 6 -------------------------------

When("a page asks for the version this shell calls", async function (this: PointerWorld) {
  this.serviceResponse = await fetch(`${this.serviceBase}/${V}`);
});

Then("the version answers with its own routes and fields", async function (this: PointerWorld) {
  const res = lastResponse(this);
  expect(res.status).toBe(200);
  const body = (await res.clone().json()) as { routes?: unknown[]; fields?: Field[] };
  expect(body.routes).toContainEqual({ method: "GET", path: `/${V}` });
  expect((body.fields ?? []).map((f) => f.path)).toContain("snapshot.tasks");
});

// The half that makes the reading a reading. A page distinguishes "the version
// I call is answered" from "it is not", and both answers have to exist.
Then("a version it does not answer is not found", async function (this: PointerWorld) {
  const res = await fetch(`${this.serviceBase}/v2`);
  expect(res.status).toBe(404);
});

// --- pushing a planner and reading it back ----------------------------------

const push = async (world: PointerWorld, body: string): Promise<Response> =>
  fetch(`${world.serviceBase}/${V}/snapshots`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body,
  });

const addressOf = async (res: Response): Promise<string> => {
  const body = (await res.clone().json()) as { snapshot?: string };
  if (!body.snapshot) throw new Error(`the push carried no address: ${JSON.stringify(body)}`);
  return body.snapshot;
};

When("a page pushes a planner to that service", async function (this: PointerWorld) {
  this.serviceResponse = await push(this, JSON.stringify(plannerDocument(["Book the ferry"])));
  expect(this.serviceResponse.status).toBe(201);
});

When(
  "a page pushes a planner holding {string}",
  async function (this: PointerWorld, titles: string) {
    this.serviceResponse = await push(this, JSON.stringify(plannerDocument(titleList(titles))));
    expect(this.serviceResponse.status).toBe(201);
    this.pushedAddress = await addressOf(this.serviceResponse);
  },
);

// The same BYTES, and that is the claim. An address is the sha256 of what was
// sent, so a step that rebuilt the document with a moving stamp would be
// pushing a different planner and the two addresses would differ for a reason
// that has nothing to do with the mechanism.
When("the same planner is pushed again", async function (this: PointerWorld) {
  this.pushedBefore = this.pushedAddress;
  const res = await push(this, JSON.stringify(plannerDocument(["Book the ferry"])));
  expect(res.status).toBe(201);
  this.pushedAddress = await addressOf(res);
});

Then("both pushes name one address", function (this: PointerWorld) {
  expect(this.pushedAddress).toBe(this.pushedBefore);
});

When("a page reads that address back", async function (this: PointerWorld) {
  const res = await fetch(`${this.serviceBase}/${V}/snapshots/${this.pushedAddress}`);
  expect(res.status).toBe(200);
  this.serviceRead = await res.json();
});

When("a page reads an address nothing was pushed to", async function (this: PointerWorld) {
  this.serviceResponse = await fetch(`${this.serviceBase}/${V}/snapshots/${"0".repeat(64)}`);
});

When("a page reads the address {string}", async function (this: PointerWorld, address: string) {
  this.serviceResponse = await fetch(`${this.serviceBase}/${V}/snapshots/${address}`);
});

When("a page pushes something that is not a JSON object", async function (this: PointerWorld) {
  this.serviceResponse = await push(this, "[1]");
});

Then("the planner that comes back holds {string}", function (this: PointerWorld, titles: string) {
  const held = this.serviceRead as { tasks?: Array<{ title: string }> };
  expect((held.tasks ?? []).map((t) => t.title)).toEqual(titleList(titles));
});

// The two fields the shell's pull door reads before it writes anything. A
// response carrying tasks alone would leave that door with nothing to apply the
// version rule to, which is the rule `PLAN.md`'s four-doors table states.
Then("it carries the format and the schema version that were pushed", function (this: PointerWorld) {
  const held = this.serviceRead as { format?: unknown; schemaVersion?: unknown };
  const pushed = plannerDocument([]);
  expect(held.format).toBe(pushed.format);
  expect(held.schemaVersion).toBe(pushed.schemaVersion);
});

Then("the service says it holds nothing there", async function (this: PointerWorld) {
  const res = lastResponse(this);
  expect(res.status).toBe(404);
  expect(await res.json()).toEqual({ error: "not found" });
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
// so the field keeps being answered until the day it is not. Read off a real
// push, because every `snapshot.*` field is a member of that response and
// nothing else answers with one.
Then("it still answers {string}", async function (this: PointerWorld, path: string) {
  const member = path.split(".")[1]!;
  const res = await push(this, JSON.stringify(plannerDocument(["Book the ferry"])));
  expect(res.status).toBe(201);
  expect(Object.keys((await res.json()) as Record<string, unknown>)).toContain(member);
});

Then("it refuses to start, and names what it does answer", function (this: PointerWorld) {
  const refusal = this.serviceRefusal!;
  expect(refusal.code).not.toBe(0);
  expect(refusal.said).toContain("which this service does not answer");
  // The fields it DOES answer, which is what makes the refusal actionable: an
  // operator who typed `snapshot.taks` is one character away and has to be able
  // to see which one.
  expect(refusal.said).toContain("snapshot.tasks");
});

Then("it refuses to start, and says which part it could not read", function (this: PointerWorld) {
  const refusal = this.serviceRefusal!;
  expect(refusal.code).not.toBe(0);
  expect(refusal.said).toContain("API_DEPRECATED is not JSON");
});

// `ok` and not 200, because two responses carry these headers and they are
// different statuses: the version root answers 200 and a push answers 201. The
// status is still read, so a REFUSAL carrying the headers would fail here
// rather than pass - what is being dropped is the exact code, not the reading
// that the request succeeded.
Then(
  "that response is marked deprecated and sunset on {string}",
  function (this: PointerWorld, sunset: string) {
    const res = lastResponse(this);
    expect(res.ok).toBe(true);
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
  expect(res.ok).toBe(true);
  expect(res.headers.get("sunset")).toBeNull();
  expect(res.headers.get("deprecation")).toBeNull();
});

Then("another origin is permitted to read the sunset", function (this: PointerWorld) {
  const exposed = lastResponse(this).headers.get("access-control-expose-headers") ?? "";
  expect(exposed).toContain("sunset");
  expect(exposed).toContain("deprecation");
});

Then("the service refuses it, saying {string}", async function (this: PointerWorld, why: string) {
  const res = lastResponse(this);
  expect(res.status).toBe(400);
  expect(await res.json()).toEqual({ error: why });
});
