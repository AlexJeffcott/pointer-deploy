import type { BuildInfo } from "@pointer/blocks";
import type { ServiceField, ServiceReport, ServiceRoute, ShellStore } from "./api.ts";
import { NO_SERVICE } from "./api.ts";

/**
 * A snapshot, as far as this shell keeps one: the address, and when it was kept.
 *
 * `PLAN.md` step 6. The address is what a person copies and what another
 * browser pulls. `createdAt` is the service's own stamp on the bytes, and the
 * pull door uses it as the document's `exportedAt` - so a pulled planner is
 * stamped by the service that kept it rather than by whoever wrote the file.
 */
export type PushedSnapshot = { snapshot: string; createdAt: string };

/**
 * What a pull hands the door, and deliberately not a document.
 *
 * The members are passed through as they arrived, `unknown` and unchecked,
 * because `readPlanner` is what refuses them BY NAME and a parser here would
 * refuse them first with a sentence about an API field. A snapshot whose
 * `format` is "" is the service reporting a body that was never a planner, and
 * that has to reach the door as a value rather than as a boundary error.
 */
export type PulledSnapshot = { digest: string; document: Record<string, unknown> };

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
  /**
   * One call at `API_VERSION`, whose BODY is not read.
   *
   * The reading is whether the version this shell calls answers, and nothing
   * about the answer's shape. Parsing it put a `greeting.text is missing` on
   * `data-api` for a service that was answering `v1` perfectly well, under a
   * doc comment claiming the opposite - a response the page keeps nothing from
   * cannot be the wrong shape for it.
   */
  data(): Promise<void>;
  discovery(): Promise<Discovery>;
  /**
   * Writes the planner into the service's bucket and returns its address.
   *
   * Takes BYTES and not a document. The address is the sha256 of what was sent,
   * so the value hashed has to be the value on the wire: serialising here and
   * again in the caller would be two byte strings and, for a document that
   * round-trips differently, two addresses for one planner.
   */
  push(body: string): Promise<PushedSnapshot>;
  /** Reads one snapshot back. The document is refused by the door, not here. */
  pull(digest: string): Promise<PulledSnapshot>;
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
    const said = res.headers.get("sunset");
    if (said) sunset = said;
    // A refusal's body is read leniently and an answer's is not, and the two
    // are deliberately apart. The service sends `{"error":"..."}` with every
    // status it refuses on, and that sentence is what a person can act on -
    // "not found" says the address holds nothing, where a status alone sends
    // them to a table of codes. But a body that never finished arriving is not
    // an answer, and reading THAT leniently would let a truncated response read
    // as one. `a response whose body never arrives is a fault` is the reading.
    if (!res.ok) {
      const why = (await res.json().catch(() => null)) as { error?: unknown } | null;
      const named = typeof why?.error === "string" ? `: ${why.error}` : "";
      throw new Error(`${init?.method ?? "GET"} ${path} responded ${res.status}${named}`);
    }
    return res.json();
  }


  return {
    // The status and the `Sunset` header, and nothing out of the body. `call`
    // still reads the JSON, because a body this shell never looked at would let
    // a truncated response read as an answer.
    data: async () => {
      await call(`/${API_VERSION}`);
    },
    // Not under a version prefix. The document says which versions there are,
    // so asking for it at one of them would need the answer first.
    discovery: async () => parseDiscovery(await call(`/versions`)),
    push: async (body) => {
      const said = obj(
        "snapshot",
        await call(`/${API_VERSION}/snapshots`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body,
        }),
      );
      // The two members the PAGE keeps, and the only two checked here. A
      // response that carried no address would otherwise put "undefined" on
      // screen as the thing to copy into another browser.
      return {
        snapshot: str("snapshot.snapshot", said.snapshot),
        createdAt: str("snapshot.createdAt", said.createdAt),
      };
    },
    pull: async (digest) => {
      const said = obj("snapshot", await call(`/${API_VERSION}/snapshots/${digest}`));
      // Rebuilt into the shape the document rule reads, and nothing is checked
      // on the way. `exportedAt` is the SERVICE's stamp: the document that was
      // pushed carried one of its own, and v1 does not answer with it, so the
      // honest value is when these bytes were kept rather than a field this
      // shell invented.
      return {
        digest,
        document: {
          format: said.format,
          schemaVersion: said.schemaVersion,
          exportedAt: said.createdAt,
          tasks: said.tasks,
        },
      };
    },
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
 * Neither of those is a reading about the BODY, and until 2026-09-11 this ran
 * the response through a parser that required `greeting.text`. A service
 * answering `v1` with a body this page keeps nothing from then put
 * `api field greeting.text is missing or not a string` on `data-api`, under
 * this comment. The parser went with the field nobody draws.
 *
 * Never throws, and returns "ok" or what went wrong. A service that is not
 * there costs the page the reading and not the page.
 */
export async function readData(client: ServiceClient): Promise<string> {
  try {
    await client.data();
    return "ok";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
