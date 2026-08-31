export type StubStore = {
  readonly manifestBase: string;
  point(channel: string, body: unknown): void;
  pointRaw(channel: string, body: string): void;
  goDown(): Promise<void>;
  comeUp(): void;
  setDelay(ms: number): void;
  stop(): Promise<void>;
};

const APPS = ["alpha", "bravo", "charlie", "delta"] as const;

const fakeDigest = (file: string) => `sha384-${btoa(file.padEnd(64, "x")).slice(0, 64)}`;

const composedUnit = (name: string, id: string, assetBase: string) => ({
  unitId: id,
  commit: `${id}${"0".repeat(40)}`.slice(0, 40),
  assetBase: `${assetBase}/units/${name}/${id}/`,
  js: `${name}-${id}.js`,
  css: `${name}-${id}.css`,
  integrity: {
    [`${name}-${id}.js`]: fakeDigest(`${name}-${id}.js`),
    [`${name}-${id}.css`]: fakeDigest(`${name}-${id}.css`),
  },
  marker: "",
});

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
      integrity: Object.fromEntries(
        [
          `index-${at("shell")}.js`,
          `index-${at("shell")}.css`,
          `preact-${at("shell")}.js`,
          `api-${at("shell")}.js`,
        ].map((f) => [f, fakeDigest(f)]),
      ),
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
