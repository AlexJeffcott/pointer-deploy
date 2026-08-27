import {
  After,
  AfterAll,
  Before,
  BeforeAll,
  setDefaultTimeout,
  setWorldConstructor,
  World,
} from "@cucumber/cucumber";
import { chromium, type Browser, type Page } from "playwright-core";
import { manifestDoc, startStubStore, type StubStore } from "./stub-store.ts";
import { curlGet, run, type Run } from "./http.ts";
import { APPS, UNITS, type Unit } from "../../scripts/contract.ts";
import { CACHE_POINTER, configFromEnv, getObjectText, putObject } from "../../scripts/store.ts";

setDefaultTimeout(180_000);

export { curlGet, run };

export type Channel = "qa" | "prod";
export type Mode = "local" | "live";

export const MODE: Mode = (Bun.env.HARNESS as Mode) ?? "local";

/** The store's 5 s pointer cache plus the server's manifest TTL. */
export const PROPAGATION_WINDOW_MS = 15_000;

const LOCAL_TTL_MS = 300;

const LIVE_ADDRESS = Bun.env.LIVE_ADDRESS ?? "https://pointer-deploy.fly.dev";

const MANIFEST_BASE =
  Bun.env.MANIFEST_BASE ?? "https://pointer-deploy-assets.fly.storage.tigris.dev/manifests";
const REGION = Bun.env.REGION ?? "eu";

/**
 * The channel each scenario channel really is, live.
 *
 * The suite publishes throwaway builds and promotes them. Promoting them to
 * qa and prod IS a deploy, so every live run used to leave the application
 * serving a test build until someone promoted a real one. The suite gets two
 * channels of its own instead, and never writes the two the application is
 * served from.
 *
 * The scenarios keep saying "qa" and "prod": which channels the harness uses
 * is not part of the specification.
 */
const LIVE_CHANNELS: Record<Channel, string> = {
  qa: "test-qa",
  prod: "test-prod",
};

/** The channels the suite must never write. Asserted before and after a run. */
const REAL_CHANNELS = ["qa", "prod"] as const;

/**
 * The Host each channel is reached by. Every channel is one app on one
 * machine; only the header differs. No .test name resolves, so each is reached
 * by setting the header directly - which is what Fly forwards to the server
 * anyway.
 */
const LIVE_HOSTS: Record<Channel, string> = {
  qa: Bun.env.TEST_QA_HOST ?? "test-qa.pointer-deploy.test",
  prod: Bun.env.TEST_PROD_HOST ?? "test-prod.pointer-deploy.test",
};

/** Every unit id a named scenario build resolved to. */
export type UnitIds = Record<Unit, string>;

// Shared across scenarios on purpose. Cucumber builds a fresh World per
// scenario, and rebuilding and republishing the same five bundles for each one
// would add minutes without testing anything the first publish did not.
const BUILD_IDS = new Map<string, UnitIds>();

