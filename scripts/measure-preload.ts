// Measures what warming an off-screen unit's files buys, WITH A CONTROL.
//
//   bun run scripts/measure-preload.ts
//   bun run scripts/measure-preload.ts --runs 5
//
// `PLAN.md` step 4 put `board` on `/board`, which is the first unit this
// repository has placed on a route a visitor does not land on. That is what
// this script needs: warming a file the landing page is about to import anyway
// buys nothing, and nothing is what every reading said while `list` was the
// only unit.
//
// THE CONTROL IS THE POINT. A scenario was written for this on the previous
// slate, measured, and deleted: "opening a view costs no further request for
// its bundles" was green with the tags and green without them, because with no
// warm the import does the one fetch itself. A reading that does not move when
// the mechanism is removed measures nothing. So every reading here is taken
// twice - once from the page as served, and once from the same page with the
// warm tags stripped out of the HTML on the way to the browser - and what is
// reported is the DIFFERENCE.
//
// Stripping the tags in a route handler rather than mutating the server is
// deliberate: both arms then run against one origin, one store, one pointer and
// one build, so nothing but the tags differs between them.
//
// It writes to `test-qa` and NEVER to a real channel, and it leaves the channel
// where it put it - that is what a test channel is for. `dist/` is left holding
// the build this ran.

import { chromium, type Browser, type Page, type Route } from "playwright-core";
import { APPS, UNITS, type Unit } from "./contract.ts";

const CHANNEL = "test-qa";
/** The unit the landing route does not place. The whole subject. */
const OFF_SCREEN = "board";
const VIEW = "/board";
/**
 * How many times each arm is taken. Odd, so the median is a reading that was
 * actually taken rather than the mean of two that were not.
 *
 * Read with the flag's index checked. `indexOf` returns -1 when nobody passed
 * it, and `argv[-1 + 1]` is the path to bun - which `Number` turns into NaN and
 * every loop below then skips, reporting nothing and failing on an empty array.
 */
const runsFlag = process.argv.indexOf("--runs");
const RUNS = runsFlag === -1 ? 3 : Number(process.argv[runsFlag + 1]);
if (!Number.isInteger(RUNS) || RUNS < 1) {
  console.error(`--runs needs a whole number of runs, and was given ${JSON.stringify(process.argv[runsFlag + 1])}`);
  process.exit(1);
}

/**
 * How long the landing view is READ before the click, in ms.
 *
 * Zero is the hottest moment for the warm and the weakest claim: Chrome's
 * preload cache holds a warmed response for a short while and then the file is
 * an ordinary disk-cache entry, so a click taken the instant the page settles
 * measures the best case the script itself constructed. A cold read on
 * 2026-09-12 named that, and this is the answer - the same reading, taken again
 * after a pause a visitor would take.
 */
const pauseFlag = process.argv.indexOf("--pause");
const PAUSE_MS = pauseFlag === -1 ? 0 : Number(process.argv[pauseFlag + 1]);
if (!Number.isInteger(PAUSE_MS) || PAUSE_MS < 0) {
  console.error(`--pause needs a whole number of milliseconds, and was given ${JSON.stringify(process.argv[pauseFlag + 1])}`);
  process.exit(1);
}

type Ids = Record<Unit, string>;

const failures: string[] = [];
const check = (claim: string, pass: boolean, saw: string): boolean => {
  console.log(pass ? `  ok   ${claim}` : `  FAIL ${claim} - saw ${saw}`);
  if (!pass) failures.push(claim);
  return pass;
};

