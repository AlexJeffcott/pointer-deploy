// Does per-unit deploy and rollback actually work, from a browser's point of
// view?
//
//   bun run e2e
//
// Every other check in this repository can be green while this fails. The unit
// tests construct compositions by hand. The @live scenarios read unit ids out
// of the served HTML, which is the manifest talking about itself. This drives
// the documented commands end to end and then reads the RENDERED PAGE - the
// marker each sub-app painted into the DOM - because that is the only place
// "hello moved and the shell did not" is a fact about the application rather
// than a fact about a JSON file.
//
// It writes only the test-* channels, never the two the application is served
// from, and it starts from whatever those channels held: the first step
// composes them from scratch.
//
// One thing is NOT the deployed machine, and it is worth being plain about.
// Live, a test channel is reached by a Host header, and no browser can be made
// to send one: Host is forbidden to setExtraHTTPHeaders, and Fly routes on
// SNI, so a resolver override cannot supply it either. So the browser half
// runs this same server locally - `bun src/server/index.ts`, the documented
// entry point, the same file the image runs - against the real store. The
// store, the units, publish, promote, the bundles and the browser are all
// real; only the process the HTML comes from is local.
//
// The deployed machine is not left unchecked: verify:live drives every @live
// scenario through it, and the machine fingerprint here is compared before and
// after.

import { chromium, type Browser, type Page } from "playwright-core";
import { APPS, UNITS, type Unit } from "./contract.ts";
import { configFromEnv, publicOrigin } from "./store.ts";

const CHANNEL = Bun.env.E2E_CHANNEL ?? "test-qa";
/** *.localhost resolves to loopback in browsers, so this needs no hosts entry. */
const HOST = Bun.env.E2E_HOST ?? "test-qa.localhost";

// The store's 5 s pointer cache plus the server's 10 s manifest TTL, and room
// to spare.
const PROPAGATION_MS = 30_000;

/**
 * Markers unique to this run.
 *
 * Fixed markers would produce unit ids already in the store from an earlier
 * run, publish would correctly skip them, and "publish uploaded only hello"
 * would fail on every run after the first - reporting a defect in the run
 * rather than in the code. Two more immutable units per run is the price;
 * nothing is ever deleted from this bucket anyway.
 */
const RUN = Date.now().toString(36);
const V1 = `${RUN}-1`;
const V2 = `${RUN}-2`;

if (!CHANNEL.startsWith("test-")) {
  console.error(`refusing to run against ${CHANNEL}: promoting is a deploy, and this is not a test channel.`);
  process.exit(1);
}

type Run = { code: number; stdout: string; stderr: string };

