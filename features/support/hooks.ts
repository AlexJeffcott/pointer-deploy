import {
  After,
  Before,
  BeforeAll,
  AfterAll,
  BeforeWithFixtures,
} from "./bdd.ts";
import { MODE, PointerWorld, REAL_CHANNELS, pointerBuildId } from "./world.ts";

const realChannelsBefore = new Map<string, string>();

async function recordRealChannels(): Promise<void> {
  if (MODE !== "live" || realChannelsBefore.size === REAL_CHANNELS.length) return;
  for (const channel of REAL_CHANNELS) {
    if (!realChannelsBefore.has(channel)) {
      realChannelsBefore.set(channel, await pointerBuildId(channel));
    }
  }
}

BeforeAll(recordRealChannels);

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

After(async function (this: PointerWorld) {
  await this.stopLocal();
  await this.restorePointer();
  await this.restoreHistory();
  await this.restoreRegionParity();
});
