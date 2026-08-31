export const SERVES: string[] = (Bun.env.API_SERVES ?? "v1")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

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
      "cache-control": "no-store",
      ...CORS,
    },
  });

const refuse = (field: string, why: string) => json({ error: `${field} ${why}` }, 400);

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  // Stryker disable next-line StringLiteral: cache duration, not behaviour.
  "access-control-max-age": "600",
};

const str = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

export async function handle(req: Request, state: ApiState): Promise<Response> {
  const { pathname } = new URL(req.url);

  // Stryker disable next-line ObjectLiteral: 200 is what an empty init means.
  if (pathname === "/healthz") return new Response("ok", { status: 200 });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (pathname === "/versions") return json({ serves: [...SERVES] });

  const route = /^\/([^/]+)\/(.*)$/.exec(pathname);
  if (!route || !SERVES.includes(route[1]!)) return json({ error: "not found" }, 404);
  const rest = `/${route[2]}`;

  if (rest === "/user") {
    if (req.method === "GET") return json(state.user);
    if (req.method === "POST") {
      const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
      if (!body || typeof body !== "object") return refuse("body", "is not an object");
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

  if (rest === "/counters") {
    if (req.method === "GET") return json(state.counters);
    return json({ error: "method not allowed" }, 405);
  }

  const counter = /^\/counters\/([^/]+)$/.exec(rest);
  if (counter) {
    const ns = decodeURIComponent(counter[1]!);
    if (req.method !== "POST") return json({ error: "method not allowed" }, 405);
    const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
    if (!body || typeof body !== "object") return refuse("body", "is not an object");

    if (body.reset === true) state.counters = { ...state.counters, [ns]: 0 };
    else if (body.register === true) {
      if (!(ns in state.counters)) state.counters = { ...state.counters, [ns]: 0 };
    } else {
      const by = body.by === undefined ? 1 : body.by;
      if (!Number.isFinite(by)) return refuse("by", "is not a number");
      state.counters = { ...state.counters, [ns]: (state.counters[ns] ?? 0) + by };
    }
    return json(state.counters);
  }

  return json({ error: "not found" }, 404);
}
