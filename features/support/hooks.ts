// Every hook, in one file and in the order they must run.
//
// They were at the foot of world.ts and moved here for a reason that is not
// tidiness: `bdd.ts` has to import the world class to build the fixture, and
// the hooks have to import `bdd.ts` to be registered. Leaving them in world.ts
// makes that a cycle. World, then bindings, then hooks.

import {
  After,
  Before,
  BeforeAll,
  AfterAll,
  BeforeWithFixtures,
} from "./bdd.ts";
import { MODE, PointerWorld, REAL_CHANNELS, pointerBuildId } from "./world.ts";

// The suite's own channels are the fix; this is the check on it. A live run
// that writes qa or prod is a deploy nobody asked for, so the run records what
// the real channels point at and fails if either moved. It repairs nothing on
// purpose - a restore that fails leaves the channel wrong and says it did not.
const realChannelsBefore = new Map<string, string>();

/**
 * Record what the real channels point at, once, before anything can move one.
 *
 * Idempotent and called from more than one place, which the port made
 * necessary and is the better shape anyway. Playwright reports a failed
 * `beforeAll` against the first test of its FILE and carries on with the other
 * files, so a baseline taken only there is a baseline one dropped connection
 * can remove for a whole run - and the tripwire is then inert while 15
 * scenarios publish and promote. Every live scenario's own Before calls this,
 * so the baseline exists before the first thing that could write a pointer.
 */
async function recordRealChannels(): Promise<void> {
  if (MODE !== "live" || realChannelsBefore.size === REAL_CHANNELS.length) return;
  for (const channel of REAL_CHANNELS) {
    if (!realChannelsBefore.has(channel)) {
      realChannelsBefore.set(channel, await pointerBuildId(channel));
    }
  }
}

// Per WORKER and not per feature file, which was worth checking rather than
// assuming: with one worker that is once per run, exactly as before.
BeforeAll(recordRealChannels);

AfterAll(async function () {
  if (MODE !== "live") return;

  // A missing baseline is NOT a move, and saying it is would be the worst
  // sentence this suite can print: "the live suite deployed to prod" when
  // nothing deployed anywhere. It is still a failure - the guard did not run -
  // and it gets its own words.
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

// A scenario that drives one of the suite's OWN channels in a browser. No
// browser can reach a test-* channel on Fly - Host is forbidden to
// setExtraHTTPHeaders and Fly routes on SNI - so the documented entry point
// runs here, against the real store. Registered before the @browser hook so
// the server is listening by the time a page is opened.
Before({ tags: "@test-channel" }, async function (this: PointerWorld) {
  if (this.mode !== "live") {
    throw new Error("@test-channel needs the real store. Run `bun run verify:browser`.");
  }
  await recordRealChannels();
  await this.startAgainstRealStore();
});

// The one playwright-style hook. The page is the RUNNER's, so a failed
// scenario leaves a trace and a screenshot attached to it; a page the harness
// opened itself would leave neither.
BeforeWithFixtures({ tags: "@browser" }, async ({ page, world }) => {
  world.usePage(page);
});

After(async function (this: PointerWorld) {
  await this.stopLocal();
  // Last, and after the server that was reading them is gone: a channel left
  // holding a fixture is a channel pointing somewhere nobody promoted, and a
  // history left holding one offers a build that cannot be served.
  await this.restorePointer();
  await this.restoreHistory();
});
