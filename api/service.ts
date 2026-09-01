// The service the units do not build alongside, §13.
//
// Two things are published here, and the difference between them is the whole
// point of §26:
//
//   SERVES        which versions this deploy answers. An operator's choice, in
//                 the environment, changed with `fly secrets set` and no build.
//   FIELDS        what is INSIDE a version. Declared here, beside the handlers
//                 that return them, because there is no compiler to measure it
//                 from - the shell reaches this service over HTTP and shares no
//                 type with it.
//
// A field can be marked as going away without any code change at all:
// API_DEPRECATED carries the decision, the discovery document reports it, and
// every response that would have carried that field says so in its headers.
// That is the same shape as `contract:deprecate` for the internal contract -
// a warning, never a refusal - and for the same reason: a page that stops
// working on the day a field is deprecated is worse than the fault it reports.

export const SERVES: string[] = (Bun.env.API_SERVES ?? "v1")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

export type ApiTheme = { colour: string; dark: boolean };
export type ApiUser = { name: string; colour: string; initials: string; theme: ApiTheme };

/** What a panel is allowed to do to a counter. */
export type ApiLimits = { step: number; max: number; allowNegative: boolean };

/** How a namespace is drawn. One entry per namespace, and none is required. */
export type ApiLabel = { title: string; emoji: string };
export type ApiLabels = Record<string, ApiLabel>;

/** Which optional parts of a panel are drawn at all. */
export type ApiFlags = { showShares: boolean; showTotals: boolean; compact: boolean };

/**
 * Read-only, and computed here rather than stored.
 *
 * `total` exists so that a panel adding the counters up itself has something to
 * disagree with. Two numbers that should match and are produced on opposite
 * sides of a network are the only way a page can show that the boundary is
 * real.
 */
export type ApiStats = { total: number; busiest: string | null; updatedAt: string };

/** A message for the frame, or nothing. Null is a value here, not an absence. */
export type ApiMotd = { text: string; level: "info" | "warn"; until: string } | null;

export type ApiState = {
  user: ApiUser;
  counters: Record<string, number>;
  countersChangedAt: string;
  limits: ApiLimits;
  labels: ApiLabels;
  flags: ApiFlags;
  motd: ApiMotd;
};

export const createState = (): ApiState => ({
  user: {
    name: "Alex",
    colour: "#1f5fd0",
    initials: "AJ",
    theme: { colour: "#1f5fd0", dark: false },
  },
  counters: {},
  countersChangedAt: new Date().toISOString(),
  limits: { step: 5, max: 100, allowNegative: true },
  labels: {
    alpha: { title: "Alpha", emoji: "\u25b2" },
    bravo: { title: "Bravo", emoji: "\u25c6" },
    charlie: { title: "Charlie", emoji: "\u25cf" },
    delta: { title: "Delta", emoji: "\u25bc" },
  },
  flags: { showShares: true, showTotals: true, compact: false },
  motd: null,
});

/** Derived on every read, from the counters as they are at that moment. */
export function statsOf(state: ApiState): ApiStats {
  const entries = Object.entries(state.counters);
  const busiest = entries.length
    ? entries.reduce((a, b) => (b[1] > a[1] ? b : a))[0]
    : null;
  return {
    total: entries.reduce((n, [, v]) => n + v, 0),
    busiest,
    updatedAt: state.countersChangedAt,
  };
}

/** What one version of this service returns. Declared, not measured. */
export type ApiField = { path: string; type: string };
export type ApiRoute = { method: string; path: string };

