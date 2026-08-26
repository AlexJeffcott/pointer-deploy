import { After, Before, setDefaultTimeout, setWorldConstructor, World } from "@cucumber/cucumber";
import { manifestDoc, startStubStore, type StubStore } from "./stub-store.ts";

setDefaultTimeout(180_000);

export type Channel = "qa" | "prod";
export type Mode = "local" | "live";

export const MODE: Mode = (Bun.env.HARNESS as Mode) ?? "local";

/** The store's 5 s pointer cache plus the server's manifest TTL. */
export const PROPAGATION_WINDOW_MS = 15_000;

const LOCAL_TTL_MS = 300;

const LIVE_ORIGINS: Partial<Record<Channel, string>> = {
  qa: Bun.env.QA_ORIGIN ?? "https://pointer-deploy.fly.dev",
  prod: Bun.env.PROD_ORIGIN, // set once the domain is named
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

  originFor(channel: Channel): string {
    if (this.mode === "local") return `http://127.0.0.1:${this.serverPort}`;
    const origin = LIVE_ORIGINS[channel];
    if (!origin) {
      throw new Error(
        `no live origin for the ${channel} channel. Set PROD_ORIGIN once the domain is named.`,
      );
    }
    return origin;
  }

  hostFor(channel: Channel): string | null {
    return this.mode === "local" ? `${channel}.localhost` : null;
  }

  async visit(channel: Channel, path = "/"): Promise<Response> {
    const host = this.hostFor(channel);
    const started = Bun.nanoseconds();
    const res = await fetch(`${this.originFor(channel)}${path}`, {
      headers: host ? { host } : {},
      redirect: "manual",
    });
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
