import {
  After,
  Before,
  BeforeAll,
  AfterAll,
  BeforeWithFixtures,
} from "./bdd.ts";
import {
  BASE_REGION,
  MODE,
  PointerWorld,
  REAL_CHANNELS,
  TEST_CHANNELS,
  compositionOf,
  pointerBuildId,
} from "./world.ts";
import { REGIONS, splitChannelReport } from "../../scripts/regions.ts";
import { coldPlannerProblem } from "./cold-planner.ts";

const realChannelsBefore = new Map<string, string>();

/**
 * Whether a test channel is already split across regions, before anything runs.
 *
 * TODO §42. A run killed by a signal never runs the `After` hook that puts a
 * moved region back, so the next run meets `regionDrift`'s refusal in every
 * Background - 41 of 46 on 2026-09-11. That refusal is correct and says nothing
 * about WHY, so a person reads 41 red scenarios as a code failure.
 *
 * One reading naming the channel and the command that fixes it. The message is
 * built by `splitChannelReport`, which is pure and is where the mutations are
 * aimed; this function is the store read around it.
 *
 * ONCE PER WORKER, not once per run, and a sentence here claimed the second
 * until a cold read on 2026-09-13. playwright-bdd marks a worker hook executed
 * on a module-level array, and Playwright discards a worker after a failing
 * job - so a split channel prints this again for each feature file that meets
 * it, up to eleven on this suite. What is measured is the CONTENT: one message
 * naming the channel and the recovery, where `regionDrift` gave the same
 * refusal in every Background with nothing about why. `bun run verify:split`
 * is the arrangement and it runs one scenario, which is the one shape where
 * the repetition cannot be seen.
 *
 * It reads BOTH test channels, so a split `test-prod` stops `verify:browser`
 * as well, though no `@browser` scenario writes that channel. That is
 * deliberate: a split test channel is a fault an operator has to clear before
 * the next live run either way, and two reads at the start of a run are
 * cheaper than meeting it later.
 *
 * It does not repair. `restoreRegionParity` repairs what a SCENARIO moved,
 * because it knows what it moved; putting a channel back that this run did not
 * move would be a write to a channel on no scenario's behalf.
 */
async function refuseSplitChannels(): Promise<void> {
  if (MODE !== "live") return;
  const reports: string[] = [];
  for (const channel of TEST_CHANNELS) {
    const compositions = await Promise.all(
      REGIONS.map(async (region) => ({ region, ids: await compositionOf(channel, region) })),
    );
    const report = splitChannelReport(channel, compositions, BASE_REGION);
    if (report) reports.push(report);
  }
  if (reports.length === 0) return;
  throw new Error(
    `${reports.length} test channel(s) are split across regions, so every promote to them ` +
      `is refused and every scenario with a Background would fail on that refusal one at a ` +
      `time. Nothing ran.\n` +
      `This is read once per worker, so it appears again for each feature file that meets ` +
      `it - the state is the same one each time.\n\n${reports.join("\n\n")}`,
  );
}

async function recordRealChannels(): Promise<void> {
  if (MODE !== "live" || realChannelsBefore.size === REAL_CHANNELS.length) return;
  for (const channel of REAL_CHANNELS) {
    if (!realChannelsBefore.has(channel)) {
      realChannelsBefore.set(channel, await pointerBuildId(channel));
    }
  }
}

// The real-channel reading FIRST, and the split check second. Measured on
// 2026-09-13 with `test-prod` split on purpose: the other order threw before
// `recordRealChannels` ran, so `AfterAll`'s deploy guard then threw a second
// time - "this run never recorded what qa and prod pointed at" - and a person
// met two errors where the whole point of this check is one. Recording costs
// two reads and cannot fail the run for a reason of its own.
BeforeAll(recordRealChannels);
BeforeAll(refuseSplitChannels);

AfterAll(async function () {
  if (MODE !== "live") return;

  const unrecorded = REAL_CHANNELS.filter((c) => !realChannelsBefore.has(c));
  if (unrecorded.length) {
    throw new Error(
      `this run never recorded what ${unrecorded.join(" and ")} pointed at, so it ` +
        `cannot say whether the suite moved either. That is the deploy guard not ` +
        `running, not a deploy. Check what ${unrecorded.join(" and ")} serve by hand.`,
    );
  }

  const moved: string[] = [];
  for (const channel of REAL_CHANNELS) {
    const before = realChannelsBefore.get(channel);
    const after = await pointerBuildId(channel);
    if (before !== after) moved.push(`  ${channel}: ${before} -> ${after}`);
  }
  if (moved.length) {
    throw new Error(
      `the live suite moved ${moved.length} real channel(s). That is a deploy:\n` +
        `${moved.join("\n")}\n` +
        `Promote the build that should be live, then find what wrote the channel.`,
    );
  }
});

Before({ tags: "@local" }, async function (this: PointerWorld) {
  if (this.mode !== "local") return;
  await this.startLocal();
});

Before({ tags: "@live" }, async function (this: PointerWorld) {
  if (this.mode !== "live") return;
  await recordRealChannels();
  this.machinesBefore = await this.machineFingerprint();
});

Before({ tags: "@test-channel" }, async function (this: PointerWorld) {
  if (this.mode !== "live") {
    throw new Error("@test-channel needs the real store. Run `bun run verify:browser`.");
  }
  await recordRealChannels();
  await this.startAgainstRealStore();
});

BeforeWithFixtures({ tags: "@browser" }, async ({ page, world }) => {
  world.usePage(page);
});

After(async function (this: PointerWorld, { $testInfo }) {
  // TODO §44, and it is READ here and thrown at the end. The reading lives in
  // the page's own `sessionStorage`, so it has to be taken before any context
  // closes; the throw has to come after the restores, because a hook that threw
  // first would leave a pointer where a scenario moved it - which is the state
  // §42 exists to report, produced by the check for §44.
  //
  // What it says is whether any context this scenario used already held a
  // planner when its first document loaded. That cannot happen while Playwright
  // gives each test its own context, and it is what a change to that isolation
  // would produce. Nothing is cleared: the clear `PLAN.md` specified was built,
  // measured and taken out - `cold-planner.ts` carries the reading. So a reused
  // context gives a visitor a warm planner and this says so.
  const coldPlanner = (await this.coldPlannerReadings())
    .map((reading) => coldPlannerProblem(reading, $testInfo.title))
    .filter((problem): problem is string => problem !== null);

  // Before the page fixture is torn down: a context this world opened is not
  // the fixture's, so nothing else closes it.
  await this.closeExtraBrowsers();
  // Before the server is stopped: a local service is reached through this
  // world, and stopping first would leave the write nowhere to go.
  await this.restoreAudience();
  await this.stopLocal();
  await this.restorePointer();
  await this.restoreHistory();
  await this.restoreRegionParity();

  if (coldPlanner.length > 0) throw new Error(coldPlanner[0]!);
});
