// §3, the second region. Which regions a promote writes, and when it refuses.

import { describe, expect, test } from "bun:test";
import {
  REGIONS,
  manifestKeys,
  regionDrift,
  regionsFor,
  splitChannelReport,
  unitsThatDiffer,
} from "./regions.ts";

const ids = (shell: string, hello = "aaaa1111") => ({ shell, hello });

describe("which regions a promote writes", () => {
  test("all of them, when none is named", () => {
    expect(regionsFor(["qa", "--from-build"])).toEqual({ regions: [...REGIONS] });
  });

  test("one, when one is named", () => {
    expect(regionsFor(["qa", "--region", "us"])).toEqual({ regions: ["us"] });
  });

  // Ignoring the flag would write every region, which is the opposite of what
  // was asked for and the only outcome that cannot be taken back.
  test("a region that does not exist is refused, not ignored", () => {
    const result = regionsFor(["qa", "--region", "eu1"]);
    expect(result).toHaveProperty("error");
    expect((result as { error: string }).error).toContain("unknown region");
  });

  test("the flag with nothing after it is refused", () => {
    expect(regionsFor(["qa", "--region"])).toHaveProperty("error");
  });
});

describe("when two regions disagree", () => {
  test("nothing is wrong when they name the same composition", () => {
    expect(
      regionDrift([
        { region: "eu", ids: ids("ff144709") },
        { region: "us", ids: ids("ff144709") },
      ]),
    ).toBeNull();
  });

  // A region with no pointer is what a first promote is for. Refusing it would
  // leave a new region reachable only by hand.
  test("a region with no pointer yet is not a disagreement", () => {
    expect(
      regionDrift([
        { region: "eu", ids: ids("ff144709") },
        { region: "us", ids: null },
      ]),
    ).toBeNull();
  });

  test("one region alone is not a disagreement", () => {
    expect(regionDrift([{ region: "eu", ids: ids("ff144709") }])).toBeNull();
  });

  // The state the check exists for: the merge reads one region, so writing both
  // would replace the other with a composition nobody chose for it.
  test("two compositions that differ stop the promote and name the units", () => {
    const said = regionDrift([
      { region: "eu", ids: ids("ff144709") },
      { region: "us", ids: ids("52ebe495") },
    ]);
    expect(said).toContain("eu and us serve different compositions");
    expect(said).toContain("shell ff144709 != 52ebe495");
    expect(said).toContain("--region");
  });

  test("a unit one region has and the other does not is a difference", () => {
    const said = regionDrift([
      { region: "eu", ids: { shell: "ff144709", hello: "aaaa1111" } },
      { region: "us", ids: { shell: "ff144709" } },
    ]);
    expect(said).toContain("hello aaaa1111 != none");
  });

  test("the differing units are named, and the matching ones are not", () => {
    expect(unitsThatDiffer({ shell: "a", hello: "b" }, { shell: "a", hello: "c" })).toEqual([
      "hello",
    ]);
  });
});

// TODO §42. The same split `regionDrift` refuses a promote for, read at the
// START of a suite run instead of one Background at a time. What a person needs
// there is not "two regions disagree" - they get that 41 times - but which
// channel, what an earlier run left behind, and the command that puts it back.
describe("a channel a killed run left split", () => {
  const split = [
    { region: "eu" as const, ids: { shell: "62d6b53a", list: "f1fdb597" } },
    { region: "us" as const, ids: { shell: "62d6b53a", list: "4a8fa04b" } },
  ];

  test("two regions in agreement have nothing to report", () => {
    const same = { shell: "62d6b53a", list: "f1fdb597" };
    expect(
      splitChannelReport("test-qa", [
        { region: "eu", ids: same },
        { region: "us", ids: { ...same } },
      ], "eu"),
    ).toBeNull();
  });

  // A region with no pointer is the state a first promote exists to fix, not a
  // split. `regionDrift` takes the same reading and for the same reason.
  test("a region with no pointer is not a split", () => {
    expect(
      splitChannelReport("test-qa", [
        { region: "eu", ids: { shell: "62d6b53a" } },
        { region: "us", ids: null },
      ], "eu"),
    ).toBeNull();
  });

  test("names the channel", () => {
    expect(splitChannelReport("test-qa", split, "eu")).toContain("test-qa is split across regions");
  });

  test("names the unit that differs and both ids, and no unit that does not", () => {
    const said = splitChannelReport("test-qa", split, "eu")!;
    expect(said).toContain("us serves list 4a8fa04b");
    expect(said).toContain("eu serves list f1fdb597");
    expect(said).not.toContain("shell 62d6b53a where");
  });

  // The whole point of the item. A message that says a channel is split and
  // stops there leaves a person to work out the flags from two manifests.
  test("names the promote that puts it back, with every unit the base serves", () => {
    const said = splitChannelReport("test-qa", split, "eu")!;
    expect(said).toContain("bun run promote test-qa --region us --shell 62d6b53a --app list=f1fdb597");
  });

  test("says the run did not cause it", () => {
    expect(splitChannelReport("test-qa", split, "eu")).toContain("Nothing in this run caused it");
  });

  // The base is what every other region is put back TO. With two regions, a
  // base that names nothing leaves one known region, and a set of one differs
  // from nothing - so this is not a split and there is nothing to say. The
  // test was named "reports the split and offers no command" until a cold read
  // on 2026-09-13 read its body, which asserts the opposite.
  test("a base region with no pointer is not a split", () => {
    expect(
      splitChannelReport("test-qa", [
        { region: "eu", ids: null },
        { region: "us", ids: { shell: "62d6b53a" } },
      ], "eu"),
    ).toBeNull();
  });

  test("one command per region that differs, and no more", () => {
    const said = splitChannelReport("test-qa", [
      { region: "eu", ids: { shell: "aaaa1111" } },
      { region: "us", ids: { shell: "bbbb2222" } },
    ], "eu")!;
    expect(said.split("bun run promote")).toHaveLength(2);
  });

  // A promote MERGES, so a unit the split region serves and the base does not
  // is carried and the channel stays split. That is the one case the message
  // already describes in words - "us serves hello aaaa1111 where eu serves
  // hello none" - and the command under it could not fix until 2026-09-13.
  test("a unit the base does not serve is dropped, not left to be carried", () => {
    const said = splitChannelReport("test-qa", [
      { region: "eu", ids: { shell: "aaaa1111" } },
      { region: "us", ids: { shell: "aaaa1111", hello: "bbbb2222" } },
    ], "eu")!;
    expect(said).toContain("hello bbbb2222");
    expect(said).toContain("bun run promote test-qa --region us --shell aaaa1111 --drop hello");
  });

  test("a unit both regions serve is named by --app and never dropped", () => {
    const said = splitChannelReport("test-qa", split, "eu")!;
    expect(said).toContain("--app list=f1fdb597");
    expect(said).not.toContain("--drop");
  });
});

describe("every manifest a reader has to look at", () => {
  // The sweep is the reader that matters. One region missing here is units
  // deleted while a machine is serving them.
  test("covers every region, not only the one this machine is in", () => {
    const keys = manifestKeys(["qa"]);
    expect(keys.map((k) => k.region).sort()).toEqual([...REGIONS].sort());
    expect(keys.map((k) => k.pointer).sort()).toEqual(
      [...REGIONS].map((r) => `manifests/${r}/qa.json`).sort(),
    );
  });

  test("and every channel in every region", () => {
    expect(manifestKeys(["qa", "prod"])).toHaveLength(REGIONS.length * 2);
    expect(manifestKeys(["qa"])[0]?.history).toBe("manifests/eu/qa.history.json");
  });
});
