// §3, the second region. Which regions a promote writes, and when it refuses.

import { describe, expect, test } from "bun:test";
import { REGIONS, manifestKeys, regionDrift, regionsFor, unitsThatDiffer } from "./regions.ts";

const ids = (shell: string, alpha = "aaaa1111") => ({ shell, alpha });

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
      { region: "eu", ids: { shell: "ff144709", alpha: "aaaa1111" } },
      { region: "us", ids: { shell: "ff144709" } },
    ]);
    expect(said).toContain("alpha aaaa1111 != none");
  });

  test("the differing units are named, and the matching ones are not", () => {
    expect(unitsThatDiffer({ shell: "a", alpha: "b" }, { shell: "a", alpha: "c" })).toEqual([
      "alpha",
    ]);
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
