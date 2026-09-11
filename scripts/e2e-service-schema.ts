// Does a page report what the service holds, and react when a field is
// retired - with nothing rebuilt and nothing promoted? §26.
//
//   bun run e2e:schema
//
// The claim this exists to falsify: the deprecation of a service field reaches
// separately published units through the store they share, on the SERVICE's
// deploy schedule and no unit's. Every other check in the repository
// can be green while that is false. The unit tests hand `readService` a fake
// client; the scenarios drive the service process and read its headers. Only
// this one builds the real bundles, promotes them, and then reads what each
// panel painted in a browser before and after an operator's decision.
//
// It writes only test-* channels. The service is a LOCAL process rather than
// the deployed one, because the whole point is to change API_DEPRECATED twice
// in one run - and doing that to the deployed service would be changing what
// the live site is told while a visitor is reading it. Everything else is real:
// the store, the units, publish, promote, the bundles, the server and the
// browser. `e2e:api` is the counterpart that does drive the deployed service.

import { chromium, type Browser, type Page } from "playwright-core";
import { APPS, UNITS, type Unit } from "./contract.ts";
import { configFromEnv, publicOrigin } from "./store.ts";

const CHANNEL = Bun.env.E2E_CHANNEL ?? "test-qa";
/** *.localhost resolves to loopback in browsers, so this needs no hosts entry. */
const HOST = Bun.env.E2E_HOST ?? "test-qa.localhost";
const PROPAGATION_MS = 30_000;
const RUN = Date.now().toString(36);

const SUNSET = "2026-12-10";
const REASON = "the audience moves onto the visitor";
const RETIRE = JSON.stringify([
  { path: "greeting.audience", since: "2026-09-10", sunset: SUNSET, reason: REASON, instead: null },
]);

if (!CHANNEL.startsWith("test-")) {
  console.error(`refusing to run against ${CHANNEL}: promoting is a deploy, and this is not a test channel.`);
  process.exit(1);
}

const failures: string[] = [];
let step = 0;

const check = (what: string, ok: boolean, detail = ""): void => {
  if (ok) console.log(`  ok   ${what}`);
  else {
    console.log(`  FAIL ${what}${detail ? `\n         ${detail}` : ""}`);
    failures.push(what);
  }
};
const heading = (text: string): void => console.log(`\n${++step}. ${text}`);

/**
 * A check that needs a panel to look at.
 *
 * Reported as skipped when the tree builds no sub-app, never dropped. A run
 * that stopped asking would print the same green as a run that asked.
 */
const skippedForNoPanel: string[] = [];
const onPanel = (what: string, run: () => void): void => {
  if (PANEL) run();
  else {
    console.log(`  skip ${what} - no panel on this slate draws a field of the service`);
    skippedForNoPanel.push(what);
  }
};

type Run = { code: number; stdout: string; stderr: string };

async function sh(cmd: string[], env: Record<string, string> = {}): Promise<Run> {
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Reads the port a spawned process announces on stdout. */
async function portOf(proc: Bun.Subprocess, what: string): Promise<string> {
  const reader = (proc.stdout as ReadableStream).getReader();
  const deadline = Date.now() + 15_000;
  let buffered = "";
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += new TextDecoder().decode(value);
    const m = /listening on http:\/\/[^:]+:(\d+)/.exec(buffered);
    if (m) {
      reader.releaseLock();
      return m[1]!;
    }
  }
  throw new Error(`${what} did not start. Output so far:\n${buffered}`);
}

// -- the two processes under test -------------------------------------------

const service: { proc: Bun.Subprocess | null } = { proc: null };
const server: { proc: Bun.Subprocess | null } = { proc: null };
let SERVICE_BASE = "";
let SERVICE_PORT = "0";
let ADDRESS = "";

/**
 * Starts the service, on the port it was last on.
 *
 * The port is held across restarts on purpose. The server reads API_BASE once,
 * at startup, so a service that came back somewhere else would need the server
 * restarted too - and then "the page changed and nothing was deployed" would
 * have a deploy in the middle of it.
 */
async function startService(deprecated: string): Promise<void> {
  service.proc?.kill();
  if (service.proc) await service.proc.exited;
  const proc = Bun.spawn(["bun", "api/index.ts"], {
    env: { ...process.env, PORT: SERVICE_PORT, API_SERVES: "v1", API_DEPRECATED: deprecated },
    stdout: "pipe",
    stderr: "pipe",
  });
  service.proc = proc;
  SERVICE_PORT = await portOf(proc, "the service");
  SERVICE_BASE = `http://127.0.0.1:${SERVICE_PORT}`;
}

