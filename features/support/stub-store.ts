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
  /** How many times a channel's manifest has been read. */
  reads(channel: string): number;
  resetReads(): void;
  stop(): Promise<void>;
};

export function manifestDoc(buildId: string, assetBase = "https://assets.test") {
  return {
    schema: 1,
    buildId,
    commit: `${buildId}${"0".repeat(40 - buildId.length)}`.slice(0, 40),
    publishedAt: "2026-08-26T20:14:02.000Z",
    assetBase: `${assetBase}/builds/${buildId}/`,
    entry: { js: `index-${buildId}.js`, css: `index-${buildId}.css` },
  };
}

export async function startStubStore(region = "eu"): Promise<StubStore> {
  const bodies = new Map<string, string>();
  const readCounts = new Map<string, number>();
  let delayMs = 0;
  let server: ReturnType<typeof Bun.serve> | null = null;
  let port = 0;

  const handler = async (req: Request): Promise<Response> => {
    const { pathname } = new URL(req.url);
    const match = /^\/manifests\/([^/]+)\/([^/]+)\.json$/.exec(pathname);
    if (!match || match[1] !== region) return new Response("not found", { status: 404 });

    const channel = match[2]!;
    readCounts.set(channel, (readCounts.get(channel) ?? 0) + 1);
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
    reads(channel) {
      return readCounts.get(channel) ?? 0;
    },
    resetReads() {
      readCounts.clear();
    },
    async stop() {
      await server?.stop(true);
      server = null;
    },
  };
}
