// Measures what preloading a sub-app's files actually buys, and what it costs.
//
//   bun run measure:preload
//
// TODO §17 listed four things to check and none of them to assume. This is the
// check. It runs the documented server entry point here against the REAL store,
// the way a @test-channel scenario does, loads the page in a real Chrome, and
// reads the network. Then it does the same with the preload tags removed, so
// every number has a control beside it.
//
// It writes nothing. The channel it reads is `test-qa`, which the live suite
// owns, so run `bun run verify:browser` first if it holds nothing recent.
//
// Why a script and not only a scenario: the interesting readings are BEFORE and
// AFTER a navigation, on two variants of the server. A scenario can assert one
// of those; only a control says whether the assertion discriminates.

import { chromium, type Page } from "playwright-core";

const HTML = "src/server/html.ts";
const DROP_FIND = "</script>${preloadLinks(m)}";
const DROP_REPLACE = "</script>";

const MANIFEST_BASE =
  Bun.env.MANIFEST_BASE ?? "https://pointer-deploy-assets.fly.storage.tigris.dev/manifests";
const CHANNEL = "test-qa";
/** The view the probe does not open. Its files are what preloading is for. */
const OFFSCREEN = ["charlie", "delta"];

type Counts = Record<string, { js: number; css: number }>;

type Reading = {
  variant: string;
  tags: { modulepreload: number; style: number };
  before: Counts;
  after: Counts;
  refusals: string[];
  warnings: string[];
};

const fileOf = (u: string) => new URL(u).pathname.split("/").pop() ?? "";

const countsIn = (urls: string[]): Counts =>
  Object.fromEntries(
    OFFSCREEN.map((app) => {
      const mine = urls.filter((u) => fileOf(u).startsWith(`${app}-`));
      return [app, { js: mine.filter((u) => u.endsWith(".js")).length, css: mine.filter((u) => u.endsWith(".css")).length }];
    }),
  );

