import type { Page } from "@playwright/test";
import { manifestDoc, startStubStore, type StubStore } from "./stub-store.ts";
import { curlGet, run, type Run } from "./http.ts";
import { APPS, UNITS, type Unit } from "../../scripts/contract.ts";
import { CACHE_POINTER, configFromEnv, getObjectText, putObject } from "../../scripts/store.ts";
import type { BuildInfo } from "@pointer/blocks";
import type { ServedComposition, ServedReading } from "../../src/server/served.ts";

export { curlGet, run };

export type Channel = "qa" | "prod";
export type Mode = "local" | "live";

export const MODE: Mode = (Bun.env.HARNESS as Mode) ?? "local";

export const PROPAGATION_WINDOW_MS = 15_000;

const LOCAL_TTL_MS = 300;

const LIVE_ADDRESS = Bun.env.LIVE_ADDRESS ?? "https://pointer-deploy.fly.dev";

const MANIFEST_BASE =
  Bun.env.MANIFEST_BASE ?? "https://pointer-deploy-assets.fly.storage.tigris.dev/manifests";
const REGION = Bun.env.REGION ?? "eu";

const LIVE_CHANNELS: Record<Channel, string> = {
  qa: "test-qa",
  prod: "test-prod",
};

export const REAL_CHANNELS = ["qa", "prod"] as const;

const LIVE_HOSTS: Record<Channel, string> = {
  qa: Bun.env.TEST_QA_HOST ?? "test-qa.pointer-deploy.test",
  prod: Bun.env.TEST_PROD_HOST ?? "test-prod.pointer-deploy.test",
};

export type UnitIds = Record<Unit, string>;

const BUILD_IDS = new Map<string, UnitIds>();

export async function pointerBuildId(channel: string): Promise<string> {
  const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${REGION}/${channel}.json`;
  let res: Response | null = null;
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 3 && res === null; attempt++) {
    if (attempt > 0) await Bun.sleep(500 * attempt);
    try {
      res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    } catch (e) {
      lastError = e;
    }
  }
  if (res === null) {
    throw new Error(
      `could not read ${url} in 3 attempts: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  }
  if (!res.ok) return `absent (${res.status})`;
  try {
    const doc = (await res.json()) as {
      schema?: number;
      buildId?: string;
      shell?: { unitId?: string };
      apps?: Record<string, { unitId?: string }>;
    };
    if (doc.schema === 3) {
      return [
        `shell=${doc.shell?.unitId ?? "?"}`,
        ...Object.entries(doc.apps ?? {}).map(([n, a]) => `${n}=${a.unitId ?? "?"}`),
      ]
        .sort()
        .join(" ");
    }
    return doc.buildId ?? "no buildId field";
  } catch {
    return "unreadable";
  }
}

type ShellBuildInfo = Partial<BuildInfo>;

function buildInfoInShell(html: string): ShellBuildInfo | null {
  const m = /<script type="application\/json" id="__BUILD__">(.*?)<\/script>/s.exec(html);
  if (!m?.[1]) return null;
  try {
    return JSON.parse(m[1]) as ShellBuildInfo;
  } catch {
    return null;
  }
}

export function buildIdInShell(html: string): string | null {
  return buildInfoInShell(html)?.buildId ?? null;
}

export function unitIdsInShell(html: string): Partial<Record<Unit, string>> {
  const units = buildInfoInShell(html)?.units ?? {};
  return Object.fromEntries(Object.entries(units).map(([n, u]) => [n, u.unitId]));
}

export function appScriptUrls(html: string): Record<string, string> {
  const m = /id="__APPS__">(.*?)<\/script>/s.exec(html);
  if (!m?.[1]) return {};
  try {
    const apps = JSON.parse(m[1]) as Record<string, { js: string }>;
    return Object.fromEntries(Object.entries(apps).map(([n, a]) => [n, a.js]));
  } catch {
    return {};
  }
}

export type ServedOption = {
  unitId: string;
  marker: string;
  current: boolean;
  live: boolean;
  deployed: boolean;
  disabled: boolean;
  since?: string;
};

