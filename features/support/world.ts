import { After, Before, setDefaultTimeout, setWorldConstructor, World } from "@cucumber/cucumber";
import { manifestDoc, startStubStore, type StubStore } from "./stub-store.ts";

setDefaultTimeout(180_000);

export type Channel = "qa" | "prod";
export type Mode = "local" | "live";

export const MODE: Mode = (Bun.env.HARNESS as Mode) ?? "local";

/** The store's 5 s pointer cache plus the server's manifest TTL. */
export const PROPAGATION_WINDOW_MS = 15_000;

const LOCAL_TTL_MS = 300;

const LIVE_ADDRESS = Bun.env.LIVE_ADDRESS ?? "https://pointer-deploy.fly.dev";

/**
 * The Host each channel is reached by. Both channels are one app on one
 * machine; only the header differs. Until a domain is pointed at Fly the prod
 * name cannot resolve, so it is reached by setting the header directly - which
 * is what Fly forwards to the server anyway.
 */
const LIVE_HOSTS: Record<Channel, string> = {
  qa: Bun.env.QA_HOST ?? "pointer-deploy.fly.dev",
  prod: Bun.env.PROD_HOST ?? "prod.pointer-deploy.test",
};

type Run = { code: number; stdout: string; stderr: string };

// Shared across scenarios on purpose. Cucumber builds a fresh World per
// scenario, and rebuilding and republishing the same two bundles for each one
// would add minutes without testing anything the first publish did not.
const BUILD_IDS = new Map<string, string>();

export async function run(cmd: string[], env: Record<string, string> = {}): Promise<Run> {
  const proc = Bun.spawn(cmd, {
    env: { ...process.env, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** A GET whose Host may differ from the address it connects to. */
export async function curlGet(url: string, host: string): Promise<Response> {
  const r = await run(["curl", "-sS", "-o", "-", "-w", "\n%{http_code}", "-H", `Host: ${host}`, url]);
  if (r.code !== 0) throw new Error(`curl ${url} (Host: ${host}) failed: ${r.stderr}`);
  const cut = r.stdout.lastIndexOf("\n");
  return new Response(cut === -1 ? "" : r.stdout.slice(0, cut), {
    status: Number(r.stdout.slice(cut + 1)),
  });
}

export function buildIdInShell(html: string): string | null {
  const m = /<script type="application\/json" id="__BUILD__">(.*?)<\/script>/s.exec(html);
  if (!m?.[1]) return null;
  try {
    return (JSON.parse(m[1]) as { buildId?: string }).buildId ?? null;
  } catch {
    return null;
  }
}

export function assetUrlsInShell(html: string): { js: string | null; css: string | null } {
  return {
    js: /<script type="module" src="([^"]+)"/.exec(html)?.[1] ?? null,
    css: /<link rel="stylesheet" href="([^"]+)"/.exec(html)?.[1] ?? null,
  };
}

export class PointerWorld extends World {
  mode: Mode = MODE;
  stub: StubStore | null = null;
  server: ReturnType<typeof Bun.spawn> | null = null;
  serverPort = 0;

  /** Scenario build name ("alpha") to the real build id the store holds. */
  private ids = BUILD_IDS;

  lastResponse: Response | null = null;
  lastBody = "";
  lastRun: Run | null = null;
  machinesBefore: string | null = null;
  elapsedMs = 0;

  // -- lifecycle ------------------------------------------------------------

