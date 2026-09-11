import type { BuildInfo } from "@pointer/blocks";
import type { ServiceField, ServiceReport, ServiceRoute, ShellStore } from "./api.ts";
import { NO_SERVICE } from "./api.ts";

/**
 * The one resource this service holds, as it holds it.
 *
 * Declared HERE and no longer in `api.ts`, and the move is the point. No unit
 * draws the service's greeting - `PLAN.md` step 0 removed the panel that did -
 * so it stopped being something the shell provides to a sub-app and became
 * something the shell reads at a boundary. `PLAN.md` step 6 is where the
 * resource itself goes and snapshots take its place.
 */
export type ApiGreeting = { text: string; audience: string };

/**
 * The service's own account of what it holds, §26.
 *
 * `versions` is OPTIONAL, and that is the whole reading. A service deployed
 * before §26 answers `{"serves":["v1"]}` and nothing else, so a shell that
 * demanded a schema would report a working service as broken. Absent means
 * "this deploy publishes no schema", which is a different fact from "this
 * deploy has no fields" and is drawn differently.
 */
export type Discovery = {
  serves: string[];
  versions: Record<string, { routes: ServiceRoute[]; fields: ServiceField[] }> | null;
};

const field = (name: string, why: string): never => {
  throw new Error(`api field ${name} ${why}`);
};

const str = (name: string, value: unknown): string =>
  typeof value === "string" && value.length > 0 ? value : field(name, "is missing or not a string");

