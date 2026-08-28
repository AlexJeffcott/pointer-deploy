// Drives the version switcher on the LIVE site, in a real browser.
//
//   bun run scripts/e2e-version-switcher.ts
//   E2E_APP=charlie bun run scripts/e2e-version-switcher.ts
//   E2E_ORIGIN=https://pointer-deploy.fly.dev bun run scripts/e2e-version-switcher.ts
//
// Why this exists beside the @browser scenario that covers the same feature:
// that scenario runs `bun src/server/index.ts` from this working tree, because
// no browser can send the Host header a test-* channel is reached by. It proves
// the CODE. This proves the DEPLOY - the running image, the real channel, the
// bundles a visitor actually fetches - and it is the workflow a person performs
// rather than a reconstruction of it.
//
// It reads and it never writes. No channel moves and nothing is published, so
// it is safe to run against a real channel at any time.
//
// It needs a sub-app with two published units on the channel. Without one there
// is nothing to choose and it says so rather than passing.

import { chromium, type Page } from "playwright-core";

const ORIGIN = Bun.env.E2E_ORIGIN ?? "https://pointer-deploy.fly.dev";
const APP = Bun.env.E2E_APP ?? "alpha";
/** The view the sub-app appears on. alpha and bravo are on "/". */
const PATH = Bun.env.E2E_PATH ?? (APP === "charlie" || APP === "delta" ? "/totals" : "/");
const TIMEOUT = 30_000;

const failures: string[] = [];
const check = (claim: string, ok: boolean, saw: string) => {
  console.log(`${ok ? "  ok  " : "  FAIL"} ${claim}${ok ? "" : ` - saw ${saw}`}`);
  if (!ok) failures.push(claim);
};

/**
 * What this unit renders, as one string.
 *
 * The panel's text and not its buttons. Two units can differ in a table, a
 * label or a number without either growing a control, and a check that only
 * read the buttons would call those two the same bundle.
 */
const rendered = (page: Page) =>
  page.$eval(`[data-app="${APP}"] section`, (el) =>
    (el.textContent ?? "").replace(/\s+/g, " ").trim(),
  );

/** Enough of it to read in a log line. */
const brief = (text: string) => (text.length > 90 ? `${text.slice(0, 90)}...` : text);

/** The panel's count. Second paragraph of the sub-app's section. */
const count = (page: Page) => page.textContent(`[data-app="${APP}"] p:nth-of-type(2)`);

const options = (page: Page) =>
  page.$$eval(`[data-version-select="${APP}"] option`, (o) =>
    o.map((x) => ({ id: x.getAttribute("value") ?? "", disabled: (x as HTMLOptionElement).disabled })),
  );

const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage();

try {
  console.log(`${ORIGIN} - the composition the channel serves`);
  await page.goto(`${ORIGIN}${PATH}`);
  await page.waitForSelector(`[data-app="${APP}"] section`, { timeout: TIMEOUT });

  const offered = await options(page);
  check(
    `the switcher offers more than one ${APP}`,
    offered.length > 1,
    offered.length ? offered.map((o) => o.id).join(", ") : "no switcher at all",
  );
  if (offered.length < 2) {
    console.error(
      `\nNothing to choose. Publish a change to ${APP} and promote it, then run this again.`,
    );
    process.exit(1);
  }

  const deployed = await page.inputValue(`[data-version-select="${APP}"]`);
  const older = offered.find((o) => o.id !== deployed && !o.disabled);
  check("an older unit is offered and can be chosen", older !== undefined, "only disabled ones");
  if (!older) process.exit(1);

  const before = await rendered(page);
  console.log(`  ${APP} ${deployed} renders: ${brief(before)}`);

  // The deployed unit works. Without this the next half could pass on a page
  // that renders nothing at all.
  await page.click(`[data-app="${APP}"] button:nth-of-type(1)`);
  check("the deployed unit responds to a click", (await count(page))?.trim() === "1", `${await count(page)}`);

  console.log(`\nchoosing ${APP} ${older.id}`);
  await page.selectOption(`[data-version-select="${APP}"]`, older.id);
  await page.waitForURL((u) => u.searchParams.get(APP) === older.id, { timeout: TIMEOUT });
  await page.waitForSelector(`[data-app="${APP}"] section`, { timeout: TIMEOUT });

  const served = await page.$eval(`[data-app="${APP}"] section`, () =>
    JSON.parse(document.getElementById("__APPS__")?.textContent ?? "{}"),
  );
  check(
    `the page fetches ${APP} from the chosen unit's own directory`,
    String(served[APP]?.js ?? "").includes(`/${APP}/${older.id}/`),
    String(served[APP]?.js ?? "nothing"),
  );

  const after = await rendered(page);
  console.log(`  ${APP} ${older.id} renders: ${brief(after)}`);
  check(
    "the chosen unit is a different bundle from the deployed one",
    after !== before,
    "the same page, so nothing here can say which unit ran",
  );

  await page.click(`[data-app="${APP}"] button:nth-of-type(1)`);
  check("the chosen unit responds to a click", (await count(page))?.trim() === "1", `${await count(page)}`);

  // The channel did not move. This is the whole claim: one visitor chose, and
  // everybody else still gets what the operator promoted.
  const other = await browser.newPage();
  await other.goto(`${ORIGIN}${PATH}`);
  await other.waitForSelector(`[data-app="${APP}"] section`, { timeout: TIMEOUT });
  const elsewhere = JSON.parse(
    (await other.textContent("#__BUILD__")) ?? "{}",
  ) as { units?: Record<string, { unitId: string }> };
  check(
    "another visitor still gets the unit the channel serves",
    elsewhere.units?.[APP]?.unitId === deployed,
    `${elsewhere.units?.[APP]?.unitId}`,
  );
  await other.close();

  // An id this channel has never served must be refused, not composed.
  const refused = await fetch(`${ORIGIN}${PATH}?${APP}=0000dead`);
  const body = await refused.text();
  check(
    "an id the channel never served is refused",
    refused.status === 400 && body.includes("not one this channel has served"),
    `${refused.status} ${body.slice(0, 80)}`,
  );
} finally {
  await browser.close();
}

console.log(
  failures.length
    ? `\nFAILED: ${failures.length} of the checks above.`
    : "\nSUCCESS: the switcher serves a chosen unit, and moves no channel doing it.",
);
process.exit(failures.length ? 1 : 0);
