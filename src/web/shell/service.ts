import type { BuildInfo } from "@pointer/blocks";
import type {
  Flags,
  Labels,
  Limits,
  Motd,
  ServiceField,
  ServiceReport,
  ServiceRoute,
  Settings,
  ShellStore,
  Stats,
} from "./api.ts";
import { NO_SERVICE } from "./api.ts";

export type ApiTheme = { colour: string; dark: boolean };
export type ApiUser = { name: string; colour: string; initials: string; theme: ApiTheme };
export type ApiCounters = Record<string, number>;
export type ApiLimits = { step: number; max: number; allowNegative: boolean };
export type ApiLabel = { title: string; emoji: string };
export type ApiLabels = Record<string, ApiLabel>;
export type ApiFlags = { showShares: boolean; showTotals: boolean; compact: boolean };
export type ApiStats = { total: number; busiest: string | null; updatedAt: string };
export type ApiMotd = { text: string; level: "info" | "warn"; until: string } | null;

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

const num = (name: string, value: unknown): number =>
  typeof value === "number" && Number.isFinite(value) ? value : field(name, "is not a number");

const bool = (name: string, value: unknown): boolean =>
  typeof value === "boolean" ? value : field(name, "is not a boolean");

/**
 * Strict about what the page cannot draw without, tolerant about the rest.
 *
 * `name` and `colour` are required: a response without them is a response this
 * shell cannot use, and saying so by field is the whole reason this parser
 * exists. `initials` and `theme` were added to the service later, so absent
 * means an OLDER deploy and not a fault - the mirror of the rule that lets a
 * service add a field without breaking a shell published last month.
 */
export function parseUser(input: unknown): ApiUser {
  const u = obj("user", input);
  // Read in the order a person reads them, so a response missing two fields
  // names the first one rather than whichever the object literal happened to
  // evaluate first.
  const name = str("user.name", u.name);
  const colour = str("user.colour", u.colour);
  const theme = u.theme === undefined ? {} : obj("user.theme", u.theme);
  return {
    name,
    colour,
    initials: u.initials === undefined ? "" : str("user.initials", u.initials),
    theme: {
      colour: theme.colour === undefined ? colour : str("user.theme.colour", theme.colour),
      dark: theme.dark === undefined ? false : bool("user.theme.dark", theme.dark),
    },
  };
}

export function parseLimits(input: unknown): ApiLimits {
  const l = obj("limits", input);
  return {
    step: num("limits.step", l.step),
    max: num("limits.max", l.max),
    allowNegative: bool("limits.allowNegative", l.allowNegative),
  };
}

export function parseLabels(input: unknown): ApiLabels {
  const all = obj("labels", input);
  const out: ApiLabels = {};
  for (const [ns, entry] of Object.entries(all)) {
    const label = obj(`labels.${ns}`, entry);
    out[ns] = {
      title: str(`labels.${ns}.title`, label.title),
      // Empty is a legitimate emoji: it means the service holds none, and a
      // panel draws the row without one. So it is checked for TYPE and not for
      // length, which is the one place `str` is the wrong helper.
      emoji: typeof label.emoji === "string" ? label.emoji : field(`labels.${ns}.emoji`, "is not a string"),
    };
  }
  return out;
}

export function parseFlags(input: unknown): ApiFlags {
  const f = obj("flags", input);
  return {
    showShares: bool("flags.showShares", f.showShares),
    showTotals: bool("flags.showTotals", f.showTotals),
    compact: bool("flags.compact", f.compact),
  };
}

export function parseStats(input: unknown): ApiStats {
  const s = obj("stats", input);
  const busiest = s.busiest;
  if (busiest !== null && typeof busiest !== "string") {
    field("stats.busiest", "is neither a namespace nor null");
  }
  return {
    total: num("stats.total", s.total),
    busiest: busiest as string | null,
    updatedAt: str("stats.updatedAt", s.updatedAt),
  };
}

