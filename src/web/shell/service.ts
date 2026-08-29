// The boundary between this page and a service nothing here compiles.
//
// Every other surface in this repository has `tsc` for an oracle: both halves
// of the contract are built from one commit, so a mismatch is a build failure
// and the matrix can enumerate every pair. This one has none. The service is a
// separate deploy on a separate schedule, its surface is not a TypeScript file,
// and what it actually returns at three o'clock this afternoon is a fact about
// the running world rather than about this repository.
//
// So the types below are DECLARED here and never imported from `api/`. Importing
// them would put the compiler back in the loop and prove nothing: the shell
// would agree with the service's source at this commit, which is not the
// question. The question is whether the shell survives what the service sends.
//
// Two rules follow, and they are the whole design:
//
//   1. Nothing crosses this boundary unchecked. Every response is parsed by a
//      function that names the field it rejected, in the same idiom as
//      `parseManifest`: a message an operator can act on.
//   2. The page never waits for the service. The store has defaults, the shell
//      renders from them at once, and a value the service supplies arrives when
//      it arrives. A service that is slow, unreachable or absent costs a
//      DIFFERENT page, never a blank one.

import type { BuildInfo } from "@pointer/blocks";
import type { ShellStore } from "./api.ts";

export type ApiUser = { name: string; colour: string };
/** Namespace to count. The service sends a plain object; order is the page's. */
export type ApiCounters = Record<string, number>;

const field = (name: string, why: string): never => {
  throw new Error(`api field ${name} ${why}`);
};

const str = (name: string, value: unknown): string =>
  typeof value === "string" && value.length > 0 ? value : field(name, "is missing or not a string");

const obj = (name: string, value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : field(name, "is not an object");

/** Throws naming the field, so a page that refuses a response says which one. */
export function parseUser(input: unknown): ApiUser {
  const u = obj("user", input);
  return { name: str("user.name", u.name), colour: str("user.colour", u.colour) };
}

export function parseCounters(input: unknown): ApiCounters {
  const c = obj("counters", input);
  const out: ApiCounters = {};
  for (const [ns, count] of Object.entries(c)) {
    // Finite, not just a number: the page adds these and renders the total, and
    // one Infinity would make every total on the page read Infinity.
    if (!Number.isFinite(count)) field(`counters.${ns}`, "is not a number");
    out[ns] = count as number;
  }
  return out;
}

/** Which versions the service says it answers. */
export function parseVersions(input: unknown): string[] {
  const v = obj("versions", input);
  if (!Array.isArray(v.serves)) field("versions.serves", "is not an array");
  return (v.serves as unknown[]).map((s, i) => str(`versions.serves[${i}]`, s));
}

/** The API version this shell is written against. One string, in one place. */
export const API_VERSION = "v1";

/**
 * Where the server says the service is, or "" when it named none.
 *
 * The ONE field this shell reads out of `__BUILD__`. Every other field in that
 * block is for a person or for the harness, so before §13 the shell recorded
 * nothing about it at all - and reading this one is what puts `BuildInfo` under
 * the same serve-time gate the other two blocks are under.
 *
 * An absent block, an unparseable one, or a server with no service configured
 * are the same answer: the page runs on its own values.
 */
export function readApiBase(): string {
  const el = document.getElementById("__BUILD__");
  if (!el?.textContent) return "";
  try {
    return (JSON.parse(el.textContent) as BuildInfo).apiBase ?? "";
  } catch {
    return "";
  }
}

export type ServiceClient = {
  user(): Promise<ApiUser>;
  counters(): Promise<ApiCounters>;
  setUser(patch: Partial<ApiUser>): Promise<ApiUser>;
  /** by, register or reset. The service takes all three on one route. */
  writeCounter(ns: string, body: Record<string, unknown>): Promise<ApiCounters>;
};

export type ClientOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };

/**
 * A client for one base URL.
 *
 * `base` comes from the page rather than from a build: the server writes it
 * into the build block, so the same bundle runs against a local service and a
 * deployed one. A base of "" means no service is configured, and the caller
 * does not make a client at all.
 */
export function createClient(base: string, options: ClientOptions = {}): ServiceClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const root = base.replace(/\/$/, "");

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await doFetch(`${root}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    // The status first. A 404 body parses as JSON and would otherwise be read
    // as a user with no name, which reports the wrong fault.
    if (!res.ok) throw new Error(`GET ${path} responded ${res.status}`);
    return res.json();
  }

  const write = (path: string, body: unknown): Promise<unknown> =>
    call(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    user: async () => parseUser(await call(`/${API_VERSION}/user`)),
    counters: async () => parseCounters(await call(`/${API_VERSION}/counters`)),
    setUser: async (patch) => parseUser(await write(`/${API_VERSION}/user`, patch)),
    writeCounter: async (ns, body) =>
      parseCounters(await write(`/${API_VERSION}/counters/${encodeURIComponent(ns)}`, body)),
  };
}

/**
 * The store, with every write also sent to the service.
 *
 * Optimistic and deliberately so: the local write lands first, so a sub-app's
 * button feels the same whether the service is fast, slow or gone, and the POST
 * follows. Nothing waits for the answer and nothing reconciles from it, so two
 * tabs writing at once diverge until the next load - which is a real limit and
 * the price of a page that never blocks on a fourth deploy.
 *
 * The wrapper IS a `ShellStore`. A sub-app receives it and cannot tell, which
 * is what keeps the service out of the contract the sub-apps are built against.
 */
export function serviceBacked(
  store: ShellStore,
  client: ServiceClient,
  onError: (message: string) => void,
): ShellStore {
  const send = (p: Promise<unknown>) =>
    void p.catch((e: unknown) => onError(e instanceof Error ? e.message : String(e)));

  return {
    user: () => store.user(),
    countOf: (ns) => store.countOf(ns),
    snapshot: () => store.snapshot(),
    setName: (name) => {
      store.setName(name);
      send(client.setUser({ name }));
    },
    setColour: (colour) => {
      store.setColour(colour);
      send(client.setUser({ colour }));
    },
    register: (ns) => {
      store.register(ns);
      send(client.writeCounter(ns, { register: true }));
    },
    increment: (ns, by) => {
      store.increment(ns, by);
      send(client.writeCounter(ns, { by: by ?? 1 }));
    },
    reset: (ns) => {
      store.reset(ns);
      send(client.writeCounter(ns, { reset: true }));
    },
  };
}

/**
 * Fill a store from the service, and say what happened.
 *
 * Applied through the store's own writes rather than by reaching into it: the
 * store is the only thing that knows how a count becomes visible, and a second
 * way in would be a second place for that to be wrong.
 *
 * The store handed here must be the PLAIN one. Hydrating through the wrapper
 * would post every value the service just sent straight back to it.
 */
export async function hydrate(store: ShellStore, client: ServiceClient): Promise<string> {
  try {
    const [user, counters] = await Promise.all([client.user(), client.counters()]);
    store.setName(user.name);
    store.setColour(user.colour);
    for (const [ns, count] of Object.entries(counters)) {
      store.register(ns);
      if (count !== 0) store.increment(ns, count);
    }
    return "ok";
  } catch (e) {
    // The page keeps the defaults it already rendered. What is lost is the
    // service's values, and this string is the only place that says so.
    return e instanceof Error ? e.message : String(e);
  }
}
