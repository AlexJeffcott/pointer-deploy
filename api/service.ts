// The values the page shows, held by a service the units do not build with.
//
// Everything the shell needs is a request away, and nothing here is compiled
// against anything in `src/`. That is the whole point of it: the contract
// between this and the shell has no `tsc` to check it, so the shell checks the
// shape at runtime and the two are versioned by a set rather than by a hash.
//
// State is IN MEMORY and one machine holds it. A restart loses the counters and
// the name goes back to its default. That is a real limit and it is not the
// question this exists to answer - persistence is TODO's deferred question, and
// a service that stored nothing still deploys on its own schedule, which is the
// dimension being added.

/** Every version of the API this build answers. The service's own surface. */
export const SERVES = ["v1"] as const;

export type ApiUser = { name: string; colour: string };
export type ApiState = { user: ApiUser; counters: Record<string, number> };

export const createState = (): ApiState => ({
  user: { name: "Alex", colour: "#1f5fd0" },
  counters: {},
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      // The values change on every write and a stale copy would show a name
      // nobody set. Nothing here is big enough for a cache to be worth a wrong
      // answer.
      "cache-control": "no-store",
      ...CORS,
    },
  });

/**
 * Named, so a caller reading the body knows which field it got wrong.
 *
 * The same idiom as `parseManifest`: a message an operator can act on beats a
 * status code that says only that something was refused.
 */
const refuse = (field: string, why: string) => json({ error: `${field} ${why}` }, 400);

// Read by a page on another origin, so the browser will not hand over the body
// without these. No credentials are involved - the service holds nothing
// private and authenticates nobody - so `*` is the honest value rather than a
// list this repo would then have to keep.
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  // Stryker disable next-line StringLiteral: how long a browser may keep the
  // preflight. An empty value means it keeps it for the browser's own default
  // and every request still works, so no reading of this system changes.
  "access-control-max-age": "600",
};

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

/** One request, against one state. No socket, so a test drives it directly. */
export async function handle(req: Request, state: ApiState): Promise<Response> {
  const { pathname } = new URL(req.url);

  // Reads nothing and depends on nothing, for the same reason the shell's does:
  // health that consulted the state would turn a bad write into a dead machine.
  // Stryker disable next-line ObjectLiteral: 200 is what an empty init means,
  // so the mutant that empties it is this same response.
  if (pathname === "/healthz") return new Response("ok", { status: 200 });

  // A POST of JSON is preflighted, so this is not optional.
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  // Unversioned on purpose. A client that does not yet know which versions
  // exist has to be able to ask, so the discovery document cannot itself sit
  // behind a version.
  if (pathname === "/versions") return json({ serves: [...SERVES] });

  if (pathname === "/v1/user") {
    if (req.method === "GET") return json(state.user);
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return refuse("body", "is not an object");
      // Both optional, and at least one required: a POST that names neither is
      // a caller that thinks it changed something.
      const name = "name" in body ? str(body.name) : null;
      const colour = "colour" in body ? str(body.colour) : null;
      if ("name" in body && name === null) return refuse("name", "is not a non-empty string");
      if ("colour" in body && colour === null) return refuse("colour", "is not a non-empty string");
      if (name === null && colour === null) return refuse("body", "names neither name nor colour");
      state.user = { name: name ?? state.user.name, colour: colour ?? state.user.colour };
      return json(state.user);
    }
    return json({ error: "method not allowed" }, 405);
  }

  if (pathname === "/v1/counters") {
    if (req.method === "GET") return json(state.counters);
    return json({ error: "method not allowed" }, 405);
  }

  const counter = /^\/v1\/counters\/([^/]+)$/.exec(pathname);
  if (counter) {
    const ns = decodeURIComponent(counter[1]!);
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return refuse("body", "is not an object");

    // Three operations on one route, because they are one write: a namespace
    // appearing at zero, a namespace moving, and a namespace going back to
    // zero. Naming them apart would be three routes doing the same thing.
    if (body.reset === true) state.counters = { ...state.counters, [ns]: 0 };
    else if (body.register === true) {
      if (!(ns in state.counters)) state.counters = { ...state.counters, [ns]: 0 };
    } else {
      const by = body.by === undefined ? 1 : body.by;
      // One check, not two. `Number.isFinite` coerces nothing, so it is already
      // false for every value that is not a number - and JSON carries neither
      // NaN nor Infinity, so a `typeof` beside it can refuse nothing more.
      if (!Number.isFinite(by)) return refuse("by", "is not a number");
      state.counters = { ...state.counters, [ns]: (state.counters[ns] ?? 0) + by };
    }
    return json(state.counters);
  }

  return json({ error: "not found" }, 404);
}