export function versionsInShell(html: string): Record<string, ServedOption[]> {
  const m = /id="__VERSIONS__">(.*?)<\/script>/s.exec(html);
  if (!m?.[1]) return {};
  try {
    return JSON.parse(m[1]) as Record<string, ServedOption[]>;
  } catch {
    return {};
  }
}

export function assetUrlsInShell(html: string): { js: string | null; css: string | null } {
  return {
    js: /<script type="module" src="([^"]+)"/.exec(html)?.[1] ?? null,
    css: /<link rel="stylesheet" href="([^"]+)"/.exec(html)?.[1] ?? null,
  };
}

export class PointerWorld {
  mode: Mode = MODE;
  stub: StubStore | null = null;
  server: ReturnType<typeof Bun.spawn> | null = null;
  serverPort = 0;
  service: ReturnType<typeof Bun.spawn> | null = null;
  serviceBase = "";
  localServer = false;

  private ids = BUILD_IDS;

  page: Page | null = null;
  requests: string[] = [];

  lastResponse: Response | null = null;
  lastBody = "";
  lastServed: ServedReading | null = null;
  lastNamed: ServedComposition | null = null;
  lastRun: Run | null = null;
  guardDir: string | null = null;
  machinesBefore: string | null = null;
  elapsedMs = 0;

  async startLocal(): Promise<void> {
    this.stub = await startStubStore();
    await this.spawnServer({
      MANIFEST_BASE: this.stub.manifestBase,
      MANIFEST_TTL_MS: String(LOCAL_TTL_MS),
      MANIFEST_TIMEOUT_MS: "3000",
    });
  }