/** What a channel's pointer names in the store, or why it could not be read. */
async function pointerBuildId(channel: string): Promise<string> {
  const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${REGION}/${channel}.json`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) return `absent (${res.status})`;
  try {
    const doc = (await res.json()) as {
      schema?: number;
      buildId?: string;
      shell?: { unitId?: string };
      apps?: Record<string, { unitId?: string }>;
    };
    // Every unit, because a run that moved one app and left the others is
    // still a deploy nobody asked for.
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

type ShellBuildInfo = {
  buildId?: string;
  contract?: string;
  units?: Record<string, { unitId: string; commit: string; marker: string }>;
};

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

/** Which unit id the served page names for each unit. */
export function unitIdsInShell(html: string): Partial<Record<Unit, string>> {
  const units = buildInfoInShell(html)?.units ?? {};
  return Object.fromEntries(Object.entries(units).map(([n, u]) => [n, u.unitId]));
}

/** The base each sub-app's script is fetched from. Per unit under schema 3. */
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
  /** True while this process is serving the real store on 127.0.0.1. */
  localServer = false;

  /** Scenario build name ("alpha") to the unit ids the store holds for it. */
  private ids = BUILD_IDS;

  // Browser scenarios. playwright-core drives the Chrome already on the
  // machine, so nothing downloads a second one.
  browser: Browser | null = null;
  page: Page | null = null;
  /** Every URL the page has requested, in order. */
  requests: string[] = [];

  lastResponse: Response | null = null;
  lastBody = "";
  lastRun: Run | null = null;
  /** Temporary working directory a promote-refusal scenario runs from. */
  guardDir: string | null = null;
  machinesBefore: string | null = null;
  elapsedMs = 0;

  // -- lifecycle ------------------------------------------------------------

  async startLocal(): Promise<void> {
    this.stub = await startStubStore();
    await this.spawnServer({
      MANIFEST_BASE: this.stub.manifestBase,
      MANIFEST_TTL_MS: String(LOCAL_TTL_MS),
      MANIFEST_TIMEOUT_MS: "3000",
    });
  }

  /**
   * The real server, started here, reading the REAL store.
   *
   * Live, a test-* channel is reached by a Host header, and no browser can be
   * made to send one: Host is forbidden to setExtraHTTPHeaders, and Fly routes
   * on SNI, so a resolver override cannot supply it either. So a @browser
   * scenario about one of the suite's own channels runs the documented entry
   * point here instead - the same file the image runs, and the same compromise
   * scripts/e2e-independent-deploy.ts makes. The store, the units, the bundles
   * and the browser are real; only the process the HTML comes from is local.
   */
  async startAgainstRealStore(): Promise<void> {
    await this.spawnServer({
      MANIFEST_BASE,
      // The store caches a pointer for 5 s, so a shorter server TTL buys
      // nothing. This one only stops the server adding to that wait.
      MANIFEST_TTL_MS: "1000",
      MANIFEST_TIMEOUT_MS: "10000",
    });
    this.localServer = true;
  }

  private async spawnServer(env: Record<string, string>): Promise<void> {
    const proc = Bun.spawn(["bun", "src/server/index.ts"], {
      env: {
        ...process.env,
        // Development, so the *.localhost names resolve to a channel.
        NODE_ENV: "development",
        PORT: "0",
        ...env,
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
    this.localServer = false;
  }

  // -- channels -------------------------------------------------------------

  /** The whole composition a scenario build name resolved to. */
  idsOf(name: string): UnitIds {
    return (
      this.ids.get(name) ??
      (Object.fromEntries(UNITS.map((u) => [u, name])) as UnitIds)
    );
  }

  /**
   * The id a scenario means by a build name.
   *
   * The shell's, because that is what the served page reports as its build id
   * and what every scenario written before the split compares against.
   */
  idOf(name: string): string {
    return this.idsOf(name).shell;
  }

  unitIdOf(name: string, unit: Unit): string {
    return this.idsOf(name)[unit];
  }

  setId(name: string, id: string): void {
    this.ids.set(name, Object.fromEntries(UNITS.map((u) => [u, id])) as UnitIds);
  }

  setIds(name: string, ids: UnitIds): void {
    this.ids.set(name, ids);
  }

  /**
   * Build and publish every unit, or register a synthetic composition locally.
   *
   * `markers` overrides the marker of individual units, which is how a scenario
   * gets a new alpha without a new bravo: the other four units come out
   * byte-identical, keep their ids, and publish reports them unchanged.
   */
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

    // Two scenario builds whose shells collide would make every promotion
    // scenario pass by accident, because the channel would already serve the
    // composition being promoted to it.
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

  /** The channel this scenario channel writes. The stub store has no others. */
  storeChannel(channel: Channel): string {
    return this.mode === "live" ? LIVE_CHANNELS[channel] : channel;
  }

  /** The channel the suite is allowed to write. Never a real one. */
  private targetChannel(channel: Channel): string {
    const target = this.storeChannel(channel);
    // A tripwire on the path that caused the defect. Promoting is a deploy, so
    // a mapping that ever resolves to a real channel must stop the run rather
    // than ship a scenario's build to visitors.
    if (!target.startsWith("test-")) {
      throw new Error(
        `the suite tried to promote to ${JSON.stringify(target)}, which is a real channel. ` +
          `Live scenarios may only write test-* channels.`,
      );
    }
    return target;
  }

  /** Promote the whole composition a scenario build name stands for. */
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

  /**
   * Promote ONE unit, leaving the rest of the channel's composition alone.
   *
   * This is the operation the whole feature exists for, so the suite runs the
   * real script with one flag rather than composing the result itself.
   */
  async promoteUnit(channel: Channel, unit: Unit, id: string): Promise<Run> {
    const flag = unit === "shell" ? ["--shell", id] : ["--app", `${unit}=${id}`];
    if (this.mode === "local") {
      throw new Error("promoteUnit is @live only; the stub store does not model promote");
    }
    return run([
      "bun", "run", "--silent", "scripts/promote.ts", this.targetChannel(channel), ...flag,
    ]);
  }

  /** What the channel's pointer names right now, straight from the store. */
  async compositionOf(channel: Channel): Promise<Partial<Record<Unit, string>>> {
    const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${REGION}/${this.storeChannel(channel)}.json`;
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

  /** Setup helper: make the channel point at the build, however that is done. */
  async pointAt(channel: Channel, name: string, markers: Partial<Record<Unit, string>> = {}): Promise<void> {
    await this.publish(name, markers);
    const result = await this.promote(channel, name);
    if (result.code !== 0) throw new Error(`could not point ${channel} at ${name}:\n${result.stderr}`);
    // EVERY unit, not just the shell. Two compositions can share a shell and
    // differ in one app, so waiting on the shell id alone returns immediately
    // while the app a scenario is about is still the previous one. That is not
    // hypothetical: it is what made two scenarios fail the first time this ran.
    if (this.mode === "live") {
      await this.awaitComposition(channel, this.idsOf(name), PROPAGATION_WINDOW_MS + 15_000);
    }
  }

  // -- writing a pointer directly ---------------------------------------------

  /** What the channel's pointer held before a scenario overwrote it. */
  private pointerBefore: { key: string; text: string } | null = null;

  /** The object key of a channel's pointer. Never a real channel's. */
  pointerKey(channel: Channel): string {
    return `manifests/${REGION}/${this.targetChannel(channel)}.json`;
  }

  /**
   * Point a channel at a document promote.ts cannot write.
   *
   * promote.ts composes schema 3 and nothing else, so a scenario about an
   * older schema has to write the pointer itself. It shares the tripwire:
   * only a test-* channel, checked here as well as there, because writing a
   * pointer IS the deploy however it is done.
   */
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

  /**
   * Put back exactly the bytes that were there.
   *
   * Loud on failure on purpose. A restore that swallowed its error would leave
   * the channel pointing at a fixture and report a green run.
   */
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

  // -- requests -------------------------------------------------------------

  /** The address to connect to. Both live channels share one. */
  originFor(channel: Channel): string {
    if (this.mode === "local") return `http://127.0.0.1:${this.serverPort}`;
    // A server this process started against the real store. The channel is
    // selected by the *.localhost name, which a browser CAN send - a Host
    // header is the thing it cannot.
    if (this.localServer) return `http://${this.storeChannel(channel)}.localhost:${this.serverPort}`;
    return LIVE_ADDRESS;
  }

  /** The Host to send. This is what selects the channel. */
  hostFor(channel: Channel): string {
    if (this.mode === "local") return `${channel}.localhost`;
    if (this.localServer) return `${this.storeChannel(channel)}.localhost`;
    return LIVE_HOSTS[channel];
  }

  /** True when the Host differs from the address, so fetch cannot be used. */
  private needsCurl(channel: Channel): boolean {
    if (this.localServer) return false;
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

    const res =
      this.mode === "local"
        ? await fetch(url, { headers: { host }, redirect: "manual" })
        : await curlGet(url, host);

    this.lastResponse = res;
    this.lastBody = await res.text();
    return res;
  }

  /** Poll until the channel serves this exact composition, or time out. */
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
        `${Date.now() - started} ms. Still wrong: ${wrong}`,
    );
  }

  /** Poll until the channel serves this unit id for this unit, or time out. */
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
        `${Date.now() - started} ms; expected ${JSON.stringify(id)}`,
    );
  }

  /** Poll until the channel serves the named build, or time out. */
  async awaitBuild(channel: Channel, name: string, budgetMs: number): Promise<number> {
    return this.awaitBuildId(channel, this.idOf(name), budgetMs);
  }

  /** The same, for a build id no scenario name stands for. */
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
        `${Date.now() - started} ms; expected ${JSON.stringify(want)}`,
    );
  }

  /**
   * Poll until the served shell carries this text, or time out.
   *
   * For a change no build id reports: rewriting one digest inside a pointer
   * leaves every unit id where it was, so nothing above can tell the new
   * manifest from the old one.
   */
  async awaitShellContaining(channel: Channel, text: string, budgetMs: number): Promise<number> {
    const started = Date.now();
    while (Date.now() - started < budgetMs) {
      await this.visit(channel);
      if (this.lastBody.includes(text)) return Date.now() - started;
      await Bun.sleep(500);
    }
    throw new Error(
      `the ${channel} origin did not serve a shell containing ${JSON.stringify(text)} ` +
        `within ${Date.now() - started} ms`,
    );
  }

  // -- browser ---------------------------------------------------------------

  async openBrowser(): Promise<Page> {
    this.browser = await chromium.launch({ channel: "chrome", headless: true });
    const page = await this.browser.newPage();
    page.on("request", (r) => this.requests.push(r.url()));
    // Every content policy refusal the page reports, in order. Installed here
    // rather than in a step because a refusal of the shell's own script happens
    // before any step could attach a listener.
    await page.addInitScript(() => {
      const seen: string[] = [];
      (globalThis as unknown as { __refusals: string[] }).__refusals = seen;
      document.addEventListener("securitypolicyviolation", (e) => {
        seen.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });
    this.page = page;
    return page;
  }

  /** Every content policy refusal the page has reported so far. */
  async policyRefusals(): Promise<string[]> {
    return this.browserPage.evaluate(
      () => (globalThis as unknown as { __refusals?: string[] }).__refusals ?? [],
    );
  }

  async closeBrowser(): Promise<void> {
    await this.browser?.close();
    this.browser = null;
    this.page = null;
  }

  get browserPage(): Page {
    if (!this.page) throw new Error("no browser page; is the scenario tagged @browser?");
    return this.page;
  }

  /** Opens a view and waits until both of its sub-apps have rendered. */
  async openView(path: string, apps: string[]): Promise<void> {
    const page = this.browserPage;
    const url = `${this.originFor("qa")}${path}`;
    if (page.url() === "about:blank") await page.goto(url);
    else await page.click(`a[href="${path}"]`);
    for (const app of apps) {
      // promote.ts warms every file the build names, so a cold edge is no
      // longer something this has to wait out.
      await page.waitForSelector(`[data-app="${app}"] section`, { timeout: 20_000 });
    }
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

// The suite's own channels are the fix; this is the check on it. A live run
// that writes qa or prod is a deploy nobody asked for, so the run records what
// the real channels point at and fails if either moved. It repairs nothing on
// purpose - a restore that fails leaves the channel wrong and says it did not.
const realChannelsBefore = new Map<string, string>();

BeforeAll(async function () {
  if (MODE !== "live") return;
  for (const channel of REAL_CHANNELS) {
    realChannelsBefore.set(channel, await pointerBuildId(channel));
  }
});

AfterAll(async function () {
  if (MODE !== "live") return;
  const moved: string[] = [];
  for (const channel of REAL_CHANNELS) {
    const before = realChannelsBefore.get(channel);
    const after = await pointerBuildId(channel);
    if (before !== after) moved.push(`  ${channel}: ${before} -> ${after}`);
  }
  if (moved.length) {
    throw new Error(
      `the live suite moved ${moved.length} real channel(s). That is a deploy:\n` +
        `${moved.join("\n")}\n` +
        `Promote the build that should be live, then find what wrote the channel.`,
    );
  }
});

Before({ tags: "@local" }, async function (this: PointerWorld) {
  if (this.mode !== "local") return;
  await this.startLocal();
});

Before({ tags: "@live" }, async function (this: PointerWorld) {
  if (this.mode !== "live") return;
  this.machinesBefore = await this.machineFingerprint();
});

// A scenario that drives one of the suite's OWN channels in a browser. No
// browser can reach a test-* channel on Fly - Host is forbidden to
// setExtraHTTPHeaders and Fly routes on SNI - so the documented entry point
// runs here, against the real store. Registered before the @browser hook so
// the server is listening by the time a page is opened.
Before({ tags: "@test-channel" }, async function (this: PointerWorld) {
  if (this.mode !== "live") {
    throw new Error("@test-channel needs the real store. Run `bun run verify:browser`.");
  }
  await this.startAgainstRealStore();
});

Before({ tags: "@browser" }, async function (this: PointerWorld) {
  await this.openBrowser();
});

After(async function (this: PointerWorld) {
  await this.closeBrowser();
  await this.stopLocal();
  // Last, and after the server that was reading it is gone: a channel left
  // holding a fixture is a channel pointing somewhere nobody promoted.
  await this.restorePointer();
});