async function run(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; out: string; said: string }> {
  const proc = Bun.spawn(args, {
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, said: `${out}${err}` };
}

/** Builds, publishes and points `test-qa` at what came out. */
async function publishAndPoint(): Promise<Ids> {
  const marker = `preload-${Date.now().toString(36)}`;
  const built = await run(["bun", "run", "build"], { BUILD_MARKER: marker });
  if (built.code !== 0) throw new Error(`build failed:\n${built.said}`);

  const published = await run(["bun", "run", "--silent", "scripts/publish.ts"]);
  if (published.code !== 0) throw new Error(`publish failed:\n${published.said}`);
  const ids = JSON.parse(published.out) as Ids;

  const promoted = await run([
    "bun", "run", "--silent", "scripts/promote.ts", CHANNEL,
    "--shell", ids.shell,
    ...APPS.flatMap((a) => ["--app", `${a}=${ids[a]}`]),
  ]);
  if (promoted.code !== 0) throw new Error(`promote failed:\n${promoted.said}`);
  return ids;
}

/**
 * The server this repository ships, against the REAL store.
 *
 * The same arrangement `@browser @test-channel` scenarios run on, and for the
 * same reason: the bundles have to come over a real network from the real
 * bucket, or the thing being measured - the latency a warm removes - is not in
 * the reading at all.
 */
async function startServer(): Promise<{ origin: string; stop: () => void }> {
  const port = 3100 + Math.floor(Math.random() * 800);
  const proc = Bun.spawn(["bun", "src/server/index.ts"], {
    env: {
      ...process.env,
      PORT: String(port),
      MANIFEST_BASE:
        Bun.env.MANIFEST_BASE ??
        "https://pointer-deploy-assets.fly.storage.tigris.dev/manifests",
      MANIFEST_TTL_MS: "1000",
      MANIFEST_TIMEOUT_MS: "10000",
    },
    stdout: "ignore",
    stderr: "ignore",
  });

  const origin = `http://${CHANNEL}.localhost:${port}`;
  for (let i = 0; i < 100; i += 1) {
    try {
      const res = await fetch(`${origin}/healthz`);
      if (res.ok) return { origin, stop: () => proc.kill() };
    } catch {
      // not up yet
    }
    await Bun.sleep(100);
  }
  proc.kill();
  throw new Error(`the server did not answer on ${origin}`);
}

const WARM_TAG = /\n\s*<link rel="(?:modulepreload|preload)"[^>]*>/g;

/** Serves the page as it is, or with every warm tag cut out of it. */
async function serveDocument(route: Route, warm: boolean): Promise<void> {
  if (warm) return route.continue();
  const response = await route.fetch();
  const body = await response.text();
  await route.fulfill({
    response,
    body: body.replace(WARM_TAG, ""),
    headers: { ...response.headers(), "content-length": undefined as unknown as string },
  });
}

type Reading = {
  /** Resource timings for the off-screen unit, after the landing page settles. */
  warmedBeforeOpening: number;
  /** How long from the click to the panel being on screen, in ms. */
  openedInMs: number;
  /** Timing entries for the unit's files across the whole visit. */
  fetchedTimes: number;
  /** What started each of those fetches. */
  startedBy: string[];
  /** Content-Security-Policy refusals the page reported. */
  refusals: string[];
  /**
   * How long each of the unit's files took, and when it started, off the
   * browser's own timings.
   *
   * Here because the headline number is not all preload. `loader.ts` awaits the
   * STYLESHEET and only then imports the module, so the control arm pays two
   * cross-origin round trips in SERIES and the warm arm pays none. A cold read
   * on 2026-09-12 said the 780 ms was therefore "what the tags buy given a
   * serial loader", which is true - so the two durations are reported, and the
   * serial part of the baseline can be read rather than argued about.
   */
  files: Array<{ file: string; initiator: string; startedAt: number; tookMs: number }>;
};

async function readOnce(browser: Browser, origin: string, warm: boolean): Promise<Reading> {
  const context = await browser.newContext();
  const page: Page = await context.newPage();
  await page.addInitScript(() => {
    const seen: string[] = [];
    (globalThis as unknown as { __refusals: string[] }).__refusals = seen;
    document.addEventListener("securitypolicyviolation", (e) => {
      seen.push(`${e.violatedDirective} ${e.blockedURI}`);
    });
  });
  await page.route(`${origin}/`, (route) => void serveDocument(route, warm));
  await page.route(`${origin}${VIEW}`, (route) => void serveDocument(route, warm));

  try {
    await page.goto(`${origin}/`);
    // The landing view finished: its own panel is mounted and the frame has
    // settled. Everything after this is the navigation being measured.
    await page.waitForSelector('[data-app="list"] section', { timeout: 30_000 });
    await page.waitForLoadState("networkidle");

    const warmedBeforeOpening = await page.evaluate(
      (unit) =>
        performance.getEntriesByType("resource").filter((e) => e.name.includes(`/units/${unit}/`))
          .length,
      OFF_SCREEN,
    );

    // The pause a visitor takes before clicking. Zero measures the moment the
    // preload cache is hottest; anything larger measures what is left of the
    // warm once that cache has let the files go to ordinary HTTP cache.
    if (PAUSE_MS > 0) await page.waitForTimeout(PAUSE_MS);

    const startedAt = Date.now();
    await page.click(`a[href="${VIEW}"]`);
    await page.waitForSelector(`[data-app="${OFF_SCREEN}"] section`, { timeout: 30_000 });
    const openedInMs = Date.now() - startedAt;

    const files = await page.evaluate(
      (unit) =>
        performance
          .getEntriesByType("resource")
          .filter((e) => e.name.includes(`/units/${unit}/`))
          .map((e) => {
            const r = e as PerformanceResourceTiming;
            return {
              file: r.name.split("/").pop() ?? r.name,
              initiator: r.initiatorType,
              startedAt: Math.round(r.startTime),
              tookMs: Math.round(r.duration),
            };
          }),
      OFF_SCREEN,
    );
    const timings = files.map((f) => f.initiator);
    const refusals = await page.evaluate(
      () => (globalThis as unknown as { __refusals?: string[] }).__refusals ?? [],
    );

    return {
      warmedBeforeOpening,
      openedInMs,
      fetchedTimes: timings.length,
      startedBy: timings,
      refusals,
      files,
    };
  } finally {
    await context.close();
  }
}

const median = (numbers: number[]): number => {
  const sorted = [...numbers].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)]!;
};

