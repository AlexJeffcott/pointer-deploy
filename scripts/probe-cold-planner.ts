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

// `e2e` and `e2e:members` refuse when the tree builds no sub-app, and this one
// needs the same: it drives `list`'s controls on the deployed origin, so a
// composition without that panel leaves it waiting on a selector for 30 s and
// then failing for a reason that is not about the planner.
const served = await fetch(ORIGIN).then((r) => r.text());
if (!served.includes('"list"')) {
  console.error(
    `${ORIGIN} serves no \`list\` panel, and this script types a task into it. There is ` +
      `nothing here to arrange a warm planner with. Promote a composition that places ` +
      `\`list\` on the landing route, or point LIVE_ADDRESS at one that does.`,
  );
  process.exit(1);
}

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
  // Read back, not asserted true. `check(true, ...)` stood here until a cold
  // read on 2026-09-13 counted it among the nine readings this script reports.
  const storedFirst = await first.$$eval('[data-app="list"] [data-task]', (n) => n.length);
  check(storedFirst === 1, `the first page drew ${storedFirst} task after storing one`);

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

  // THE REFUTATION, re-run rather than quoted. `PLAN.md` specified a
  // `deleteDatabase` in the browser world's setup. Issued from this page while
  // the first page still holds the database open, it must fire `blocked` and
  // delete nothing - which is why it is not in the harness. Nothing else in the
  // tree can show that, and a claim that overturns a specification is the last
  // one that should rest on prose.
  const blocked = await second.evaluate(
    (db) =>
      new Promise<string>((resolve) => {
        const request = indexedDB.deleteDatabase(db);
        request.onblocked = () => resolve("blocked");
        request.onsuccess = () => resolve("deleted");
        request.onerror = () => resolve("error");
        setTimeout(() => resolve("no answer in 3000 ms"), 3000);
      }),
    "pointer-planner",
  );
  check(
    blocked === "blocked",
    `a deleteDatabase issued while the first page holds it open answers ${JSON.stringify(blocked)}`,
  );
  const survived = await second.evaluate(
    (db) => indexedDB.databases().then((all) => all.some((d) => d.name === db)),
    "pointer-planner",
  );
  check(survived, "and the database is still there, so the delete deleted nothing");

  // The other shape, and the commoner one: the first page is GONE. Sequential
  // tests sharing a context leave no connection open. The probe reads the same,
  // because it never depended on a connection - and this is also the shape in
  // which `PLAN.md`'s delete WOULD have worked, which is why the refutation is
  // about the concurrent shape and not about the step being useless.
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
    `shapes - a page still holding the database open, and a page that has closed - and the ` +
    `delete PLAN.md specified was blocked and deleted nothing in the first of them.\n` +
    `         This script writes one task through the page and opens the database through the ` +
    `shell, which is how the state is arranged. The PROBE writes and opens nothing.`,
);
