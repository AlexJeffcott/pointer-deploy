// A controllable stand-in for the object store, used by the @local scenarios.
//
// It serves manifest pointers and nothing else. It deliberately does NOT model
// publish or promote: every scenario that exercises those runs @live against
// the real store, because a stub that reimplemented them could pass while the
// real publish path was broken.

export type StubStore = {
  readonly manifestBase: string;
  /** Serve this document at manifests/<region>/<channel>.json. */
  point(channel: string, body: unknown): void;
  /** Serve raw bytes, so a malformed document can be injected. */
  pointRaw(channel: string, body: string): void;
  /** Take the listener down, so a fetch is refused rather than answered. */
  goDown(): Promise<void>;
  comeUp(): void;
  /** Delay every answer by this many milliseconds. */
  setDelay(ms: number): void;
  stop(): Promise<void>;
};

const APPS = ["alpha", "bravo", "charlie", "delta"] as const;

const composedUnit = (name: string, id: string, assetBase: string) => ({
  unitId: id,
  commit: `${id}${"0".repeat(40)}`.slice(0, 40),
  assetBase: `${assetBase}/units/${name}/${id}/`,
  js: `${name}-${id}.js`,
  css: `${name}-${id}.css`,
  marker: "",
});

/**
 * A composition, as promote.ts writes one.
 *
 * `ids` names a unit id per unit. A bare string is shorthand for "every unit
 * at this id", which is what a scenario about the whole channel wants; naming
 * one unit is what a scenario about one app moving wants.
 */
export function manifestDoc(
  ids: string | Partial<Record<"shell" | (typeof APPS)[number], string>>,
  assetBase = "https://assets.test",
) {
  const at = (unit: string) =>
    typeof ids === "string" ? ids : ((ids as Record<string, string>)[unit] ?? "unset");
  return {
    schema: 3,
    composedAt: "2026-08-26T20:14:02.000Z",
    contract: "9e79879",
    shell: {
      ...composedUnit("shell", at("shell"), assetBase),
      js: `index-${at("shell")}.js`,
      css: `index-${at("shell")}.css`,
      imports: {
        preact: `preact-${at("shell")}.js`,
        "@pointer/shell": `api-${at("shell")}.js`,
      },
    },
    apps: Object.fromEntries(APPS.map((a) => [a, composedUnit(a, at(a), assetBase)])),
  };
}

export async function startStubStore(region = "eu"): Promise<StubStore> {
  const bodies = new Map<string, string>();
  let delayMs = 0;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let port = 0;

  const handler = async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    const match = /^\/manifests\/([^/]+)\/([^/]+)\.json$/.exec(pathname);
    if (!match || match[1] !== region) return new Response("not found", { status: 404 });

    const channel = match[2]!;
    if (delayMs) await Bun.sleep(delayMs);

    const body = bodies.get(channel);
    if (body === undefined) return new Response("not found", { status: 404 });
    return new Response(body, {
      headers: { "content-type": "application/json", "cache-control": "public, max-age=5" },
    });
  };

  const listen = () => {
    server = Bun.serve({ port, hostname: "127.0.0.1", fetch: handler });
    port = server.port ?? 0;
  };

  listen();

  return {
    get manifestBase() {
      return `http://127.0.0.1:${port}/manifests`;
    },
    point(channel, body) {
      bodies.set(channel, JSON.stringify(body));
    },
    pointRaw(channel, body) {
      bodies.set(channel, body);
    },
    async goDown() {
      await server?.stop(true);
      server = null;
    },
    comeUp() {
      if (!server) listen();
    },
    setDelay(ms) {
      delayMs = ms;
    },
    async stop() {
      await server?.stop(true);
      server = null;
    },
  };
}