export const FIELDS: Record<string, ApiField[]> = {
  v1: [
    { path: "user.name", type: "string" },
    { path: "user.colour", type: "string" },
    { path: "user.initials", type: "string" },
    { path: "user.theme.colour", type: "string" },
    { path: "user.theme.dark", type: "boolean" },
    { path: "counters.<ns>", type: "number" },
    { path: "limits.step", type: "number" },
    { path: "limits.max", type: "number" },
    { path: "limits.allowNegative", type: "boolean" },
    { path: "labels.<ns>.title", type: "string" },
    { path: "labels.<ns>.emoji", type: "string" },
    { path: "flags.showShares", type: "boolean" },
    { path: "flags.showTotals", type: "boolean" },
    { path: "flags.compact", type: "boolean" },
    { path: "stats.total", type: "number" },
    { path: "stats.busiest", type: "string | null" },
    { path: "stats.updatedAt", type: "string" },
    { path: "motd.text", type: "string" },
    { path: "motd.level", type: "info | warn" },
    { path: "motd.until", type: "string" },
  ],
};

export const ROUTES: Record<string, ApiRoute[]> = {
  v1: [
    { method: "GET", path: "/user" },
    { method: "POST", path: "/user" },
    { method: "GET", path: "/counters" },
    { method: "POST", path: "/counters/<ns>" },
    { method: "GET", path: "/limits" },
    { method: "POST", path: "/limits" },
    { method: "GET", path: "/labels" },
    { method: "POST", path: "/labels" },
    { method: "GET", path: "/flags" },
    { method: "POST", path: "/flags" },
    // Read only. It is derived from the counters, so writing it would be
    // writing an answer the next read would throw away.
    { method: "GET", path: "/stats" },
    { method: "GET", path: "/motd" },
    { method: "POST", path: "/motd" },
  ],
};

/**
 * A field that is going away.
 *
 * `since` is when the decision took effect and `sunset` is when the field
 * stops being answered. Both are dates rather than one, because RFC 9745
 * `Deprecation` and RFC 8594 `Sunset` are two separate readings and an
 * operator needs them apart: "it is deprecated" and "it is gone" are different
 * days, and the gap between them is the notice period.
 */
export type ApiDeprecation = {
  path: string;
  since: string;
  sunset: string;
  reason: string;
  instead: string | null;
};

const date = (label: string, value: unknown): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`API_DEPRECATED ${label} is not a YYYY-MM-DD date: ${JSON.stringify(value)}`);
  }
  // Round-tripped rather than parsed. `Date.parse` rolls an overflowing day
  // into the next month, so 2026-02-31 reads as 3 March and a typed date the
  // operator meant as the end of February would silently move.
  const when = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(when.getTime()) || when.toISOString().slice(0, 10) !== value) {
    throw new Error(`API_DEPRECATED ${label} is not a date that exists: ${value}`);
  }
  return value;
};

/**
 * Reads the operator's decision out of the environment.
 *
 * It THROWS, so a malformed value stops the process rather than being ignored.
 * A service that swallowed the error would publish "nothing is going away",
 * which is not silence - it is a false reading, and the operator who set the
 * variable has no way to tell it from a working one.
 *
 * `known` is checked for the same reason. `user.color` is a plausible thing to
 * type and names no field this service has, so it is refused here rather than
 * reported to every page as a deprecation nobody can act on.
 */