async function sh(cmd: string[], env: Record<string, string> = {}): Promise<Run> {
  const proc = Bun.spawn(cmd, { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}

const failures: string[] = [];
let step = 0;

function check(what: string, ok: boolean, detail = ""): void {
  if (ok) {
    console.log(`  ok   ${what}`);
  } else {
    console.log(`  FAIL ${what}${detail ? `\n         ${detail}` : ""}`);
    failures.push(what);
  }
}

function heading(text: string): void {
  console.log(`\n${++step}. ${text}`);
}

async function buildAndPublish(markers: Record<string, string>): Promise<Record<Unit, string>> {
  const env: Record<string, string> = {};
  for (const [unit, marker] of Object.entries(markers)) {
    env[`BUILD_MARKER_${unit.toUpperCase()}`] = marker;
  }
  const built = await sh(["bun", "run", "build"], env);
  if (built.code !== 0) throw new Error(`build failed:\n${built.stderr}`);

  const published = await sh(["bun", "run", "--silent", "scripts/publish.ts"]);
  if (published.code !== 0) throw new Error(`publish failed:\n${published.stderr}`);
  lastPublish = published.stderr;
  return JSON.parse(published.stdout) as Record<Unit, string>;
}

let lastPublish = "";

const uploadedUnits = (): string[] =>
  lastPublish
    .split("\n")
    .filter((l) => l.includes("uploaded"))
    .map((l) => l.trim().split(/\s+/)[0]!)
    .sort();

async function promote(args: string[]): Promise<Run> {
  const r = await sh(["bun", "run", "--silent", "scripts/promote.ts", CHANNEL, ...args]);
  if (r.code !== 0) throw new Error(`promote ${args.join(" ")} failed:\n${r.stderr}`);
  return r;
}

// -- what the browser actually sees -----------------------------------------

/**
 * The marker each sub-app painted, read off the rendered DOM.
 *
 * Not the manifest, and not the __BUILD__ block: both of those are the deploy
 * system describing itself. This is the bundle that ran.
 */
async function markersOnPage(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [path, apps] of [["/", ["hello"]]] as const) {
    const url = `${ADDRESS}${path}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    for (const app of apps) {
      const el = await page.waitForSelector(`[data-app="${app}"] section`, { timeout: 30_000 });
      out[app] = (await el.getAttribute("data-unit-marker")) ?? "";
    }
    // The frame is a unit too, and the whole point is that it moves apart from
    // the panels inside it.
    out.shell =
      (await page.evaluate(
        () => document.querySelector("div[data-unit-marker]")?.getAttribute("data-unit-marker") ?? "",
      )) ?? "";
  }
  return out;
}

/** Poll the served HTML until this unit id appears, or give up. */
async function awaitUnit(unit: Unit, id: string): Promise<number> {
  const started = Date.now();
  let seen: string | undefined;
  while (Date.now() - started < PROPAGATION_MS) {
    const r = await sh(["curl", "-sS", `${ADDRESS}/`]);
    const m = /id="__BUILD__">(.*?)<\/script>/s.exec(r.stdout);
    if (m?.[1]) {
      const info = JSON.parse(m[1]) as { units?: Record<string, { unitId: string }> };
      seen = info.units?.[unit]?.unitId;
      if (seen === id) return Date.now() - started;
    }
    await Bun.sleep(1000);
  }
  throw new Error(`${CHANNEL} still served ${unit}=${seen} after ${PROPAGATION_MS} ms; wanted ${id}`);
}

async function machineFingerprint(): Promise<string> {
  const r = await sh(["fly", "machine", "list", "--json"]);
  if (r.code !== 0) return "unavailable";
  const machines = JSON.parse(r.stdout) as Array<{ id: string; updated_at: string }>;
  return machines.map((m) => `${m.id}@${m.updated_at}`).sort().join(",");
}

// -- the server under test ---------------------------------------------------

// A holder rather than a bare `let`: TypeScript narrows a module-level let
// assigned inside a function to `null`, and the kill in `finally` then does
// not typecheck.
const server: { proc: Bun.Subprocess | null } = { proc: null };
let ADDRESS = "";

/** Starts the real server, against the real store, and reports its port. */
async function startServer(): Promise<void> {
  const cfg = configFromEnv();
  const proc = Bun.spawn(["bun", "src/server/index.ts"], {
    env: {
      ...process.env,
      // Development, so the *.localhost names resolve to a channel. Everything
      // else - the manifest base, the store, the bundles - is production.
      NODE_ENV: "development",
      PORT: "0",
      MANIFEST_BASE: `${publicOrigin(cfg)}/manifests`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  server.proc = proc;

  const reader = proc.stdout.getReader();
  const deadline = Date.now() + 10_000;
  let buffered = "";
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += new TextDecoder().decode(value);
    const m = /listening on http:\/\/[^:]+:(\d+)/.exec(buffered);
    if (m) {
      reader.releaseLock();
      ADDRESS = `http://${HOST}:${m[1]}`;
      return;
    }
  }
  throw new Error(`the server did not start. Output so far:\n${buffered}`);
}

// -- the run -----------------------------------------------------------------

let browser: Browser | null = null;

