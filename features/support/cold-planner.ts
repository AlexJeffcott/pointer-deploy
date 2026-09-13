// The cold state every browser scenario starts from, TODO §44.
//
// `PLAN.md`'s "What this costs the suite" specifies
// `indexedDB.deleteDatabase("pointer-planner")` in the browser world's setup,
// "once, so no scenario can forget it", plus one `falsify` mutation removing it
// and a named scenario that must go red. `deleteDatabase` appeared nowhere in
// the tree until 2026-09-13.
//
// **That step was built, measured, and taken out again.** `scripts/probe-cold-planner.ts`
// arranges the state it is for - two pages in one browser context - and the
// readings on 2026-09-13 were:
//
//   the first page still open   the delete is BLOCKED. A blocked delete deletes
//                               nothing AND queues every later open on that
//                               name behind it, so the second page's shell
//                               never got a connection: the panel sat on
//                               "Reading the planner…" and drew nothing.
//   a third page after that     blocked as well, behind the first delete.
//
// So the clear does not save a reused context. It hangs it, which is worse than
// the state it was meant to fix. What is left is the READING, and it needs no
// delete: `indexedDB.databases()` names what exists and its version, opens
// nothing, and blocks nothing.
//
// The mutation half of the plan's specification cannot be met either way:
// nothing this module does is reachable while Playwright gives each test its
// own context, so a mutation removing it stays green. That is the shape the
// memory calls a check that cannot reach its state, and the answer is the one
// that memory gives - arrange the moment. `bun run verify:cold` is the
// arrangement, and it is one command.

/** Where the probe leaves its reading, for the After hook to pick up. */
export const PROBE_KEY = "__coldPlannerProbe";

export const PLANNER_DB = "pointer-planner";

/**
 * What the probe read.
 *
 * A version number for a database that exists, 0 for one that does not, and
 * "unsupported" for a browser with no `indexedDB.databases()`. `sessionStorage`
 * holds strings, so this is the reader.
 */
export type ProbeReading = number | "unsupported" | null;

export function readProbe(raw: string | null): ProbeReading {
  if (raw === null || raw === "unread") return null;
  if (raw === "unsupported") return "unsupported";
  // Digits and nothing else. `Number("")` is 0 and `Number("0x10")` is 16, so
  // reading through `Number` turned an empty value into "cold" and a hex string
  // into a version. Found by a cold read on 2026-09-13; the test that claimed
  // to cover it happened to pick three strings `Number` also rejects.
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * Why this scenario did not start cold, or null.
 *
 * Null for a probe that never ran, deliberately. A scenario that failed before
 * it opened a page has one error already, and a second one about the planner
 * would be noise - which is the defect the §42 arrangement found in its own
 * hook on the same day.
 */
export function coldPlannerProblem(reading: ProbeReading, scenario: string): string | null {
  // "unsupported" is a browser that cannot answer, not a browser that is warm.
  // Reporting it would fail every run on a browser this suite does not use.
  if (reading === null || reading === "unsupported" || reading === 0) return null;

  return (
    `${scenario} did not start from a cold planner: ${PLANNER_DB} already existed at ` +
    `version ${reading} when its first document loaded.\n` +
    `  Every browser scenario must start from the state a fresh visitor sees. That held ` +
    `without anything asserting it, because Playwright gives each test its own context and ` +
    `IndexedDB is per profile.\n` +
    `  Something changed that. What produces it is a SHARED context: a fixture or hook that ` +
    `reuses one across tests, \`launchPersistentContext\`, or a \`storageState\` carrying a ` +
    `profile in. More workers is more isolation, not less, and \`fullyParallel\` cannot share ` +
    `one either - a sentence here said both until a cold read on 2026-09-13.\n` +
    `  Then look at any step that opens a second page, and at playwright.config.ts.\n` +
    `  Nothing here clears it. Measured on 2026-09-13: a delete issued while another page ` +
    `holds the database open is blocked, deletes nothing, and queues every later open ` +
    `behind it - so the clear hangs a reused context rather than saving it. ` +
    `bun run verify:cold is that arrangement.`
  );
}

/**
 * The script the world installs on every page it drives, as text.
 *
 * Text rather than a function, because it is handed to `addInitScript` and runs
 * in the page. It is exported so `cold-planner.test.ts` can read the things
 * about it that are checkable without a browser: that it opens nothing, deletes
 * nothing, and marks the context before it reads, so a reload inside one
 * scenario does not take a second reading of a planner the scenario just wrote.
 *
 * `indexedDB.databases()` is a read. It creates no database, holds no
 * connection and blocks nothing, which is the whole reason it replaced the
 * delete.
 *
 * It resolves asynchronously, and it CAN lose a race the other way: the spec
 * resolves it against the storage bucket when its task runs, not when it is
 * called, so a shell that opened the database first would be reported as warm
 * on a cold context. Nothing has seen that - `verify:cold` reads 0 on a fresh
 * context every run - and one script on one day is the whole of the evidence,
 * which a cold read on 2026-09-13 said plainly rather than leaving implied. The
 * cost if it ever happens is a scenario failing in its `After` hook for a
 * reason that is not true, which is the least diagnosable kind of failure. What
 * makes it unlikely is that the shell's module is fetched over the network
 * before it can open anything.
 */
export const PROBE_SCRIPT = `(() => {
  try {
    if (sessionStorage.getItem(${JSON.stringify(PROBE_KEY)}) !== null) return;
    sessionStorage.setItem(${JSON.stringify(PROBE_KEY)}, "unread");
    if (typeof indexedDB.databases !== "function") {
      sessionStorage.setItem(${JSON.stringify(PROBE_KEY)}, "unsupported");
      return;
    }
    const reading = indexedDB.databases();
    reading.then((all) => {
      const held = all.find((d) => d.name === ${JSON.stringify(PLANNER_DB)});
      sessionStorage.setItem(${JSON.stringify(PROBE_KEY)}, String(held ? (held.version ?? 1) : 0));
    });
    reading.catch(() => sessionStorage.setItem(${JSON.stringify(PROBE_KEY)}, "unsupported"));
  } catch {
    // A context with no sessionStorage and no IndexedDB is a browser the
    // planner cannot use at all, which is step 2's "unstored" and a scenario's
    // subject rather than a fault here.
  }
})();`;
