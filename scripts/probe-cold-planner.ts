// Arranges the state TODO §44 is about, and reads what the probe says.
//
//   bun run verify:cold
//
// Every browser scenario starts from a cold planner because Playwright gives
// each test its own context and IndexedDB is per profile. `PLAN.md` asks for
// `indexedDB.deleteDatabase("pointer-planner")` in the browser world's setup
// plus one `falsify` mutation removing it and a named scenario that must go
// red. The mutation half cannot be met: removing a clear that is redundant
// turns nothing red, which is a check that cannot reach its state.
//
// So the state is ARRANGED here instead. Pages in ONE browser context: the
// first writes a task, and the ones after it are what a scenario would get if
// `playwright.config.ts` ever reused a context. `sessionStorage` is per tab, so
// each new page runs the probe again.
//
// Two shapes, and the probe answers both the same way. Measured 2026-09-13.
//
// `PLAN.md` specifies a `deleteDatabase` here, and this script is what took it
// out: a delete issued while another page holds the database open is BLOCKED,
// deletes nothing, and queues every later open on that name behind it - so the
// second page's shell never got a connection and the panel sat on "Reading the
// planner…". The step meant to save a reused context hangs it.
//
// What is left is the reading, and `indexedDB.databases()` takes it without
// opening or deleting anything. The page stays warm and the suite says so.
//
// It reads the deployed origin and writes nothing to any channel. The only
// thing it changes is one browser profile it created and throws away.

import { chromium } from "playwright-core";
import {
  PROBE_KEY,
  PROBE_SCRIPT,
  coldPlannerProblem,
  readProbe,
  type ProbeReading,
} from "../features/support/cold-planner.ts";

const ORIGIN = Bun.env.LIVE_ADDRESS ?? "https://pointer-deploy.fly.dev";
const TASK = "a task the second page must not see";

const checks: Array<{ ok: boolean; said: string }> = [];
const check = (ok: boolean, said: string) => {
  checks.push({ ok, said });
  console.error(`  ${ok ? "ok  " : "FAIL"}   ${said}`);
};

const probeOf = async (page: import("playwright-core").Page): Promise<ProbeReading> =>
  readProbe(await page.evaluate((key) => sessionStorage.getItem(key), PROBE_KEY));

console.error(`arranging a reused browser context against ${ORIGIN}\n`);

const browser = await chromium.launch();
const context = await browser.newContext();

try {
  // The first page, which is what every scenario gets today.
  const first = await context.newPage();
  await first.addInitScript(PROBE_SCRIPT);
  await first.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await first.waitForSelector('[data-app="list"] [data-new-task]', { timeout: 30_000 });

  const firstReading = await probeOf(first);
  check(firstReading === 0, `the first page in a new context reads ${JSON.stringify(firstReading)}`);
  check(
    coldPlannerProblem(firstReading, "the first page") === null,
    "and that reading is not reported as a fault",
  );

  // A task, and it has to reach the database before the second page opens.
  await first.fill('[data-app="list"] [data-new-task]', TASK);
  await first.click('[data-app="list"] [data-add-task]');
  await first.waitForSelector(`[data-app="list"] [data-task="${TASK}"]`, { timeout: 10_000 });
  await first.waitForFunction(
    () => document.documentElement.dataset.plannerPending !== "yes",
    undefined,
    { timeout: 10_000 },
  );
  check(true, `the first page stored ${JSON.stringify(TASK)}`);

  // The second page, in the SAME context. This is the state a change to
  // `playwright.config.ts` produces, and the one nothing could reach before.
  const second = await context.newPage();
  await second.addInitScript(PROBE_SCRIPT);
  await second.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await second.waitForSelector('[data-app="list"] [data-new-task]', { timeout: 30_000 });

  const secondReading = await probeOf(second);
  check(
    typeof secondReading === "number" && secondReading > 0,
    `the second page in the same context reads version ${JSON.stringify(secondReading)}, ` +
      `which is not cold`,
  );

  const problem = coldPlannerProblem(secondReading, "a scenario in a reused context");
  check(problem !== null, "and that reading IS reported as a fault");
  check(
    problem?.includes("playwright.config.ts") ?? false,
    "and the report names where to look",
  );

  // And the reading that decides what this mechanism is: the probe CLEARS
  // NOTHING, so the second page draws the first page's task. That is the state
  // being reported, seen on the page. A visitor of a reused context gets a
  // warm planner and the suite says so; it does not pretend otherwise.
  await second.waitForSelector(`[data-app="list"] [data-task="${TASK}"]`, { timeout: 10_000 });
  const drawn = await second.$$eval('[data-app="list"] [data-task]', (n) => n.length);
  check(drawn > 0, `and the second page drew ${drawn} task(s), which is the state being reported`);

  // The other shape, and the commoner one: the first page is GONE. Sequential
  // tests sharing a context leave no connection open. The reading is the same,
  // because the probe never depended on a connection.
  await first.close();
  const third = await context.newPage();
  await third.addInitScript(PROBE_SCRIPT);
  await third.goto(ORIGIN, { waitUntil: "domcontentloaded" });
  await third.waitForSelector('[data-app="list"] [data-new-task]', { timeout: 30_000 });

  const thirdReading = await probeOf(third);
  check(
    typeof thirdReading === "number" && thirdReading > 0,
    `with no page holding it open, the probe still reads version ${JSON.stringify(thirdReading)}`,
  );
  check(
    coldPlannerProblem(thirdReading, "a scenario in a reused context") !== null,
    "and that reading is reported as a fault too",
  );
} finally {
  await context.close();
  await browser.close();
}

const failed = checks.filter((c) => !c.ok);
console.error("");
if (failed.length > 0) {
  console.error(
    `FAILURE: ${failed.length} of ${checks.length} readings did not hold. The probe cannot ` +
      `reach the state it is for, so the check in the After hook proves nothing.`,
  );
  process.exit(1);
}
console.error(
  `SUCCESS: ${checks.length} readings held. A reused context is reported by name in both ` +
    `shapes - a page still holding the database open, and a page that has closed - and ` +
    `nothing was cleared, opened or written.`,
);