async function startServer(): Promise<{ port: number; kill: () => void }> {
  const proc = Bun.spawn(["bun", "src/server/index.ts"], {
    env: {
      ...process.env,
      // Development, so the *.localhost name resolves to a channel.
      NODE_ENV: "development",
      PORT: "0",
      MANIFEST_BASE,
      MANIFEST_TTL_MS: "1000",
      MANIFEST_TIMEOUT_MS: "10000",
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  const reader = proc.stdout.getReader();
  let buffered = "";
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += new TextDecoder().decode(value);
    const m = /listening on http:\/\/[^:]+:(\d+)/.exec(buffered);
    if (m) {
      reader.releaseLock();
      return { port: Number(m[1]), kill: () => proc.kill() };
    }
  }
  proc.kill();
  throw new Error(`the server did not start. Output so far:\n${buffered}`);
}

/** Waits for both panels of a view, generously: a cold Tigris edge is slow. */
async function openView(page: Page, apps: string[]): Promise<void> {
  for (const app of apps) {
    await page.waitForSelector(`[data-app="${app}"] section`, { timeout: 30_000 });
  }
}

async function measure(variant: string): Promise<Reading> {
  const { port, kill } = await startServer();
  const origin = `http://${CHANNEL}.localhost:${port}`;
  const html = await (await fetch(`${origin}/`)).text();
  const browser = await chromium.launch({ channel: "chrome", headless: true });
  try {
    const page = await browser.newPage();
    const requests: string[] = [];
    const warnings: string[] = [];
    page.on("request", (r) => requests.push(r.url()));
    page.on("console", (m) => {
      if (m.type() === "warning") warnings.push(m.text());
    });
    await page.addInitScript(() => {
      const seen: string[] = [];
      (globalThis as unknown as { __refusals: string[] }).__refusals = seen;
      document.addEventListener("securitypolicyviolation", (e) => {
        seen.push(`${e.violatedDirective} ${e.blockedURI}`);
      });
    });

    await page.goto(`${origin}/`);
    await openView(page, ["alpha", "bravo"]);
    // A preload is issued at parse time and finishes on its own schedule. This
    // waits for the network to settle rather than for a fixed number.
    await page.waitForLoadState("networkidle");
    const before = countsIn(requests);

    await page.click('a[href="/totals"]');
    await openView(page, OFFSCREEN);
    await page.waitForLoadState("networkidle");
    const after = countsIn(requests);

    const refusals = await page.evaluate(
      () => (globalThis as unknown as { __refusals?: string[] }).__refusals ?? [],
    );
    return {
      variant,
      tags: {
        modulepreload: (html.match(/rel="modulepreload"/g) ?? []).length,
        style: (html.match(/rel="preload" as="style"/g) ?? []).length,
      },
      before,
      after,
      refusals,
      warnings,
    };
  } finally {
    await browser.close();
    kill();
  }
}

const original = await Bun.file(HTML).text();
if (!original.includes(DROP_FIND)) {
  console.error(`${HTML} no longer emits preloadLinks where this script expects. Update it.`);
  process.exit(1);
}

const readings: Reading[] = [];
try {
  readings.push(await measure("as it stands"));
  await Bun.write(HTML, original.replace(DROP_FIND, DROP_REPLACE));
  readings.push(await measure("with the preload tags removed"));
} finally {
  await Bun.write(HTML, original);
}

for (const r of readings) {
  console.log(`\n--- ${r.variant}`);
  console.log(`  tags emitted           modulepreload=${r.tags.modulepreload} style=${r.tags.style}`);
  for (const app of OFFSCREEN) {
    console.log(
      `  ${app.padEnd(22)} before nav js=${r.before[app]!.js} css=${r.before[app]!.css}` +
        `  after nav js=${r.after[app]!.js} css=${r.after[app]!.css}`,
    );
  }
  console.log(`  policy refusals        ${r.refusals.length ? r.refusals.join(" | ") : "none"}`);
  console.log(`  console warnings       ${r.warnings.length}`);
}

const [warm, cold] = readings as [Reading, Reading];
const problems: string[] = [];

// 1. The policy. A modulepreload is checked against script-src and a style
//    preload against style-src, and both are derived from the same origins.
if (warm.refusals.length) problems.push(`the policy refused a preload: ${warm.refusals.join(", ")}`);

for (const app of OFFSCREEN) {
  // 2. Warmed before the visitor asks. This is the whole point, and it is the
  //    one reading the control moves: without the tags it is zero.
  if (warm.before[app]!.js !== 1) problems.push(`${app}: ${warm.before[app]!.js} script requests before the navigation, wanted 1`);
  if (warm.before[app]!.css !== 1) problems.push(`${app}: ${warm.before[app]!.css} stylesheet requests before the navigation, wanted 1`);
  // 3. And not fetched a second time by the import. A preload the import
  //    cannot reuse costs the bandwidth twice and buys nothing.
  if (warm.after[app]!.js !== 1) problems.push(`${app}: ${warm.after[app]!.js} script requests after the navigation, wanted 1 - the import did not reuse the preload`);
  if (warm.after[app]!.css !== 1) problems.push(`${app}: ${warm.after[app]!.css} stylesheet requests after the navigation, wanted 1`);
  // 4. The control. If this is not zero, the reading above is not about
  //    preloading and this whole script proves nothing.
  if (cold.before[app]!.js !== 0) problems.push(`control: ${app} was fetched ${cold.before[app]!.js} times with no preload tags, so the reading above discriminates nothing`);
}

console.log("");
if (problems.length) {
  for (const p of problems) console.log(`FAIL: ${p}`);
  process.exit(1);
}
console.log(
  "SUCCESS: every off-screen bundle and stylesheet is fetched once, before the\n" +
    "navigation and not again by the import; with the tags removed it is fetched\n" +
    "zero times before the navigation. No policy refusal.",
);
