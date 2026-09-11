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
// "list moved and the shell did not" is a fact about the application rather
// than a fact about a JSON file.
//
// It writes only the test-* channels, never the two the application is served
// from, and it starts from whatever those channels held: the first step
// composes them from scratch.
//
// It is restored at `PLAN.md` step 1 against `list`, from the version at commit
// ff196d5. Step 0 left it exiting non-zero, because a tree with one unit has no
// second unit to hold still and a green check measuring nothing is the failure
// `~/projects/CLAUDE.md` names.
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
import { VIEWS } from "../src/web/shell/views.ts";

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
 * run, publish would correctly skip them, and "publish uploaded only list"
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
 *
 * The routes are taken from the shell's own `VIEWS` rather than written here,
 * so a unit that moved route fails this rather than being read off the wrong
 * page. One entry today; steps 4 and 5 add `/board` and `/week`.
 */
async function markersOnPage(page: Page): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  for (const [path, view] of Object.entries(VIEWS)) {
    const apps = view.apps;
    if (apps.length === 0) continue;
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

/** The same poll, for a unit that must have LEFT the composition. */
async function awaitNoUnit(unit: Unit): Promise<number> {
  const started = Date.now();
  let seen: string | undefined = "unread";
  while (Date.now() - started < PROPAGATION_MS) {
    const r = await sh(["curl", "-sS", `${ADDRESS}/`]);
    const m = /id="__BUILD__">(.*?)<\/script>/s.exec(r.stdout);
    if (m?.[1]) {
      const info = JSON.parse(m[1]) as { units?: Record<string, { unitId: string }> };
      seen = info.units?.[unit]?.unitId;
      if (seen === undefined) return Date.now() - started;
    }
    await Bun.sleep(1000);
  }
  throw new Error(`${CHANNEL} still served ${unit}=${seen} after ${PROPAGATION_MS} ms; wanted nothing`);
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

  heading(`Compose the channel from scratch: every unit, every marker ${V1}`);
  const v1 = await buildAndPublish(Object.fromEntries(UNITS.map((u) => [u, V1])));
  await promote([
    "--shell", v1.shell,
    ...APPS.flatMap((a) => ["--app", `${a}=${v1[a]}`]),
  ]);
  await awaitUnit("list", v1.list);

  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage();

  let seen = await markersOnPage(page);
  check(
    "the frame and the sub-app both render the first marker",
    UNITS.every((u) => seen[u] === V1),
    JSON.stringify(seen),
  );

  heading("Change list only. Publish must upload list and nothing else");
  const listV2 = await buildAndPublish({
    ...Object.fromEntries(UNITS.map((u) => [u, V1])),
    list: V2,
  });
  check("publish uploaded only list", uploadedUnits().join(",") === "list", `uploaded: ${uploadedUnits().join(",") || "nothing"}`);
  check("list's unit id moved", listV2.list !== v1.list);
  check("the shell's unit id did not", listV2.shell === v1.shell);

  heading("Deploy list alone");
  await promote(["--app", `list=${listV2.list}`]);
  const t1 = await awaitUnit("list", listV2.list);
  console.log(`     visible in ${t1} ms`);

  seen = await markersOnPage(page);
  check("list renders the new marker", seen.list === V2, JSON.stringify(seen));
  check("the frame still renders the first marker", seen.shell === V1, JSON.stringify(seen));

  heading("Deploy the shell alone. The sub-app must not move with it");
  const shellV2 = await buildAndPublish({
    ...Object.fromEntries(UNITS.map((u) => [u, V1])),
    shell: V2,
    list: V2,
  });
  check("publish uploaded only the shell", uploadedUnits().join(",") === "shell", `uploaded: ${uploadedUnits().join(",") || "nothing"}`);
  await promote(["--shell", shellV2.shell]);
  await awaitUnit("shell", shellV2.shell);

  seen = await markersOnPage(page);
  check("the frame is at the new marker", seen.shell === V2, JSON.stringify(seen));
  check("list stayed where its own deploy left it", seen.list === V2, JSON.stringify(seen));

  heading("Roll list back, and only list");
  await promote(["--app", `list=${v1.list}`]);
  await awaitUnit("list", v1.list);

  seen = await markersOnPage(page);
  check("list is back at the first marker", seen.list === V1, JSON.stringify(seen));
  // The claim a rollback is worth having for: what shipped in between stays
  // shipped. The shell was deployed after list and is not dragged back with it.
  check("the frame stayed at the marker deployed after it", seen.shell === V2, JSON.stringify(seen));

  heading("The page is still one application");
  await page.goto(`${ADDRESS}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-app="list"] section', { timeout: 30_000 });
  // Two bundles published at different times, sharing one signals runtime. The
  // task list is a signal the SHELL's bundle created; the panel writes into it
  // and re-renders from it. If list carried its own Preact this row never
  // appears - it throws on first render instead, which the frame's boundary
  // catches, so the check below reads an error panel rather than a task.
  await page.fill('[data-app="list"] [data-new-task]', "Book the ferry");
  await page.click('[data-app="list"] [data-add-task]');
  await page.waitForSelector('[data-app="list"] [data-task="Book the ferry"]', { timeout: 10_000 });
  check("what the panel writes, the panel reads back through the frame's store", true);

  // And the state is the FRAME's: unmounting the panel and mounting it again
  // finds the task still there, because the panel never held it.
  await page.click('a[href="/board"]');
  await page.waitForFunction(() => location.pathname === "/board", undefined, { timeout: 10_000 });
  await page.click('a[href="/"]');
  await page.waitForSelector('[data-app="list"] section', { timeout: 30_000 });
  const afterRemount = await page.$$eval('[data-app="list"] [data-task]', (nodes) =>
    nodes.map((n) => n.getAttribute("data-task") ?? "").join(", "),
  );
  check(
    "the tasks survive the panel being unmounted, because the frame owns them",
    afterRemount === "Book the ferry",
    afterRemount,
  );

  // And `PLAN.md` step 2: the planner is in IndexedDB, so the task is still
  // there after a reload. This asserted the opposite until step 2 landed, which
  // is what the step 1 scenario was written for.
  //
  // The wait before the reload is not politeness. Writing is asynchronous and a
  // page reloaded inside the commit window loses the change - TODO §40 - so
  // what survives a reload is what was STORED, and the page says when that is
  // true.
  await page.waitForFunction(
    () => document.documentElement.dataset.plannerPending !== "yes",
    undefined,
    { timeout: 10_000 },
  );
  await page.reload({ waitUntil: "domcontentloaded" });
  await page.waitForSelector('[data-app="list"] section', { timeout: 30_000 });
  await page.waitForSelector('[data-app="list"] [data-memory-note]', { timeout: 30_000 });
  const afterReload = await page.$$eval('[data-app="list"] [data-task]', (nodes) =>
    nodes.map((n) => n.getAttribute("data-task") ?? "").join(", "),
  );
  check(
    "and they survive a reload, because the frame keeps them in IndexedDB",
    afterReload === "Book the ferry",
    afterReload === "" ? "nothing came back" : afterReload,
  );

  heading("Take the sub-app off the channel, and put it back");
  // The other half of "the unit of release is a panel": a panel can also leave,
  // and `--drop` is the only way one does. Every reading here was broken until
  // 2026-09-11 and nothing in the repository ran the command on a unit this
  // tree BUILDS - the only live use had been `--drop hello`, a unit `UNITS` no
  // longer held, which took a different branch through every loop.
  //
  //   `--drop list`              read a manifest for the unit it had just
  //                              excluded and died on an uncaught TypeError
  //   `--from-build --drop list` said "list is named by both --app and --drop"
  //                              on a command line where --app named nothing
  //   either of them             threw inside the history writer, so the region
  //                              was left with no version history written
  const dropped = await promote(["--from-build", "--drop", "list"]);
  check(
    "--from-build --drop takes the sub-app off, and does not call it doubly named",
    !dropped.stderr.includes("named by both"),
    dropped.stderr.slice(-400),
  );
  check(
    "and the terminal says what left and how to put it back",
    dropped.stderr.includes("no longer served by") && dropped.stderr.includes("--app list="),
    dropped.stderr.slice(-400),
  );
  await awaitNoUnit("list");

  await page.goto(`${ADDRESS}/`, { waitUntil: "domcontentloaded" });
  await page.waitForSelector("main", { timeout: 30_000 });
  check(
    "the frame is served with no panel on the landing route",
    (await page.$('[data-app="list"]')) === null,
    "the panel is still on the page",
  );

  // Naming a unit the channel no longer serves is a refusal and not a crash.
  const again = await sh(["bun", "run", "--silent", "scripts/promote.ts", CHANNEL, "--drop", "list"]);
  check(
    "dropping it a second time is refused by name",
    again.code !== 0 && again.stderr.includes(`which ${CHANNEL} does not serve`),
    `exit ${again.code}: ${again.stderr.slice(-300)}`,
  );

  await promote(["--app", `list=${v1.list}`]);
  await awaitUnit("list", v1.list);
  check("and naming an id puts it back", true);

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
        `back, the sub-app left the channel and came back, and each left the other where it was.`
    : `\nFAILURE: ${failures.length} check(s) failed:\n${failures.map((f) => `  - ${f}`).join("\n")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
