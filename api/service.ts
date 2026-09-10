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
//
// One resource, and that is the point of the slate: the machinery above is
// what this service is for, and the greeting is the smallest thing it can
// carry that a page can draw and an operator can change.

export const SERVES: string[] = (Bun.env.API_SERVES ?? "v1")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

/**
 * What the page greets, and who it greets.
 *
 * Two fields rather than one. A single field could be deprecated and never
 * replaced, so the service could publish no `instead` that means anything -
 * and the notice period is the part of §26 worth having.
 */
export type ApiGreeting = { text: string; audience: string };

export type ApiState = {
  greeting: ApiGreeting;
  changedAt: string;
};

export const createState = (): ApiState => ({
  greeting: { text: "Hello", audience: "world" },
  changedAt: new Date().toISOString(),
});

/** What one version of this service returns. Declared, not measured. */
export type ApiField = { path: string; type: string };
export type ApiRoute = { method: string; path: string };

export const FIELDS: Record<string, ApiField[]> = {
  v1: [
    { path: "greeting.text", type: "string" },
    { path: "greeting.audience", type: "string" },
  ],
};

export const ROUTES: Record<string, ApiRoute[]> = {
  v1: [
    { method: "GET", path: "/greeting" },
    { method: "POST", path: "/greeting" },
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

  if (rest === "/greeting") {
    if (req.method === "GET") return json(state.greeting, 200, going("greeting"));
    if (req.method === "POST") {
      const body = await readBody(req);
      if (!body) return refuse("body", "is not an object");
      const named = ["text", "audience"].filter((f) => f in body);
      if (named.length === 0) return refuse("body", "names no field of the greeting");

      const text = "text" in body ? str(body.text) : null;
      if ("text" in body && text === null) return refuse("text", "is not a non-empty string");

      // Empty is a legitimate audience: it is how a greeting is addressed to
      // nobody in particular, so it is checked for type and not for length.
      let audience = state.greeting.audience;
      if ("audience" in body) {
        if (typeof body.audience !== "string") return refuse("audience", "is not a string");
        audience = body.audience;
      }

      state.greeting = { text: text ?? state.greeting.text, audience };
      state.changedAt = new Date().toISOString();
      return json(state.greeting, 200, going("greeting"));
    }
    return json({ error: "method not allowed" }, 405);
  }

  return json({ error: "not found" }, 404);
}
