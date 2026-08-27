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
// "alpha moved and bravo did not" is a fact about the application rather than
// a fact about a JSON file.
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
 * run, publish would correctly skip them, and "publish uploaded only alpha"
 * would fail on every run after the first - reporting a defect in the run
 * rather than in the code. Five more immutable units per run is the price;
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
  for (const [path, apps] of [
    ["/", ["alpha", "bravo"]],
    ["/totals", ["charlie", "delta"]],
  ] as const) {
    const url = `${ADDRESS}${path}`;
    await page.goto(url, { waitUntil: "domcontentloaded" });
    for (const app of apps) {
      const el = await page.waitForSelector(`[data-app="${app}"] section`, { timeout: 30_000 });
      out[app] = (await el.getAttribute("data-unit-marker")) ?? "";
    }
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

  heading(`Compose the channel from scratch: five units, every marker ${V1}`);
  const v1 = await buildAndPublish(Object.fromEntries(UNITS.map((u) => [u, V1])));
  await promote([
    "--shell", v1.shell,
    ...APPS.flatMap((a) => ["--app", `${a}=${v1[a]}`]),
  ]);
  await awaitUnit("alpha", v1.alpha);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();

  let seen = await markersOnPage(page);
  check(
    "every sub-app renders the first marker",
    APPS.every((a) => seen[a] === V1),
    JSON.stringify(seen),
  );

  heading("Change alpha only. Publish must upload alpha and nothing else");
  const alphaV2 = await buildAndPublish({
    ...Object.fromEntries(UNITS.map((u) => [u, V1])),
    alpha: V2,
  });
  check("publish uploaded only alpha", uploadedUnits().join(",") === "alpha", `uploaded: ${uploadedUnits().join(",") || "nothing"}`);
  check("alpha's unit id moved", alphaV2.alpha !== v1.alpha);
  check(
    "the other four unit ids did not",
    UNITS.filter((u) => u !== "alpha").every((u) => alphaV2[u] === v1[u]),
  );

  heading("Deploy alpha alone");
  await promote(["--app", `alpha=${alphaV2.alpha}`]);
  const t1 = await awaitUnit("alpha", alphaV2.alpha);
  console.log(`     visible in ${t1} ms`);

  seen = await markersOnPage(page);
  check("alpha renders the new marker", seen.alpha === V2, JSON.stringify(seen));
  check(
    "bravo, charlie and delta still render the first marker",
    ["bravo", "charlie", "delta"].every((a) => seen[a] === V1),
    JSON.stringify(seen),
  );

  heading("Change bravo only, and deploy bravo alone");
  const bravoV2 = await buildAndPublish({
    ...Object.fromEntries(UNITS.map((u) => [u, V1])),
    alpha: V2,
    bravo: V2,
  });
  check("publish uploaded only bravo", uploadedUnits().join(",") === "bravo", `uploaded: ${uploadedUnits().join(",") || "nothing"}`);
  await promote(["--app", `bravo=${bravoV2.bravo}`]);
  await awaitUnit("bravo", bravoV2.bravo);

  seen = await markersOnPage(page);
  check("bravo renders the new marker", seen.bravo === V2, JSON.stringify(seen));
  check("alpha is still at the new marker, not dragged back", seen.alpha === V2, JSON.stringify(seen));
  check(
    "charlie and delta still render the first marker",
    ["charlie", "delta"].every((a) => seen[a] === V1),
    JSON.stringify(seen),
  );

  heading("Roll alpha back, and only alpha");
  await promote(["--app", `alpha=${v1.alpha}`]);
  await awaitUnit("alpha", v1.alpha);

  seen = await markersOnPage(page);
  check("alpha is back at the first marker", seen.alpha === V1, JSON.stringify(seen));
  check("bravo stayed at its new marker through alpha's rollback", seen.bravo === V2, JSON.stringify(seen));

  heading("Deploy the shell alone. The sub-apps must not move with it");
  const shellV2 = await buildAndPublish({
    ...Object.fromEntries(UNITS.map((u) => [u, V1])),
    shell: V2,
    bravo: V2,
  });
  check("publish uploaded only the shell", uploadedUnits().join(",") === "shell", `uploaded: ${uploadedUnits().join(",") || "nothing"}`);
  await promote(["--shell", shellV2.shell]);
  await awaitUnit("shell", shellV2.shell);

  const frameMarker = await page.evaluate(() =>
    document.querySelector("[data-unit-marker]")?.getAttribute("data-unit-marker") ?? "",
  );
  await page.goto(`${ADDRESS}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-app="alpha"] section', { timeout: 30_000 });
  check(
    "the frame is at the new marker",
    (await page.evaluate(() =>
      document.querySelector("div[data-unit-marker]")?.getAttribute("data-unit-marker") ?? "",
    )) === V2,
    `frame was ${frameMarker}`,
  );
  seen = await markersOnPage(page);
  check("alpha stayed where the rollback left it", seen.alpha === V1, JSON.stringify(seen));
  check("bravo stayed at its new marker", seen.bravo === V2, JSON.stringify(seen));

  heading("The page is still one application");
  await page.goto(`${ADDRESS}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-app="alpha"] section', { timeout: 30_000 });
  // Five bundles published at three different times, sharing one signals
  // runtime. If any of them carried its own Preact this stays at 0.
  await page.click('[data-app="alpha"] button');
  await page.click('[data-app="alpha"] button');
  await page.click('[data-app="bravo"] button');
  await page.click('a[href="/totals"]');
  await page.waitForSelector('[data-app="charlie"] section', { timeout: 30_000 });
  const totals = await page.evaluate(() => {
    const rows = document.querySelectorAll('[data-app="charlie"] tbody tr');
    return Object.fromEntries(
      [...rows].map((r) => [
        r.querySelector("td")?.textContent?.trim() ?? "",
        r.querySelectorAll("td")[1]?.textContent?.trim() ?? "",
      ]),
    );
  });
  check(
    "a counter raised in a rolled-back alpha is read by charlie",
    totals.alpha === "2",
    JSON.stringify(totals),
  );
  check("and one raised in a freshly deployed bravo is too", totals.bravo === "1", JSON.stringify(totals));

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
    ? `\nSUCCESS: one app deployed, another deployed, the first rolled back, ` +
        `and each left the others where they were.`
    : `\nFAILURE: ${failures.length} check(s) failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