/** Null is a value here: it is how the service says there is no message. */
export function parseMotd(input: unknown): ApiMotd {
  if (input === null) return null;
  const m = obj("motd", input);
  const level = m.level;
  if (level !== "info" && level !== "warn") field("motd.level", 'is neither "info" nor "warn"');
  return {
    text: str("motd.text", m.text),
    level: level as "info" | "warn",
    until: str("motd.until", m.until),
  };
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
  user(): Promise<ApiUser>;
  counters(): Promise<ApiCounters>;
  setUser(patch: Partial<ApiUser>): Promise<ApiUser>;
  writeCounter(ns: string, body: Record<string, unknown>): Promise<ApiCounters>;
  limits(): Promise<ApiLimits>;
  labels(): Promise<ApiLabels>;
  flags(): Promise<ApiFlags>;
  stats(): Promise<ApiStats>;
  motd(): Promise<ApiMotd>;
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
    user: async () => parseUser(await call(`/${API_VERSION}/user`)),
    counters: async () => parseCounters(await call(`/${API_VERSION}/counters`)),
    setUser: async (patch) => parseUser(await write(`/${API_VERSION}/user`, patch)),
    writeCounter: async (ns, body) =>
      parseCounters(await write(`/${API_VERSION}/counters/${encodeURIComponent(ns)}`, body)),
    limits: async () => parseLimits(await call(`/${API_VERSION}/limits`)),
    labels: async () => parseLabels(await call(`/${API_VERSION}/labels`)),
    flags: async () => parseFlags(await call(`/${API_VERSION}/flags`)),
    stats: async () => parseStats(await call(`/${API_VERSION}/stats`)),
    motd: async () => parseMotd(await call(`/${API_VERSION}/motd`)),
    // Not under a version prefix. The document says which versions there are,
    // so asking for it at one of them would need the answer first.
    discovery: async () => parseDiscovery(await call(`/versions`)),
    lastSunset: () => sunset,
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
    setUser: (next) => store.setUser(next),
    countOf: (ns) => store.countOf(ns),
    snapshot: () => store.snapshot(),
    limits: () => store.limits(),
    labelFor: (ns) => store.labelFor(ns),
    flags: () => store.flags(),
    stats: () => store.stats(),
    motd: () => store.motd(),
    setSettings: (next) => store.setSettings(next),
    service: () => store.service(),
    setService: (report) => store.setService(report),
    goingAway: (path) => store.goingAway(path),
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
 * Reads the five settings resources, and keeps whatever answered.
 *
 * `allSettled` rather than `all`, because these are five separate routes on one
 * service and an older deploy answers 404 for some of them. Losing the four
 * that worked because the fifth is not there yet would make every addition to
 * the service a breaking change for every shell already published.
 *
 * Returns the resources that did not answer, in the order they were asked for.
 */
export async function readSettings(store: ShellStore, client: ServiceClient): Promise<string[]> {
  const asked = [
    ["limits", client.limits()],
    ["labels", client.labels()],
    ["flags", client.flags()],
    ["stats", client.stats()],
    ["motd", client.motd()],
  ] as const;

  const settled = await Promise.allSettled(asked.map(([, p]) => p));
  const next: Partial<Settings> = {};
  const missing: string[] = [];

  settled.forEach((result, i) => {
    const name = asked[i]![0];
    if (result.status === "rejected") {
      missing.push(name);
      return;
    }
    if (name === "limits") next.limits = result.value as Limits;
    if (name === "labels") next.labels = result.value as Labels;
    if (name === "flags") next.flags = result.value as Flags;
    if (name === "stats") next.stats = result.value as Stats;
    if (name === "motd") next.motd = result.value as Motd;
  });

  store.setSettings(next);
  return missing;
}

export async function hydrate(store: ShellStore, client: ServiceClient): Promise<string> {
  try {
    const [user, counters] = await Promise.all([client.user(), client.counters()]);
    store.setUser(user);
    for (const [ns, count] of Object.entries(counters)) {
      store.register(ns);
      if (count !== 0) store.increment(ns, count);
    }
    return "ok";
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}