  async startServiceAndServer(serves: string): Promise<void> {
    const proc = Bun.spawn(["bun", "api/index.ts"], {
      env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", PORT: "0", API_SERVES: serves },
      stdout: "pipe",
      stderr: "pipe",
    });
    this.service = proc;

    const reader = proc.stdout.getReader();
    const deadline = Date.now() + 10_000;
    let buffered = "";
    while (Date.now() < deadline) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += new TextDecoder().decode(value);
      const m = /listening on http:\/\/[^:]+:(\d+)/.exec(buffered);
      if (m) {
        this.serviceBase = `http://127.0.0.1:${m[1]}`;
        reader.releaseLock();
        this.server?.kill();
        this.stub ??= await startStubStore();
        await this.spawnServer({
          MANIFEST_BASE: this.stub.manifestBase,
          MANIFEST_TTL_MS: String(LOCAL_TTL_MS),
          MANIFEST_TIMEOUT_MS: "3000",
          API_BASE: this.serviceBase,
        });
        return;
      }
    }
    throw new Error(`the service did not start. Output so far:\n${buffered}`);
  }

  async startAgainstRealStore(): Promise<void> {
    await this.spawnServer({
      MANIFEST_BASE,
      MANIFEST_TTL_MS: "1000",
      MANIFEST_TIMEOUT_MS: "10000",
    });
    this.localServer = true;
  }

  private async spawnServer(env: Record<string, string>): Promise<void> {
    const proc = Bun.spawn(["bun", "src/server/index.ts"], {
      env: {
        ...process.env,
        FORCE_COLOR: "0",
        NO_COLOR: "1",
        NODE_ENV: "development",
        PORT: "0",
        ...env,
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    this.server = proc;

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
    this.service?.kill();
    await this.stub?.stop();
    this.server = null;
    this.service = null;
    this.serviceBase = "";
    this.stub = null;
    this.localServer = false;
  }

  idsOf(name: string): UnitIds {
    return (
      this.ids.get(name) ??
      (Object.fromEntries(UNITS.map((u) => [u, name])) as UnitIds)
    );
  }

  idOf(name: string): string {
    return this.idsOf(name).shell;
  }

  unitIdOf(name: string, unit: Unit): string {
    return this.idsOf(name)[unit];
  }

  setId(name: string, id: string): void {
    this.ids.set(name, Object.fromEntries(UNITS.map((u) => [u, id])) as UnitIds);
  }

  async publish(name: string, markers: Partial<Record<Unit, string>> = {}): Promise<UnitIds> {
    const known = this.ids.get(name);
    if (known) return known;

    if (this.mode === "local") {
      const ids = Object.fromEntries(UNITS.map((u) => [u, name])) as UnitIds;
      this.ids.set(name, ids);
      return ids;
    }

    const env: Record<string, string> = { BUILD_MARKER: name };
    for (const [unit, marker] of Object.entries(markers)) {
      env[`BUILD_MARKER_${unit.toUpperCase()}`] = marker;
    }

    const built = await run(["bun", "run", "build"], env);
    if (built.code !== 0) throw new Error(`build failed:\n${built.stderr}`);

    const published = await run(["bun", "run", "--silent", "scripts/publish.ts"]);
    if (published.code !== 0) throw new Error(`publish failed:\n${published.stderr}`);

    const ids = JSON.parse(published.stdout) as UnitIds;

    for (const [other, otherIds] of this.ids) {
      if (otherIds.shell === ids.shell) {
        throw new Error(
          `builds ${JSON.stringify(name)} and ${JSON.stringify(other)} both published shell ` +
            `${ids.shell}. They are the same artefact, so no promotion between them proves anything.`,
        );
      }
    }

    this.ids.set(name, ids);
    return ids;
  }

  storeChannel(channel: Channel): string {
    return this.mode === "live" ? LIVE_CHANNELS[channel] : channel;
  }

  private targetChannel(channel: Channel): string {
    const target = this.storeChannel(channel);
    if (!target.startsWith("test-")) {
      throw new Error(
        `the suite tried to promote to ${JSON.stringify(target)}, which is a real channel. ` +
          `Live scenarios may only write test-* channels.`,
      );
    }
    return target;
  }

  async promote(channel: Channel, name: string): Promise<Run> {
    const ids = this.idsOf(name);
    if (this.mode === "local") {
      if (!this.ids.has(name)) {
        return { code: 1, stdout: "", stderr: `shell ${ids.shell} is not published` };
      }
      this.stub!.point(channel, manifestDoc(ids));
      return { code: 0, stdout: ids.shell, stderr: "" };
    }
    return run([
      "bun", "run", "--silent", "scripts/promote.ts", this.targetChannel(channel),
      "--shell", ids.shell,
      ...APPS.flatMap((a) => ["--app", `${a}=${ids[a]}`]),
    ]);
  }

  routedTo: string | null = null;
  regionsSeen: string[] = [];

  async regionsServedFrom(channel: Channel, flyRegion: string): Promise<string[]> {
    const headers = { "fly-prefer-region": flyRegion };
    await this.visit(channel, "/", headers);
    const res = await this.visit(channel, "/compositions", headers);
    if (res.status !== 200) {
      throw new Error(`GET /compositions through ${flyRegion} answered ${res.status}`);
    }
    const reading = JSON.parse(this.lastBody) as ServedReading;
    if (reading.compositions.length === 0) {
      throw new Error(
        `the machine reached through ${flyRegion} has handed out nothing since ` +
          `${reading.since}, so it cannot say which region it serves.`,
      );
    }
    return [...new Set(reading.compositions.map((c) => c.region))];
  }

  async pointerTextInRegion(channel: Channel, region: string): Promise<string | null> {
    const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${region}/${this.storeChannel(channel)}.json`;
    const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    return res.ok ? await res.text() : null;
  }

  async moveRegionAlone(channel: Channel, name: string, region: string): Promise<Run> {
    if (this.mode !== "live") {
      throw new Error("moveRegionAlone is @live only; the stub store models one region");
    }
    const ids = this.idsOf(name);
    const result = await run([
      "bun", "run", "--silent", "scripts/promote.ts", this.targetChannel(channel),
      "--region", region,
      "--shell", ids.shell,
      ...APPS.flatMap((a) => ["--app", `${a}=${ids[a]}`]),
    ]);
    if (result.code === 0) this.regionMoved = { channel, region };
    return result;
  }

  private regionMoved: { channel: Channel; region: string } | null = null;

  async restoreRegionParity(): Promise<void> {
    const moved = this.regionMoved;
    this.regionMoved = null;
    if (!moved || this.mode !== "live") return;

    const base = await this.compositionInRegion(moved.channel, REGION);
    const flags = Object.entries(base).flatMap(([unit, id]) =>
      unit === "shell" ? ["--shell", id] : ["--app", `${unit}=${id}`],
    );
    if (flags.length === 0) {
      throw new Error(
        `${moved.region} was moved alone and the ${REGION} pointer names nothing to put it ` +
          `back to. ${moved.channel} now refuses every promote until it is fixed by hand.`,
      );
    }
    const result = await run([
      "bun", "run", "--silent", "scripts/promote.ts", this.targetChannel(moved.channel),
      "--region", moved.region, ...flags,
    ]);
    if (result.code !== 0) {
      throw new Error(
        `${moved.region} was left holding a different composition from ${REGION}: ` +
          `${result.stderr}`,
      );
    }
  }

  async promoteUnit(channel: Channel, unit: Unit, id: string): Promise<Run> {
    const flag = unit === "shell" ? ["--shell", id] : ["--app", `${unit}=${id}`];
    if (this.mode === "local") {
      throw new Error("promoteUnit is @live only; the stub store does not model promote");
    }
    return run([
      "bun", "run", "--silent", "scripts/promote.ts", this.targetChannel(channel), ...flag,
    ]);
  }

  async compositionOf(channel: Channel): Promise<Partial<Record<Unit, string>>> {
    return this.compositionInRegion(channel, REGION);
  }

  async compositionInRegion(
    channel: Channel,
    region: string,
  ): Promise<Partial<Record<Unit, string>>> {
    const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${region}/${this.storeChannel(channel)}.json`;
    const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
    if (!res.ok) return {};
    const doc = (await res.json()) as {
      shell?: { unitId?: string };
      apps?: Record<string, { unitId?: string }>;
    };
    return {
      ...(doc.shell?.unitId ? { shell: doc.shell.unitId } : {}),
      ...Object.fromEntries(
        Object.entries(doc.apps ?? {}).map(([n, a]) => [n, a.unitId]),
      ),
    };
  }

  async pointAt(channel: Channel, name: string, markers: Partial<Record<Unit, string>> = {}): Promise<void> {
    await this.publish(name, markers);
    const result = await this.promote(channel, name);
    if (result.code !== 0) throw new Error(`could not point ${channel} at ${name}:\n${result.stderr}`);
    if (this.mode === "live") {
      await this.awaitComposition(channel, this.idsOf(name), PROPAGATION_WINDOW_MS + 15_000);
    }
  }

  private pointerBefore: { key: string; text: string } | null = null;

  pointerKey(channel: Channel): string {
    return `manifests/${REGION}/${this.targetChannel(channel)}.json`;
  }

  async pointChannelAtDocument(channel: Channel, doc: unknown): Promise<void> {
    const cfg = configFromEnv();
    const key = this.pointerKey(channel);
    const before = await getObjectText(cfg, key);
    if (before === null) {
      throw new Error(`${key} does not exist. This scenario replaces a pointer, never invents one.`);
    }
    this.pointerBefore = { key, text: before };
    await this.writePointer(cfg, key, `${JSON.stringify(doc, null, 2)}\n`);
  }

  private historyBefore: { key: string; text: string } | null = null;

  historyKey(channel: Channel): string {
    return `manifests/${REGION}/${this.targetChannel(channel)}.history.json`;
  }

  async recordInHistory(
    channel: Channel,
    unit: Unit,
    entry: {
      unitId: string;
      contracts?: string[];
      surface?: Record<string, unknown> | null;
    },
  ): Promise<void> {
    const cfg = configFromEnv();
    const key = this.historyKey(channel);
    const before = await getObjectText(cfg, key);
    if (before === null) {
      throw new Error(`${key} does not exist. A promote writes it; this scenario only adds to it.`);
    }
    this.historyBefore = { key, text: before };

    const doc = JSON.parse(before) as {
      units: Record<
        string,
        Array<{ unit: Record<string, unknown>; contracts: string[]; surface?: Record<string, unknown> }>
      >;
    };
    const served = doc.units[unit]?.[0];
    if (!served) throw new Error(`${key} holds no ${unit} entry to copy a shape from`);
    const surface =
      entry.surface === null
        ? undefined
        : entry.surface
          ? { ...served.surface, ...entry.surface }
          : served.surface;
    doc.units[unit] = [
      served,
      {
        unit: { ...served.unit, unitId: entry.unitId },
        contracts: entry.contracts ?? served.contracts,
        ...(surface ? { surface } : {}),
      },
      ...doc.units[unit]!.slice(1),
    ];
    await this.writePointer(cfg, key, `${JSON.stringify(doc, null, 2)}\n`);
  }

  async restoreHistory(): Promise<void> {
    const saved = this.historyBefore;
    if (!saved) return;
    this.historyBefore = null;
    await this.writePointer(configFromEnv(), saved.key, saved.text);
  }

  async restorePointer(): Promise<void> {
    const saved = this.pointerBefore;
    if (!saved) return;
    this.pointerBefore = null;
    await this.writePointer(configFromEnv(), saved.key, saved.text);
  }

  private async writePointer(
    cfg: ReturnType<typeof configFromEnv>,
    key: string,
    text: string,
  ): Promise<void> {
    await putObject(cfg, key, new TextEncoder().encode(text), {
      contentType: "application/json; charset=utf-8",
      cacheControl: CACHE_POINTER,
    });
  }

  originFor(channel: Channel): string {
    if (this.mode === "local") return `http://127.0.0.1:${this.serverPort}`;
    if (this.localServer) return `http://${this.storeChannel(channel)}.localhost:${this.serverPort}`;
    return LIVE_ADDRESS;
  }

  hostFor(channel: Channel): string {
    if (this.mode === "local") return `${channel}.localhost`;
    if (this.localServer) return `${this.storeChannel(channel)}.localhost`;
    return LIVE_HOSTS[channel];
  }

  private needsCurl(channel: Channel): boolean {
    if (this.localServer) return false;
    return this.mode === "live" && this.hostFor(channel) !== new URL(LIVE_ADDRESS).host;
  }

  async visit(
    channel: Channel,
    path = "/",
    headers: Record<string, string> = {},
  ): Promise<Response> {
    const host = this.hostFor(channel);
    const url = `${this.originFor(channel)}${path}`;
    const started = Bun.nanoseconds();

    const res = this.needsCurl(channel)
      ? await curlGet(url, host, headers)
      : await fetch(url, { headers: { host, ...headers }, redirect: "manual" });

    this.elapsedMs = (Bun.nanoseconds() - started) / 1e6;
    this.lastResponse = res;
    this.lastBody = await res.text();
    return res;
  }

  async readServed(channel: Channel): Promise<ServedReading> {
    const res = await this.visit(channel, "/compositions");
    const type = res.headers.get("content-type") ?? "none";
    if (res.status !== 200 || !type.includes("application/json")) {
      throw new Error(
        `GET /compositions answered ${res.status} ${type}, which is not a reading. ` +
          `An image without one serves the shell for any path: ${this.lastBody.slice(0, 120)}`,
      );
    }
    this.lastServed = JSON.parse(this.lastBody) as ServedReading;
    return this.lastServed;
  }

  async visitUnknownOrigin(path = "/"): Promise<Response> {
    const url = `${this.originFor("qa")}${path}`;
    const host = "not-configured.example.com";

    const res =
      this.mode === "local"
        ? await fetch(url, { headers: { host }, redirect: "manual" })
        : await curlGet(url, host);

    this.lastResponse = res;
    this.lastBody = await res.text();
    return res;
  }

  async pointerNow(channel: Channel): Promise<string> {
    try {
      const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${REGION}/${this.storeChannel(channel)}.json`;
      const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
      if (!res.ok) return `the store answered ${res.status} for ${url}`;
      const doc = (await res.json()) as {
        composedAt?: string;
        shell?: { unitId?: string };
        apps?: Record<string, { unitId?: string }>;
      };
      const ids = [
        `shell=${doc.shell?.unitId ?? "?"}`,
        ...Object.entries(doc.apps ?? {}).map(([n, a]) => `${n}=${a.unitId ?? "?"}`),
      ]
        .sort()
        .join(" ");
      const ageMs = doc.composedAt ? Date.now() - Date.parse(doc.composedAt) : NaN;
      const age = Number.isFinite(ageMs) ? `, composed ${Math.round(ageMs / 1000)} s ago` : "";
      return `the store's pointer names ${ids}${age}`;
    } catch (err) {
      return `the store's pointer could not be read: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  originSays(): string {
    const age = this.lastResponse?.headers.get("x-manifest-age");
    if (age === null || age === undefined) {
      return "the origin reported no manifest age";
    }
    const refresh = this.lastResponse?.headers.get("x-manifest-refresh") ?? "unreported";
    return `the origin rendered from a manifest ${age} ms old, last refresh ${refresh}`;
  }

  async awaitComposition(channel: Channel, want: UnitIds, budgetMs: number): Promise<number> {
    const started = Date.now();
    let seen: Partial<Record<Unit, string>> = {};
    while (Date.now() - started < budgetMs) {
      await this.visit(channel);
      seen = unitIdsInShell(this.lastBody);
      if (UNITS.every((u) => seen[u] === want[u])) return Date.now() - started;
      await Bun.sleep(500);
    }
    const wrong = UNITS.filter((u) => seen[u] !== want[u])
      .map((u) => `${u}: ${seen[u]} != ${want[u]}`)
      .join(", ");
    throw new Error(
      `the ${channel} origin did not serve the whole composition after ` +
        `${Date.now() - started} ms. Still wrong: ${wrong}. ` +
        `${await this.pointerNow(channel)}. ${this.originSays()}`,
    );
  }

  async awaitUnit(channel: Channel, unit: Unit, id: string, budgetMs: number): Promise<number> {
    const started = Date.now();
    let seen: string | undefined;
    while (Date.now() - started < budgetMs) {
      await this.visit(channel);
      seen = unitIdsInShell(this.lastBody)[unit];
      if (seen === id) return Date.now() - started;
      await Bun.sleep(500);
    }
    throw new Error(
      `the ${channel} origin still served ${unit}=${JSON.stringify(seen)} after ` +
        `${Date.now() - started} ms; expected ${JSON.stringify(id)}. ` +
        `${await this.pointerNow(channel)}. ${this.originSays()}`,
    );
  }

  async awaitBuild(channel: Channel, name: string, budgetMs: number): Promise<number> {
    return this.awaitBuildId(channel, this.idOf(name), budgetMs);
  }

  async awaitBuildId(channel: Channel, want: string, budgetMs: number): Promise<number> {
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
        `${Date.now() - started} ms; expected ${JSON.stringify(want)}. ` +
        `${await this.pointerNow(channel)}. ${this.originSays()}`,
    );
  }

  async awaitShellContaining(channel: Channel, text: string, budgetMs: number): Promise<number> {
    const started = Date.now();
    while (Date.now() - started < budgetMs) {
      await this.visit(channel);
      if (this.lastBody.includes(text)) return Date.now() - started;
      await Bun.sleep(500);
    }
    throw new Error(
      `the ${channel} origin did not serve a shell containing ${JSON.stringify(text)} ` +
        `within ${Date.now() - started} ms. ${await this.pointerNow(channel)}. ` +
        `${this.originSays()}`,
    );
  }

  async usePage(page: Page): Promise<void> {
    this.page = page;
    page.on("request", (r) => this.requests.push(r.url()));
    await page.addInitScript(() => {
      const seen: string[] = [];
      (globalThis as unknown as { __refusals: string[] }).__refusals = seen;
      document.addEventListener("securitypolicyviolation", (e) => {
        seen.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
  }

  async policyRefusals(): Promise<string[]> {
    return this.browserPage.evaluate(
      () => (globalThis as unknown as { __refusals?: string[] }).__refusals ?? [],
    );
  }

  get browserPage(): Page {
    if (!this.page) throw new Error("no browser page; is the scenario tagged @browser?");
    return this.page;
  }

  async openView(path: string, apps: string[]): Promise<void> {
    const page = this.browserPage;
    const url = `${this.originFor("qa")}${path}`;
    if (page.url() === "about:blank") await page.goto(url);
    else await page.click(`a[href="${path}"]`);
    for (const app of apps) {
      await page.waitForSelector(`[data-app="${app}"] section`, { timeout: 20_000 });
    }
  }

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
