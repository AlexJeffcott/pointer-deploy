// Does a page report what the service holds, and react when a field is
// retired - with nothing rebuilt and nothing promoted? §26.
//
//   bun run e2e:schema
//
// The claim this exists to falsify: the deprecation of a service field reaches
// five separately published units through the store they share, on the
// SERVICE's deploy schedule and no unit's. Every other check in the repository
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

const SUNSET = "2026-11-30";
const REASON = "the colour moves into a theme object";
const RETIRE = JSON.stringify([
  { path: "user.colour", since: "2026-08-31", sunset: SUNSET, reason: REASON, instead: null },
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
  alphaGoing: string | null;
  alphaSteps: string[];
  alphaMax: string | null;
  bravoMinus: boolean;
  bravoDays: string | null;
  charlieCaption: string;
  charlieTotals: boolean;
  charlieAgrees: string | null;
  deltaBars: string | null;
  deltaShares: number;
  deltaLabels: string[];
  shellMotd: string | null;
  shellCompact: string | null;
  echoState: string | null;
  echoFields: string[];
  echoGoing: string[];
  echoSunsetHeader: string | null;
  echoServes: string | null;
};

const textOf = async (page: Page, selector: string): Promise<string> => {
  const el = await page.$(selector);
  return el ? ((await el.textContent()) ?? "").replace(/\s+/g, " ").trim() : "";
};

const attrOf = async (page: Page, selector: string, name: string): Promise<string | null> => {
  const el = await page.$(selector);
  return el ? el.getAttribute(name) : null;
};

/** Every reading this run makes, taken from the rendered DOM of all three views. */
async function readPanels(page: Page): Promise<Panels> {
  await page.goto(`${ADDRESS}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-app="alpha"] section', { timeout: 30_000 });
  // The service reading arrives after the first paint, so wait for the shell to
  // have settled it rather than reading a page mid-flight.
  await page.waitForFunction(() => document.documentElement.dataset.api !== undefined, {
    timeout: 30_000,
  });
  const alphaGoing = await attrOf(page, '[data-app="alpha"] [data-going]', "data-going");
  const alphaSteps = await page.$$eval('[data-app="alpha"] [data-step]', (els) =>
    els.map((e) => e.getAttribute("data-step") ?? ""),
  );
  const alphaMax = await attrOf(page, '[data-app="alpha"] [data-max]', "data-max");
  const bravoMinus = (await page.$('[data-app="bravo"] [data-allow-negative]')) !== null;
  const bravoDays = await attrOf(page, '[data-app="bravo"] [data-sunset-days]', "data-sunset-days");
  const shellMotd = await attrOf(page, "[data-motd]", "data-motd");
  const shellCompact = await attrOf(page, "[data-compact]", "data-compact");

  await page.goto(`${ADDRESS}/totals`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-app="charlie"] section', { timeout: 30_000 });
  await page.waitForSelector('[data-app="delta"] [data-bars]', { timeout: 30_000 });
  const charlieCaption = await textOf(page, '[data-app="charlie"] [data-source]');
  const charlieTotals = (await page.$('[data-app="charlie"] [data-totals]')) !== null;
  const charlieAgrees = await attrOf(page, '[data-app="charlie"] [data-agrees]', "data-agrees");
  const deltaBars = await attrOf(page, '[data-app="delta"] [data-bars]', "data-bars");
  const deltaShares = (await page.$$('[data-app="delta"] [data-share-for]')).length;
  const deltaLabels = await page.$$eval('[data-app="delta"] [data-ns]', (els) =>
    els.map((e) => (e.textContent ?? "").trim()),
  );

  await page.goto(`${ADDRESS}/api`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-app="echo"] section', { timeout: 30_000 });
  const echoState = await attrOf(page, '[data-app="echo"] [data-service-state]', "data-service-state");
  const echoFields = await page.$$eval('[data-app="echo"] [data-field]', (els) =>
    els.map((e) => e.getAttribute("data-field") ?? ""),
  );
  const echoGoing = await page.$$eval('[data-app="echo"] [data-going]', (els) =>
    els.map((e) => e.getAttribute("data-going") ?? ""),
  );
  const echoSunsetHeader = await attrOf(
    page,
    '[data-app="echo"] [data-header-sunset]',
    "data-header-sunset",
  );
  const echoServes = await attrOf(page, '[data-app="echo"] [data-serves]', "data-serves");

  return {
    alphaGoing,
    alphaSteps,
    alphaMax,
    bravoMinus,
    bravoDays,
    charlieCaption,
    charlieTotals,
    charlieAgrees,
    deltaBars,
    deltaShares,
    deltaLabels,
    shellMotd,
    shellCompact,
    echoState,
    echoFields,
    echoGoing,
    echoSunsetHeader,
    echoServes,
  };
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
  heading("Build and publish all six units, then compose the channel from them");
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
  await awaitUnit("echo", ids.echo);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();

  heading("Nothing is going away. Every panel says so, and echo says what is there");
  const before = await readPanels(page);
  const unitsBefore = await unitsOnPage(page);

  check("echo read the service", before.echoState === "ok", `state ${before.echoState}`);
  check(
    "echo names every field the service publishes",
    ["user.name", "user.colour", "counters.<ns>"].every((f) => before.echoFields.includes(f)),
    JSON.stringify(before.echoFields),
  );
  check("echo names the version this shell calls", before.echoServes === "v1", `${before.echoServes}`);
  check("echo marks nothing as going away", before.echoGoing.length === 0, JSON.stringify(before.echoGoing));
  check("alpha says nothing about a retirement", before.alphaGoing === null);
  check("alpha draws the steps the service advises", before.alphaSteps.join(",") === "5,10", before.alphaSteps.join(","));
  check("alpha names the ceiling the service advises", before.alphaMax === "100", `${before.alphaMax}`);
  check("bravo offers a way down, because the service allows it", before.bravoMinus);
  check("bravo shows no countdown", before.bravoDays === null);
  check("charlie draws its totals row", before.charlieTotals);
  check("charlie agrees with what the service counts", before.charlieAgrees === "true", `${before.charlieAgrees}`);
  check("delta draws a share for every namespace", before.deltaShares > 0, `${before.deltaShares}`);
  check(
    "delta draws the service's labels, not the namespaces",
    before.deltaLabels.some((l) => l.includes("Alpha")),
    JSON.stringify(before.deltaLabels),
  );
  check("the frame shows no message", before.shellMotd === null);
  check("the frame is not compact", before.shellCompact === "false", `${before.shellCompact}`);
  check(
    "charlie says which version it was read over",
    before.charlieCaption.includes("Read over v1"),
    before.charlieCaption,
  );
  check("delta draws its bars as settled", before.deltaBars === "settled", `${before.deltaBars}`);

  heading(`Retire user.colour on the SERVICE only. No build, no publish, no promote`);
  await startService(RETIRE);
  const after = await readPanels(page);
  const unitsAfter = await unitsOnPage(page);

  check(
    "echo marks user.colour as going away",
    after.echoGoing.includes("user.colour"),
    JSON.stringify(after.echoGoing),
  );
  check(
    "echo still names every other field",
    after.echoFields.length === before.echoFields.length,
    JSON.stringify(after.echoFields),
  );
  check("alpha names the field being retired", after.alphaGoing === "user.colour", `${after.alphaGoing}`);
  check(
    "bravo counts the days left, and there are some",
    after.bravoDays !== null && Number(after.bravoDays) > 0,
    `${after.bravoDays}`,
  );
  // Derived from what echo read, not typed in: a count written here goes stale
  // the next time the service publishes one more field, and reports a fault in
  // charlie that is really a fault in this line.
  const fields = before.echoFields.length;
  check(
    "charlie counts what is still current",
    after.charlieCaption.includes(`${fields - 1} of ${fields} fields current`),
    after.charlieCaption,
  );
  check("delta is unmoved: the reading is still good", after.deltaBars === "settled", `${after.deltaBars}`);
  check(
    "the page read the Sunset header off a data response",
    after.echoSunsetHeader === new Date(`${SUNSET}T00:00:00Z`).toUTCString(),
    `${after.echoSunsetHeader}`,
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

  heading("Change what the service OFFERS, with four writes and no deploy");
  check("the service took the flags", (await tell("flags", { showShares: false, showTotals: false, compact: true })) === 200);
  check("the service took the limits", (await tell("limits", { step: 20, allowNegative: false })) === 200);
  check("the service took the labels", (await tell("labels", { alpha: { title: "Ay", emoji: "!" } })) === 200);
  check(
    "the service took the message",
    (await tell("motd", { text: "back at 14:00", level: "warn", until: "2026-12-01" })) === 200,
  );
  check("and refused a step no page could draw", (await tell("limits", { step: 0 })) === 400);

  const offered = await readPanels(page);
  const unitsOffered = await unitsOnPage(page);

  check("alpha draws the new steps", offered.alphaSteps.join(",") === "20,40", offered.alphaSteps.join(","));
  check("bravo no longer offers a way down", offered.bravoMinus === false);
  check("charlie drops its totals row", offered.charlieTotals === false);
  check("delta drops its share column", offered.deltaShares === 0, `${offered.deltaShares}`);
  check(
    "delta draws the renamed label",
    offered.deltaLabels.some((l) => l.includes("Ay")),
    JSON.stringify(offered.deltaLabels),
  );
  check("the frame shows the message", offered.shellMotd === "warn", `${offered.shellMotd}`);
  check("the frame is compact", offered.shellCompact === "true", `${offered.shellCompact}`);

  // Each write lands on some panels and not others. That is the whole reason
  // the fields are owned one at a time rather than as one settings object.
  check("and alpha was not touched by the flags", offered.alphaMax === "100", `${offered.alphaMax}`);
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

  check("echo reports the service as failed", gone.echoState === "failed", `${gone.echoState}`);
  check("delta stops claiming the bars are the whole set", gone.deltaBars === "failed", `${gone.deltaBars}`);
  check(
    "charlie says the counts are the page's own",
    gone.charlieCaption.includes("did not answer"),
    gone.charlieCaption,
  );
  check("and the page still renders every panel", (await unitsOnPage(page)).shell === ids.shell);
} finally {
  await browser?.close();
  service.proc?.kill();
  server.proc?.kill();
}

console.log(
  failures.length === 0
    ? `\nAll checks passed. ${step} steps.`
    : `\n${failures.length} FAILED:\n${failures.map((f) => `  ${f}`).join("\n")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