const obj = (name: string, value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : field(name, "is not an object");

/**
 * Strict about what the page cannot draw without, tolerant about the rest.
 *
 * `text` is required: a response without it is a response this shell cannot
 * use, and saying so by field is the whole reason this parser exists.
 * `audience` was added to the service later, so absent means an OLDER deploy
 * and not a fault - the mirror of the rule that lets a service add a field
 * without breaking a shell published last month.
 */
export function parseGreeting(input: unknown): ApiGreeting {
  const g = obj("greeting", input);
  return {
    text: str("greeting.text", g.text),
    // Empty is a legitimate audience: it means the service holds none, and the
    // panel greets nobody in particular. So it is checked for TYPE and not for
    // length, which is the one place `str` is the wrong helper.
    audience:
      g.audience === undefined
        ? ""
        : typeof g.audience === "string"
          ? g.audience
          : field("greeting.audience", "is not a string"),
  };
}

/**
 * The discovery document, read at the boundary like every other response.
 *
 * Unknown members are IGNORED, deliberately. The service and this shell are
 * deployed on separate schedules, so a field added there this afternoon has to
 * reach a shell published last month without breaking it - the same tolerance
 * `parseApiVersions` has in the server, and the reason an additive change to
 * the document is not a version bump.
 */
export function parseDiscovery(input: unknown): Discovery {
  const doc = obj("versions", input);
  if (!Array.isArray(doc.serves)) field("serves", "is not an array");
  const serves = (doc.serves as unknown[]).map((v, i) =>
    typeof v === "string" && v.length > 0 ? v : field(`serves[${i}]`, "is not a string"),
  );

  if (!("versions" in doc)) return { serves, versions: null };
  const versions = obj("versions", doc.versions);

  return {
    serves,
    versions: Object.fromEntries(
      Object.entries(versions).map(([v, body]) => {
        const spec = obj(`versions.${v}`, body);
        return [
          v,
          {
            routes: parseList(spec.routes, `versions.${v}.routes`, (r, at) => ({
              method: str(`${at}.method`, r.method),
              path: str(`${at}.path`, r.path),
            })),
            fields: parseList(spec.fields, `versions.${v}.fields`, (f, at) => ({
              path: str(`${at}.path`, f.path),
              type: str(`${at}.type`, f.type),
              going: parseSunset(f.deprecated, `${at}.deprecated`),
            })),
          },
        ];
      }),
    ),
  };
}

function parseList<T>(
  input: unknown,
  name: string,
  each: (entry: Record<string, unknown>, at: string) => T,
): T[] {
  if (input === undefined) return [];
  if (!Array.isArray(input)) field(name, "is not an array");
  return (input as unknown[]).map((entry, i) => each(obj(`${name}[${i}]`, entry), `${name}[${i}]`));
}

function parseSunset(input: unknown, name: string): ServiceField["going"] {
  if (input === undefined || input === null) return null;
  const d = obj(name, input);
  const instead = d.instead;
  if (instead !== null && instead !== undefined && typeof instead !== "string") {
    field(`${name}.instead`, "is neither a field name nor null");
  }
  return {
    since: str(`${name}.since`, d.since),
    sunset: str(`${name}.sunset`, d.sunset),
    reason: str(`${name}.reason`, d.reason),
    instead: (instead as string | null | undefined) ?? null,
  };
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
  greeting(): Promise<ApiGreeting>;
  setGreeting(patch: Partial<ApiGreeting>): Promise<ApiGreeting>;
  discovery(): Promise<Discovery>;
  /**
   * The `Sunset` header the last DATA response carried, or null.
   *
   * Read off the responses the page was already making rather than by asking
   * again. A header only reaches this at all because the service sends
   * `access-control-expose-headers`; without it a cross-origin page gets the
   * body and not the warning attached to it.
   */
  lastSunset(): string | null;
};

export type ClientOptions = { fetchImpl?: typeof fetch; timeoutMs?: number };

export function createClient(base: string, options: ClientOptions = {}): ServiceClient {
  const doFetch = options.fetchImpl ?? fetch;
  const timeoutMs = options.timeoutMs ?? 5_000;
  const root = base.replace(/\/$/, "");
  let sunset: string | null = null;

  async function call(path: string, init?: RequestInit): Promise<unknown> {
    const res = await doFetch(`${root}${path}`, { ...init, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) throw new Error(`GET ${path} responded ${res.status}`);
    const said = res.headers.get("sunset");
    if (said) sunset = said;
    return res.json();
  }

  const write = (path: string, body: unknown): Promise<unknown> =>
    call(path, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  return {
    greeting: async () => parseGreeting(await call(`/${API_VERSION}/greeting`)),
    setGreeting: async (patch) => parseGreeting(await write(`/${API_VERSION}/greeting`, patch)),
    // Not under a version prefix. The document says which versions there are,
    // so asking for it at one of them would need the answer first.
    discovery: async () => parseDiscovery(await call(`/versions`)),
    lastSunset: () => sunset,
  };
}

/**
 * The report a page starts with, before anything has been read.
 *
 * Set BEFORE the fetch, so the first paint says which service is being read
 * and that it has not answered yet. A panel drawn from an empty report and a
 * panel drawn from a failed one would look the same, and they are not.
 */
export const awaiting = (base: string): ServiceReport => ({
  ...NO_SERVICE,
  base,
  calling: API_VERSION,
});

/** Reads the discovery document into the store. Never throws. */
export async function readService(store: ShellStore, client: ServiceClient): Promise<string> {
  const base = store.service().base;
  try {
    const doc = await client.discovery();
    const spec = doc.versions?.[API_VERSION];
    store.setService({
      ...store.service(),
      base,
      state: "ok",
      serves: doc.serves,
      calling: API_VERSION,
      routes: spec?.routes ?? [],
      fields: spec?.fields ?? [],
      error: null,
      readAt: new Date().toISOString(),
    });
    return "ok";
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    store.setService({ ...store.service(), base, state: "failed", error: message });
    return message;
  }
}

/** Folds the `Sunset` header the data responses carried into the report. */
export function noteSunset(store: ShellStore, client: ServiceClient): void {
  const seen = client.lastSunset();
  const report = store.service();
  if (seen !== report.headerSunset) store.setService({ ...report, headerSunset: seen });
}

/**
 * The one DATA call this page makes, at the version it was built against.
 *
 * Nothing is stored from the body, and that is not an oversight. Since
 * `PLAN.md` step 0 no unit draws the service's greeting, so what the call is
 * for is the RESPONSE, and two readings depend on having made one:
 *
 *   - whether the version this shell calls answers at all. The discovery
 *     document is served from `/versions`, outside any version prefix, so
 *     reading it says nothing about `API_VERSION`. `index.tsx` puts the answer
 *     on the page as `data-api`;
 *   - the `Sunset` header a data response carried, RFC 8594, which
 *     `noteSunset` folds into the report and `/service` draws. A document and a
 *     response can disagree, which is the whole reason the report keeps both.
 *
 * Never throws, and returns "ok" or what went wrong. A service that is not
 * there costs the page the reading and not the page.
 */
export async function readData(client: ServiceClient): Promise<string> {
  try {
    await client.greeting();
    return "ok";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