export function parseDeprecations(raw: string, known: readonly string[]): ApiDeprecation[] {
  const text = raw.trim();
  if (text === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`API_DEPRECATED is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("API_DEPRECATED is not an array");

  return parsed.map((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`API_DEPRECATED[${i}] is not an object`);
    }
    const e = entry as Record<string, unknown>;
    const path = e.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new Error(`API_DEPRECATED[${i}].path is not a non-empty string`);
    }
    if (!known.includes(path)) {
      throw new Error(
        `API_DEPRECATED[${i}].path names ${path}, which this service does not answer. ` +
          `It answers ${known.join(", ")}.`,
      );
    }
    const reason = e.reason;
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(`API_DEPRECATED[${i}].reason is missing. A deprecation has to say why.`);
    }
    if (!("instead" in e)) {
      throw new Error(
        `API_DEPRECATED[${i}].instead is missing. Name the field to move to, or null. ` +
          `Nothing to move to is a legitimate reading and has to be said out loud.`,
      );
    }
    const instead = e.instead;
    if (instead !== null && (typeof instead !== "string" || instead.length === 0)) {
      throw new Error(`API_DEPRECATED[${i}].instead is neither a field name nor null`);
    }
    const since = date(`[${i}].since`, e.since);
    const sunset = date(`[${i}].sunset`, e.sunset);
    if (Date.parse(`${sunset}T00:00:00Z`) < Date.parse(`${since}T00:00:00Z`)) {
      throw new Error(`API_DEPRECATED[${i}] sunsets ${sunset}, before it was deprecated ${since}`);
    }
    return { path, since, sunset, reason: reason.trim(), instead };
  });
}

/** Every field path this deploy answers, across every version it serves. */
export const answered = (serves: readonly string[] = SERVES): string[] => [
  ...new Set(serves.flatMap((v) => (FIELDS[v] ?? []).map((f) => f.path))),
];

export const DEPRECATED: ApiDeprecation[] = parseDeprecations(
  Bun.env.API_DEPRECATED ?? "",
  answered(),
);

/** The discovery document, §26. `serves` stays first and stays a list of strings. */
export function discovery(
  serves: readonly string[] = SERVES,
  deprecated: readonly ApiDeprecation[] = DEPRECATED,
): Record<string, unknown> {
  return {
    serves: [...serves],
    versions: Object.fromEntries(
      serves.map((v) => [
        v,
        {
          routes: (ROUTES[v] ?? []).map((r) => ({ ...r, path: `/${v}${r.path}` })),
          fields: (FIELDS[v] ?? []).map((f) => {
            const going = deprecated.find((d) => d.path === f.path);
            return going
              ? {
                  ...f,
                  deprecated: {
                    since: going.since,
                    sunset: going.sunset,
                    reason: going.reason,
                    instead: going.instead,
                  },
                }
              : f;
          }),
        },
      ]),
    ),
  };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  // Without this a cross-origin page can read the body and NOT the two headers
  // below it, so the deprecation would be published to everything except the
  // thing that has to act on it.
  "access-control-expose-headers": "deprecation, sunset, link",
  // Stryker disable next-line StringLiteral: cache duration, not behaviour.
  "access-control-max-age": "600",
};

const seconds = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
const httpDate = (day: string): string => new Date(`${day}T00:00:00Z`).toUTCString();

/**
 * The deprecations a response carrying `top` has to declare.
 *
 * Matched on the first segment of the field path, because that is what a body
 * holds: `GET /v1/user` returns the object every `user.*` field lives in, so a
 * deprecation of `user.colour` is a fact about that response.
 */
export const deprecationsFor = (
  top: string,
  deprecated: readonly ApiDeprecation[] = DEPRECATED,
): ApiDeprecation[] => deprecated.filter((d) => d.path.split(".")[0] === top);

/**
 * RFC 9745 `Deprecation` and RFC 8594 `Sunset`, for the earliest of them.
 *
 * One response, one pair of headers, and two deprecated fields in the same
 * body cannot each have their own. The earliest sunset is the one an operator
 * has least time to act on, so that is the one reported; the discovery
 * document carries the rest, field by field.
 */
export function deprecationHeaders(
  matched: readonly ApiDeprecation[],
  origin: string,
): Record<string, string> {
  if (matched.length === 0) return {};
  const soonest = [...matched].sort((a, b) => a.sunset.localeCompare(b.sunset))[0]!;
  return {
    deprecation: `@${seconds(soonest.since)}`,
    sunset: httpDate(soonest.sunset),
    link: `<${origin}/versions>; rel="deprecation"`,
  };
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...extra,
    },
  });

const refuse = (field: string, why: string) => json({ error: `${field} ${why}` }, 400);

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

const num = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const bool = (value: unknown): boolean | null => (typeof value === "boolean" ? value : null);

const day = (value: unknown): string | null => {
  const text = str(value);
  if (text === null || !/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const when = new Date(`${text}T00:00:00Z`);
  return Number.isNaN(when.getTime()) || when.toISOString().slice(0, 10) !== text ? null : text;
};

const readBody = async (req: Request): Promise<Record<string, unknown> | null> => {
  const body = (await req.json().catch(() => null)) as unknown;
  return body && typeof body === "object" && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : null;
};

export async function handle(req: Request, state: ApiState): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  // Stryker disable next-line ObjectLiteral: 200 is what an empty init means.
  if (pathname === "/healthz") return new Response("ok", { status: 200 });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (pathname === "/versions") return json(discovery());

  const route = /^\/([^/]+)\/(.*)$/.exec(pathname);
  if (!route || !SERVES.includes(route[1]!)) return json({ error: "not found" }, 404);
  const rest = `/${route[2]}`;

  const going = (top: string) => deprecationHeaders(deprecationsFor(top), url.origin);

  if (rest === "/user") {
    if (req.method === "GET") return json(state.user, 200, going("user"));
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!body) return refuse("body", "is not an object");
      const named = ["name", "colour", "initials", "theme"].filter((f) => f in body);
      if (named.length === 0) return refuse("body", "names no field of the user");

      const name = "name" in body ? str(body.name) : null;
      const colour = "colour" in body ? str(body.colour) : null;
      const initials = "initials" in body ? str(body.initials) : null;
      if ("name" in body && name === null) return refuse("name", "is not a non-empty string");
      if ("colour" in body && colour === null) return refuse("colour", "is not a non-empty string");
      if ("initials" in body && initials === null) {
        return refuse("initials", "is not a non-empty string");
      }

      let theme = state.user.theme;
      if ("theme" in body) {
        const patch = body.theme;
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
          return refuse("theme", "is not an object");
        }
        const t = patch as Record<string, unknown>;
        const themeColour = "colour" in t ? str(t.colour) : null;
        const dark = "dark" in t ? bool(t.dark) : null;
        if ("colour" in t && themeColour === null) {
          return refuse("theme.colour", "is not a non-empty string");
        }
        if ("dark" in t && dark === null) return refuse("theme.dark", "is not a boolean");
        theme = { colour: themeColour ?? theme.colour, dark: dark ?? theme.dark };
      }

      state.user = {
        name: name ?? state.user.name,
        colour: colour ?? state.user.colour,
        initials: initials ?? state.user.initials,
        theme,
      };
      return json(state.user, 200, going("user"));
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (rest === "/counters") {
    if (req.method === "GET") return json(state.counters, 200, going("counters"));
    return json({ error: "method not allowed" }, 405);
  }

  if (rest === "/stats") {
    if (req.method === "GET") return json(statsOf(state), 200, going("stats"));
    // Derived from the counters, so a write here would be an answer the next
    // read throws away. Refused rather than accepted and ignored.
    return json({ error: "method not allowed" }, 405);
  }

  if (rest === "/limits") {
    if (req.method === "GET") return json(state.limits, 200, going("limits"));
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!body) return refuse("body", "is not an object");
      const named = ["step", "max", "allowNegative"].filter((f) => f in body);
      if (named.length === 0) return refuse("body", "names no limit");

      const step = "step" in body ? num(body.step) : null;
      const max = "max" in body ? num(body.max) : null;
      const allowNegative = "allowNegative" in body ? bool(body.allowNegative) : null;
      if ("step" in body && step === null) return refuse("step", "is not a number");
      if ("max" in body && max === null) return refuse("max", "is not a number");
      if ("allowNegative" in body && allowNegative === null) {
        return refuse("allowNegative", "is not a boolean");
      }
      // A step of zero makes every button on the page do nothing, which looks
      // exactly like a page that has stopped working.
      if (step !== null && step < 1) return refuse("step", "is below 1");
      if (max !== null && max < 0) return refuse("max", "is below 0");

      state.limits = {
        step: step ?? state.limits.step,
        max: max ?? state.limits.max,
        allowNegative: allowNegative ?? state.limits.allowNegative,
      };
      return json(state.limits, 200, going("limits"));
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (rest === "/labels") {
    if (req.method === "GET") return json(state.labels, 200, going("labels"));
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!body) return refuse("body", "is not an object");
      if (Object.keys(body).length === 0) return refuse("body", "names no namespace");

      const next: ApiLabels = { ...state.labels };
      for (const [ns, patch] of Object.entries(body)) {
        if (!patch || typeof patch !== "object" || Array.isArray(patch)) {
          return refuse(ns, "is not an object");
        }
        const entry = patch as Record<string, unknown>;
        const title = "title" in entry ? str(entry.title) : null;
        const emoji = "emoji" in entry ? str(entry.emoji) : null;
        if ("title" in entry && title === null) {
          return refuse(`${ns}.title`, "is not a non-empty string");
        }
        if ("emoji" in entry && emoji === null) {
          return refuse(`${ns}.emoji`, "is not a non-empty string");
        }
        const held = next[ns] ?? { title: ns, emoji: "" };
        next[ns] = { title: title ?? held.title, emoji: emoji ?? held.emoji };
      }
      state.labels = next;
      return json(state.labels, 200, going("labels"));
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (rest === "/flags") {
    if (req.method === "GET") return json(state.flags, 200, going("flags"));
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!body) return refuse("body", "is not an object");
      const named = ["showShares", "showTotals", "compact"].filter((f) => f in body);
      if (named.length === 0) return refuse("body", "names no flag");

      const next = { ...state.flags };
      for (const flag of named as (keyof ApiFlags)[]) {
        const value = bool(body[flag]);
        if (value === null) return refuse(flag, "is not a boolean");
        next[flag] = value;
      }
      state.flags = next;
      return json(state.flags, 200, going("flags"));
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (rest === "/motd") {
    if (req.method === "GET") return json(state.motd, 200, going("motd"));
    if (req.method === "POST") {
      // `null` is how a message is taken down. It has to be a value the route
      // accepts, or the only way to clear one would be to restart the service.
      const raw = (await req.json().catch(() => undefined)) as unknown;
      if (raw === null) {
        state.motd = null;
        return json(state.motd, 200, going("motd"));
      }
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        return refuse("body", "is neither an object nor null");
      }
      const body = raw as Record<string, unknown>;
      const text = str(body.text);
      const level = body.level === "info" || body.level === "warn" ? body.level : null;
      const until = day(body.until);
      if (text === null) return refuse("text", "is not a non-empty string");
      if (level === null) return refuse("level", 'is neither "info" nor "warn"');
      if (until === null) return refuse("until", "is not a YYYY-MM-DD date that exists");
      state.motd = { text, level, until };
      return json(state.motd, 200, going("motd"));
    }
    return json({ error: "method not allowed" }, 405);
  }

  const counter = /^\/counters\/([^/]+)$/.exec(rest);
  if (counter) {
    const ns = decodeURIComponent(counter[1]!);
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const body = await readBody(req);
    if (!body) return refuse("body", "is not an object");

    if (body.reset === true) state.counters = { ...state.counters, [ns]: 0 };
    else if (body.register === true) {
      if (!(ns in state.counters)) state.counters = { ...state.counters, [ns]: 0 };
    } else {
      const by = body.by === undefined ? 1 : body.by;
      if (!Number.isFinite(by)) return refuse("by", "is not a number");
      state.counters = { ...state.counters, [ns]: (state.counters[ns] ?? 0) + by };
    }
    // `limits` is advice to the page, not a rule this service enforces: a panel
    // published before a limit existed would otherwise start getting refusals
    // for writes it has always been allowed to make.
    state.countersChangedAt = new Date().toISOString();
    return json(state.counters, 200, going("counters"));
  }

  return json({ error: "not found" }, 404);
}
