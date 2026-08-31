import type { BuildInfo } from "@pointer/blocks";
import type { ShellStore } from "./api.ts";

export type ApiUser = { name: string; colour: string };
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

export function parseUser(input: unknown): ApiUser {
  const u = obj("user", input);
  return { name: str("user.name", u.name), colour: str("user.colour", u.colour) };
}

export function parseCounters(input: unknown): ApiCounters {
  const c = obj("counters", input);
  const out: ApiCounters = {};
  for (const [ns, count] of Object.entries(c)) {
    if (!Number.isFinite(count)) field(`counters.${ns}`, "is not a number");
    out[ns] = count as number;
  }
  return out;
}

export const API_VERSION = "v1";

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
  writeCounter(ns: string, body: Record<string, unknown>): Promise<ApiCounters>;
};

export type ClientOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };

export function createClient(base: string, options: ClientOptions = {}): ServiceClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const root = base.replace(/\/$/, "");

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await doFetch(`${root}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
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
    return e instanceof Error ? e.message : String(e);
  }
}