try {
  const machinesBefore = await machineFingerprint();
  await startServer();
  console.log(`   serving ${ADDRESS} from the real store`);

  heading(`Compose the channel from scratch: both units, every marker ${V1}`);
  const v1 = await buildAndPublish(Object.fromEntries(UNITS.map((u) => [u, V1])));
  await promote([
    "--shell", v1.shell,
    ...APPS.flatMap((a) => ["--app", `${a}=${v1[a]}`]),
  ]);
  await awaitUnit("hello", v1.hello);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();

  let seen = await markersOnPage(page);
  check(
    "the frame and the sub-app both render the first marker",
    UNITS.every((u) => seen[u] === V1),
    JSON.stringify(seen),
  );

  heading("Change hello only. Publish must upload hello and nothing else");
  const helloV2 = await buildAndPublish({
    ...Object.fromEntries(UNITS.map((u) => [u, V1])),
    hello: V2,
  });
  check("publish uploaded only hello", uploadedUnits().join(",") === "hello", `uploaded: ${uploadedUnits().join(",") || "nothing"}`);
  check("hello's unit id moved", helloV2.hello !== v1.hello);
  check("the shell's unit id did not", helloV2.shell === v1.shell);

  heading("Deploy hello alone");
  await promote(["--app", `hello=${helloV2.hello}`]);
  const t1 = await awaitUnit("hello", helloV2.hello);
  console.log(`     visible in ${t1} ms`);

  seen = await markersOnPage(page);
  check("hello renders the new marker", seen.hello === V2, JSON.stringify(seen));
  check("the frame still renders the first marker", seen.shell === V1, JSON.stringify(seen));

  heading("Deploy the shell alone. The sub-app must not move with it");
  const shellV2 = await buildAndPublish({
    ...Object.fromEntries(UNITS.map((u) => [u, V1])),
    shell: V2,
    hello: V2,
  });
  check("publish uploaded only the shell", uploadedUnits().join(",") === "shell", `uploaded: ${uploadedUnits().join(",") || "nothing"}`);
  await promote(["--shell", shellV2.shell]);
  await awaitUnit("shell", shellV2.shell);

  seen = await markersOnPage(page);
  check("the frame is at the new marker", seen.shell === V2, JSON.stringify(seen));
  check("hello stayed where its own deploy left it", seen.hello === V2, JSON.stringify(seen));

  heading("Roll hello back, and only hello");
  await promote(["--app", `hello=${v1.hello}`]);
  await awaitUnit("hello", v1.hello);

  seen = await markersOnPage(page);
  check("hello is back at the first marker", seen.hello === V1, JSON.stringify(seen));
  // The claim a rollback is worth having for: what shipped in between stays
  // shipped. The shell was deployed after hello and is not dragged back with it.
  check("the frame stayed at the marker deployed after it", seen.shell === V2, JSON.stringify(seen));

  heading("The page is still one application");
  await page.goto(`${ADDRESS}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-app="hello"] section', { timeout: 30_000 });
  // Two bundles published at different times, sharing one signals runtime. The
  // greeting is a signal the SHELL's bundle created; the panel writes it and
  // re-renders from it. If hello carried its own Preact this line never changes.
  await page.fill('[data-app="hello"] input', "Berlin");
  await page.waitForFunction(
    () => document.querySelector("[data-greeting]")?.textContent?.trim() === "Hello, Berlin",
    undefined,
    { timeout: 10_000 },
  );
  check("what the panel writes, the panel reads back through the frame's store", true);

  // And the state is the FRAME's: unmounting the panel and mounting it again
  // finds the value still there, because the panel never held it.
  await page.click('a[href="/service"]');
  await page.waitForSelector("[data-service]", { timeout: 30_000 });
  await page.click('a[href="/"]');
  await page.waitForSelector('[data-app="hello"] section', { timeout: 30_000 });
  const afterRemount = await page.evaluate(
    () => document.querySelector("[data-greeting]")?.textContent?.trim() ?? "",
  );
  check(
    "the value survives the panel being unmounted, because the frame owns it",
    afterRemount === "Hello, Berlin",
    afterRemount,
  );

  heading("No machine was built, restarted or replaced");
  const machinesAfter = await machineFingerprint();
  check(
    "the machines are the instances that were already running",
    machinesBefore === machinesAfter,
    `${machinesBefore} -> ${machinesAfter}`,
  );
} catch (err) {
  failures.push(err instanceof Error ? err.message : String(err));
  console.log(`\n  FAIL ${err instanceof Error ? err.message : String(err)}`);
} finally {
  await browser?.close();
  server.proc?.kill();
}

console.log(
  failures.length === 0
    ? `\nSUCCESS: the sub-app deployed, the frame deployed, the sub-app rolled ` +
        `back, and each left the other where it was.`
    : `\nFAILURE: ${failures.length} check(s) failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