console.log(
  `measuring the warm on ${OFF_SCREEN}, ${RUNS} runs per arm` +
    (PAUSE_MS > 0 ? `, ${PAUSE_MS} ms on the landing view before the click` : "") +
    "\n",
);

const ids = await publishAndPoint();
console.log(`${CHANNEL} serves ${UNITS.map((u) => `${u} ${ids[u]}`).join(" ")}\n`);

const server = await startServer();
let browser: Browser | null = null;
try {
  browser = await chromium.launch({ channel: "chrome", headless: true });

  const arms: Record<string, Reading[]> = { warm: [], control: [] };
  for (let i = 0; i < RUNS; i += 1) {
    // Alternating, so a store that gets slower or faster during the run moves
    // both arms rather than the one that happened to go second.
    arms.warm!.push(await readOnce(browser, server.origin, true));
    arms.control!.push(await readOnce(browser, server.origin, false));
  }

  const warm = arms.warm!;
  const control = arms.control!;
  const warmOpen = median(warm.map((r) => r.openedInMs));
  const controlOpen = median(control.map((r) => r.openedInMs));

  console.log("\nreadings");
  console.log(`  files held before the view was opened   warm ${warm[0]!.warmedBeforeOpening}   control ${control[0]!.warmedBeforeOpening}`);
  console.log(`  files fetched across the visit          warm ${warm[0]!.fetchedTimes}   control ${control[0]!.fetchedTimes}`);
  console.log(`  what started them                       warm ${warm[0]!.startedBy.join(", ")}   control ${control[0]!.startedBy.join(", ")}`);
  console.log(`  click to panel on screen, median ms     warm ${warmOpen}   control ${controlOpen}`);
  console.log(`  every run, warm ms                      ${warm.map((r) => r.openedInMs).join(", ")}`);
  console.log(`  every run, control ms                   ${control.map((r) => r.openedInMs).join(", ")}`);
  console.log(`  warm spread, ms                         ${Math.min(...warm.map((r) => r.openedInMs))} to ${Math.max(...warm.map((r) => r.openedInMs))}`);
  console.log(`  control spread, ms                      ${Math.min(...control.map((r) => r.openedInMs))} to ${Math.max(...control.map((r) => r.openedInMs))}`);
  console.log(`  policy refusals                         warm ${warm.flatMap((r) => r.refusals).length}   control ${control.flatMap((r) => r.refusals).length}`);

  // Where the control arm's time goes, so the headline number can be read
  // rather than taken. `loader.ts` awaits the stylesheet before it imports the
  // module, so these two are in SERIES in the control arm and the sum is the
  // floor a parallel loader would cut into.
  console.log("\n  the control arm's two fetches, per run");
  for (const [i, r] of control.entries()) {
    const said = r.files
      .map((f) => `${f.file} ${f.initiator} started ${f.startedAt} took ${f.tookMs}`)
      .join(" | ");
    console.log(`    run ${i + 1}  ${said}`);
  }
  const serial = control.map((r) => r.files.reduce((n, f) => n + f.tookMs, 0));
  console.log(`    the two fetches add up to, per run, ms   ${serial.join(", ")}`);
  console.log(
    `\n  loader.ts fetches the stylesheet and THEN the module, so the two above are\n` +
      `  in series. A parallel loader would cut the control arm towards the longer of\n` +
      `  the two rather than their sum, with no warm tag anywhere. That is not\n` +
      `  measured here and it is not an argument against the warm - it is what the\n` +
      `  780 ms is measured AGAINST. TODO carries it.\n`,
  );

  check(
    "the warm puts the unit's two files in the browser before the view is opened",
    warm.every((r) => r.warmedBeforeOpening === 2),
    `${warm.map((r) => r.warmedBeforeOpening).join(", ")}`,
  );
  check(
    "with no warm, nothing of that unit is in the browser until the view is opened",
    control.every((r) => r.warmedBeforeOpening === 0),
    `${control.map((r) => r.warmedBeforeOpening).join(", ")}`,
  );
  check(
    "each file is fetched once across the visit, warm or not",
    [...warm, ...control].every((r) => r.fetchedTimes === 2),
    `${[...warm, ...control].map((r) => r.fetchedTimes).join(", ")}`,
  );
  check(
    "with no warm the import is what starts the fetch",
    control.every((r) => r.startedBy.includes("script")),
    `${control.map((r) => r.startedBy.join("+")).join(", ")}`,
  );
  check(
    "warming needs no change to the content policy",
    warm.every((r) => r.refusals.length === 0),
    `${warm.flatMap((r) => r.refusals).join(", ") || "none"}`,
  );
  // The reading this whole script exists for, and it is reported whichever way
  // it comes out. A warm that buys nothing measurable is a finding about the
  // mechanism, not a failure of the script - so this is a number and a
  // sentence, never a check that turns the exit code red.
  console.log(
    `  the warm opened the view ${controlOpen - warmOpen} ms sooner ` +
      `(${controlOpen} ms without it, ${warmOpen} ms with it), median of ${RUNS}` +
      (PAUSE_MS > 0 ? `, after ${PAUSE_MS} ms on the landing view` : ", clicked as soon as the landing view settled") +
      ".",
  );
} finally {
  await browser?.close();
  server.stop();
}

if (failures.length) {
  console.log(`\nFAILURE: ${failures.length} reading(s) did not hold`);
  process.exit(1);
}
console.log("\nSUCCESS: every reading held");