  async startLocal(): Promise<void> {
    this.stub = await startStubStore();
    const proc = Bun.spawn(["bun", "src/server/index.ts"], {
      env: {
        ...process.env,
        NODE_ENV: "development",
        PORT: "0",
        MANIFEST_BASE: this.stub.manifestBase,
        MANIFEST_TTL_MS: String(LOCAL_TTL_MS),
        MANIFEST_TIMEOUT_MS: "3000",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    this.server = proc;

    // The server prints its port on the first line. Waiting for it beats
    // sleeping, and a start failure surfaces here rather than as a refused
    // connection three steps later.
    const reader = proc.stdout.getReader();
    const deadline = Date.now() + 10_000;
    let buffered = "";
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += new TextDecoder().decode(value);
      const m = /listening on http:\/\/[^:]+:(\d+)/.exec(buffered);
      if (m) {
        this.serverPort = Number(m[1]);
        reader.releaseLock();
        return;
      }
    }
    throw new Error(`the server did not start. Output so far:\n${buffered}`);
  }

  async stopLocal(): Promise<void> {
    this.server?.kill();
    await this.stub?.stop();
    this.server = null;
    this.stub = null;
  }

  // -- channels -------------------------------------------------------------

  idOf(name: string): string {
    return this.ids.get(name) ?? name;
  }

  setId(name: string, id: string): void {
    this.ids.set(name, id);
  }

  /** Build and publish a real build, or register a synthetic one locally. */
  async publish(name: string): Promise<string> {
    const known = this.ids.get(name);
    if (known) return known;

    if (this.mode === "local") {
      this.ids.set(name, name);
      return name;
    }

    const built = await run(["bun", "run", "build"], { BUILD_MARKER: name });
    if (built.code !== 0) throw new Error(`build failed:\n${built.stderr}`);

    const published = await run(["bun", "run", "--silent", "scripts/publish.ts", "--force"]);
    if (published.code !== 0) throw new Error(`publish failed:\n${published.stderr}`);

    const id = published.stdout.split("\n").pop()!.trim();

    // Two scenario builds that collide would make every promotion scenario
    // pass by accident, because the channel would already serve the id being
    // promoted to it.
    for (const [other, otherId] of this.ids) {
      if (otherId === id) {
        throw new Error(
          `builds ${JSON.stringify(name)} and ${JSON.stringify(other)} both published as ` +
            `${id}. They are the same artefact, so no promotion between them proves anything.`,
        );
      }
    }

    this.ids.set(name, id);
    return id;
  }

  async promote(channel: Channel, name: string): Promise<Run> {
    if (this.mode === "local") {
      const id = this.idOf(name);
      if (!this.ids.has(name)) {
        return { code: 1, stdout: "", stderr: `build ${id} is not published` };
      }
      this.stub!.point(channel, manifestDoc(id));
      return { code: 0, stdout: id, stderr: "" };
    }
    return run(["bun", "run", "--silent", "scripts/promote.ts", channel, this.idOf(name)]);
  }

  /** Setup helper: make the channel point at the build, however that is done. */
  async pointAt(channel: Channel, name: string): Promise<void> {
    await this.publish(name);
    const result = await this.promote(channel, name);
    if (result.code !== 0) throw new Error(`could not point ${channel} at ${name}:\n${result.stderr}`);
    if (this.mode === "live") await this.awaitBuild(channel, name, PROPAGATION_WINDOW_MS + 15_000);
  }

  // -- requests -------------------------------------------------------------

  /** The address to connect to. Both live channels share one. */
  originFor(channel: Channel): string {
    if (this.mode === "local") return `http://127.0.0.1:${this.serverPort}`;
    void channel;
    return LIVE_ADDRESS;
  }

  /** The Host to send. This is what selects the channel. */
  hostFor(channel: Channel): string {
    return this.mode === "local" ? `${channel}.localhost` : LIVE_HOSTS[channel];
  }

  /** True when the Host differs from the address, so fetch cannot be used. */
  private needsCurl(channel: Channel): boolean {
    return this.mode === "live" && this.hostFor(channel) !== new URL(LIVE_ADDRESS).host;
  }

  async visit(channel: Channel, path = "/"): Promise<Response> {
    const host = this.hostFor(channel);
    const url = `${this.originFor(channel)}${path}`;
    const started = Bun.nanoseconds();

    // Over TLS, Bun derives SNI from the Host header, so a Host that differs
    // from the address breaks certificate verification. curl keeps the two
    // apart, which is what a request carrying another Host looks like on the
    // wire.
    const res = this.needsCurl(channel)
      ? await curlGet(url, host)
      : await fetch(url, { headers: { host }, redirect: "manual" });

    this.elapsedMs = (Bun.nanoseconds() - started) / 1e6;
    this.lastResponse = res;
    this.lastBody = await res.text();
    return res;
  }

  /**
   * Sends a Host the server does not know, to the address it really listens on.
   *
   * Over TLS this cannot go through fetch: Bun derives SNI from the Host
   * header, so spoofing one breaks certificate verification. curl keeps the
   * two separate, which is what a request carrying an unexpected Host actually
   * looks like on the wire.
   */
  async visitUnknownOrigin(path = "/"): Promise<Response> {
    const url = `${this.originFor("qa")}${path}`;
    const host = "not-configured.example.com";

    if (this.mode === "local") {
      const res = await fetch(url, { headers: { host }, redirect: "manual" });
      this.lastResponse = res;
      this.lastBody = await res.text();
      return res;
    }

    const r = await run(["curl", "-sS", "-o", "-", "-w", "\n%{http_code}", "-H", `Host: ${host}`, url]);
    if (r.code !== 0) throw new Error(`curl failed: ${r.stderr}`);
    const cut = r.stdout.lastIndexOf("\n");
    const status = Number(r.stdout.slice(cut + 1));
    this.lastBody = cut === -1 ? "" : r.stdout.slice(0, cut);
    this.lastResponse = new Response(this.lastBody, { status });
    return this.lastResponse;
  }

  /** Poll until the channel serves the named build, or time out. */
  async awaitBuild(channel: Channel, name: string, budgetMs: number): Promise<number> {
    const want = this.idOf(name);
    const started = Date.now();
    let seen: string | null = null;
    while (Date.now() - started < budgetMs) {
      await this.visit(channel);
      seen = buildIdInShell(this.lastBody);
      if (seen === want) return Date.now() - started;
      await Bun.sleep(500);
    }
    throw new Error(
      `the ${channel} origin still served ${JSON.stringify(seen)} after ` +
        `${Date.now() - started} ms; expected ${JSON.stringify(want)}`,
    );
  }

  // -- Fly ------------------------------------------------------------------

  async machineFingerprint(): Promise<string> {
    const r = await run(["fly", "machine", "list", "--json"]);
    if (r.code !== 0) throw new Error(`fly machine list failed:\n${r.stderr}`);
    const machines = JSON.parse(r.stdout) as Array<{ id: string; updated_at: string; state: string }>;
    return machines
      .map((m) => `${m.id}@${m.updated_at}`)
      .sort()
      .join(",");
  }
}

setWorldConstructor(PointerWorld);

Before({ tags: "@local" }, async function (this: PointerWorld) {
  if (this.mode !== "local") return;
  await this.startLocal();
});

Before({ tags: "@live" }, async function (this: PointerWorld) {
  if (this.mode !== "live") return;
  this.machinesBefore = await this.machineFingerprint();
});

After(async function (this: PointerWorld) {
  await this.stopLocal();
});
