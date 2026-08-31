import { Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { REGIONS } from "../../scripts/regions.ts";
import { PointerWorld, type Channel } from "../support/world.ts";

When(
  "the {string} region alone is moved to build {string} on the {word} channel",
  async function (this: PointerWorld, region: string, name: string, channel: string) {
    this.lastRun = await this.moveRegionAlone(channel as Channel, name, region);
    expect(this.lastRun.code, this.lastRun.stderr).toBe(0);
  },
);

Then(
  "every region's pointer names build {string} on the {word} channel",
  async function (this: PointerWorld, name: string, channel: string) {
    const expected = this.idsOf(name);
    for (const region of REGIONS) {
      const composition = await this.compositionInRegion(channel as Channel, region);
      expect(composition, `the ${region} pointer for ${channel}`).toMatchObject(expected);
    }
  },
);

Then(
  "every region holds the composition this promote wrote on the {word} channel",
  async function (this: PointerWorld, channel: string) {
    const deadline = Date.now() + 15_000;
    let texts: Array<string | null> = [];
    for (;;) {
      texts = await Promise.all(
        REGIONS.map((r) => this.pointerTextInRegion(channel as Channel, r)),
      );
      const first = texts[0];
      if (typeof first === "string" && texts.every((t) => t === first)) return;
      if (Date.now() > deadline) break;
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
    const seen = REGIONS.map((r, i) => {
      const doc = texts[i] ?? null;
      const at = doc === null ? "no pointer" : (/"composedAt": "([^"]+)"/.exec(doc)?.[1] ?? "unstamped");
      return `${r} composed ${at}`;
    }).join(", ");
    throw new Error(
      `the regions do not hold the same composition after 15 s: ${seen}. ` +
        `One promote writes every region, so a region left behind is a region ` +
        `serving what it served before.`,
    );
  },
);

Then(
  "the {string} region's pointer names build {string} on the {word} channel",
  async function (this: PointerWorld, region: string, name: string, channel: string) {
    const composition = await this.compositionInRegion(channel as Channel, region);
    expect(composition, `the ${region} pointer for ${channel}`).toMatchObject(this.idsOf(name));
  },
);

Then(
  "the promotion is refused because the regions disagree",
  function (this: PointerWorld) {
    const run = this.lastRun!;
    expect(run.code, run.stderr).not.toBe(0);
    expect(run.stderr).toContain("serve different compositions");
    expect(run.stderr).toContain("Nothing was changed");
  },
);

When(
  "a visitor loads the {word} origin through the {string} region",
  async function (this: PointerWorld, channel: string, flyRegion: string) {
    this.routedTo = flyRegion;
    this.regionsSeen = await this.regionsServedFrom(channel as Channel, flyRegion);
  },
);

Then(
  "that machine says it served the {string} region",
  function (this: PointerWorld, region: string) {
    expect(this.regionsSeen, `reached through ${this.routedTo}`).toEqual([region]);
  },
);