async function startServer(): Promise<void> {
  const cfg = configFromEnv();
  const proc = Bun.spawn(["bun", "src/server/index.ts"], {
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: "0",
      MANIFEST_BASE: `${publicOrigin(cfg)}/manifests`,
      API_BASE: SERVICE_BASE,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  server.proc = proc;
  ADDRESS = `http://${HOST}:${await portOf(proc, "the server")}`;
}

// -- what the browser sees ---------------------------------------------------

type Panels = {
  /** What the panel draws, in full. */
  greeting: string;
  /** The field the panel says is going away, or null. */
  panelGoing: string | null;
  serviceState: string | null;
  serves: string;
  fields: string[];
  going: string[];
  headerSunset: string | null;
};

const textOf = async (page: Page, selector: string): Promise<string> => {
  const el = await page.$(selector);
  return el ? ((await el.textContent()) ?? "").replace(/\s+/g, " ").trim() : "";
};

const attrOf = async (page: Page, selector: string, name: string): Promise<string | null> => {
  const el = await page.$(selector);
  return el ? el.getAttribute(name) : null;
};

/**
 * The sub-app whose panel draws a field of the SERVICE, or null when none does.
 *
 * Null since `PLAN.md` step 0, and it stays null at step 1 for a different
 * reason: the tree builds `list`, but `list` draws the planner's tasks, which
 * live in the browser and which the service holds none of. It gets a subject at
 * step 6, when the service starts holding snapshots, and the panel's
 * `store.goingAway("snapshot.tasks")` call is what step 13 reads.
 *
 * The readings that need one are SKIPPED and said to be skipped rather than
 * dropped: a run that quietly stopped asking about the panel would report the
 * same "ok" count as one that asked and got the right answer.
 */
const PANEL: string | null = null;

/** Every reading this run makes, taken from the rendered DOM of both views. */
async function readPanels(page: Page): Promise<Panels> {
  let greeting = "";
  let panelGoing: string | null = null;
  if (PANEL) {
    await page.goto(`${ADDRESS}/`, { waitUntil: "domcontentloaded" });
    await page.waitForSelector(`[data-app="${PANEL}"] section`, { timeout: 30_000 });
    // The service reading arrives after the first paint, so wait for the shell
    // to have settled it rather than reading a page mid-flight.
    await page.waitForFunction(() => document.documentElement.dataset.api !== undefined, {
      timeout: 30_000,
    });
    greeting = await textOf(page, "[data-greeting]");
    panelGoing = await attrOf(page, `[data-app="${PANEL}"] [data-going]`, "data-going");
  }

  await page.goto(`${ADDRESS}/service`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("[data-service]", { timeout: 30_000 });
  await page.waitForFunction(
    () => document.querySelector("[data-service]")?.getAttribute("data-service") !== "unread",
    undefined,
    { timeout: 30_000 },
  );
  const serviceState = await textOf(page, "[data-service-state]");
  const serves = await textOf(page, "[data-service-serves]");
  const fields = await page.$$eval("[data-field]", (els) =>
    els.map((e) => e.getAttribute("data-field") ?? ""),
  );
  const going = await page.$$eval("[data-going]", (els) =>
    els.map((e) => e.getAttribute("data-going") ?? ""),
  );
  const headerSunset = await attrOf(page, "[data-header-sunset]", "data-header-sunset");

  return { greeting, panelGoing, serviceState, serves, fields, going, headerSunset };
}

/** Writes to the running service, the way an operator does. */
async function tell(resource: string, body: unknown): Promise<number> {
  const res = await fetch(`${SERVICE_BASE}/v1/${resource}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return res.status;
}

/** The unit ids the origin is handing out, from the page's own build block. */
async function unitsOnPage(page: Page): Promise<Record<string, string>> {
  return page.evaluate(() => {
    const el = document.getElementById("__BUILD__");
    const info = JSON.parse(el?.textContent ?? "{}") as {
      units?: Record<string, { unitId: string }>;
    };
    return Object.fromEntries(
      Object.entries(info.units ?? {}).map(([unit, u]) => [unit, u.unitId]),
    );
  });
}

async function awaitUnit(unit: Unit, id: string): Promise<void> {
  const started = Date.now();
  let seen: string | undefined;
  while (Date.now() - started < PROPAGATION_MS) {
    const r = await sh(["curl", "-sS", `${ADDRESS}/`]);
    const m = /id="__BUILD__">(.*?)<\/script>/s.exec(r.stdout);
    if (m?.[1]) {
      const info = JSON.parse(m[1]) as { units?: Record<string, { unitId: string }> };
      seen = info.units?.[unit]?.unitId;
      if (seen === id) return;
    }
    await Bun.sleep(1000);
  }
  throw new Error(`${CHANNEL} still served ${unit}=${seen} after ${PROPAGATION_MS} ms; wanted ${id}`);
}

// -- the run -----------------------------------------------------------------

let browser: Browser | null = null;

try {
  heading("Build and publish both units, then compose the channel from them");
  const built = await sh(
    ["bun", "run", "build"],
    Object.fromEntries(UNITS.map((u) => [`BUILD_MARKER_${u.toUpperCase()}`, RUN])),
  );
  if (built.code !== 0) throw new Error(`build failed:\n${built.stderr}`);
  const published = await sh(["bun", "run", "--silent", "scripts/publish.ts"]);
  if (published.code !== 0) throw new Error(`publish failed:\n${published.stderr}`);
  const ids = JSON.parse(published.stdout) as Record<Unit, string>;

  await startService("");
  await startServer();
  console.log(`   service ${SERVICE_BASE}`);
  console.log(`   serving ${ADDRESS} from the real store`);

  const promoted = await sh([
    "bun", "run", "--silent", "scripts/promote.ts", CHANNEL,
    "--shell", ids.shell,
    ...APPS.flatMap((a) => ["--app", `${a}=${ids[a]}`]),
  ]);
  if (promoted.code !== 0) throw new Error(`promote failed:\n${promoted.stderr}`);
  await awaitUnit("shell", ids.shell);
  for (const app of APPS) await awaitUnit(app, ids[app]);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();

  heading("Nothing is going away. The frame says what the service holds");
  const before = await readPanels(page);
  const unitsBefore = await unitsOnPage(page);

  check("the frame read the service", before.serviceState === "ok", `state ${before.serviceState}`);
  check(
    "it names every field the service publishes",
    ["greeting.text", "greeting.audience"].every((f) => before.fields.includes(f)),
    JSON.stringify(before.fields),
  );
  check("it names the version this shell calls", before.serves === "v1", before.serves);
  check("it marks nothing as going away", before.going.length === 0, JSON.stringify(before.going));
  check("no response has carried a Sunset", before.headerSunset === null, `${before.headerSunset}`);
  onPanel("the panel draws what the service holds", () =>
    check("the panel draws what the service holds", before.greeting === "Hello, world", before.greeting),
  );
  onPanel("and says nothing about a retirement", () =>
    check("and says nothing about a retirement", before.panelGoing === null, `${before.panelGoing}`),
  );

  heading(`Retire greeting.audience on the SERVICE only. No build, no publish, no promote`);
  await startService(RETIRE);
  const after = await readPanels(page);
  const unitsAfter = await unitsOnPage(page);

  check(
    "the frame marks greeting.audience as going away",
    after.going.includes("greeting.audience"),
    JSON.stringify(after.going),
  );
  check(
    "it still names every other field",
    after.fields.length === before.fields.length,
    JSON.stringify(after.fields),
  );
  onPanel("the panel names the field being retired", () =>
    check(
      "the panel names the field being retired",
      after.panelGoing === "greeting.audience",
      `${after.panelGoing}`,
    ),
  );
  check(
    "the page read the Sunset header off a data response",
    after.headerSunset === new Date(`${SUNSET}T00:00:00Z`).toUTCString(),
    `${after.headerSunset}`,
  );

  // The claim the whole run exists for.
  check(
    "not one unit moved between the two readings",
    JSON.stringify(unitsBefore) === JSON.stringify(unitsAfter),
    `${JSON.stringify(unitsBefore)} then ${JSON.stringify(unitsAfter)}`,
  );
  check(
    "and the units served are the ones this run published",
    UNITS.every((u) => unitsAfter[u] === ids[u]),
    JSON.stringify(unitsAfter),
  );

  heading("Change what the service HOLDS, with one write and no deploy");
  check("the service took the greeting", (await tell("greeting", { text: "Hei", audience: "Oslo" })) === 200);
  check("and refused a greeting no page could draw", (await tell("greeting", { text: "" })) === 400);

  const offered = await readPanels(page);
  const unitsOffered = await unitsOnPage(page);

  onPanel("the panel draws the new greeting", () =>
    check("the panel draws the new greeting", offered.greeting === "Hei, Oslo", offered.greeting),
  );
  check(
    "not one unit moved for any of it",
    JSON.stringify(unitsOffered) === JSON.stringify(unitsBefore),
    `${JSON.stringify(unitsBefore)} then ${JSON.stringify(unitsOffered)}`,
  );

  heading("Take the service away. A page that cannot read it is a different page, never a blank one");
  service.proc?.kill();
  await service.proc?.exited;
  service.proc = null;
  const gone = await readPanels(page);

  check("the frame reports the service as failed", gone.serviceState === "failed", `${gone.serviceState}`);
  check("it names no field, because it read none", gone.fields.length === 0, JSON.stringify(gone.fields));
  // The default the store was built with. A slow or absent service costs the
  // page the service's greeting and never the page.
  onPanel("and the panel still draws a greeting", () =>
    check("and the panel still draws a greeting", gone.greeting === "Hello, world", gone.greeting),
  );
  check("the page still serves every unit", (await unitsOnPage(page)).shell === ids.shell);
} finally {
  await browser?.close();
  service.proc?.kill();
  server.proc?.kill();
}

if (skippedForNoPanel.length) {
  console.log(
    `\n${skippedForNoPanel.length} checks were SKIPPED because this tree builds no ` +
      `sub-app, so nothing draws a panel: ${skippedForNoPanel.join("; ")}. ` +
      `They come back at PLAN.md step 1.`,
  );
}

console.log(
  failures.length === 0
    ? `\nAll checks passed. ${step} steps.`
    : `\n${failures.length} FAILED:\n${failures.map((f) => `  ${f}`).join("\n")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
