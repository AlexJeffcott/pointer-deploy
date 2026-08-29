import { describe, expect, test } from "bun:test";
import { blocksWritten } from "./provides.ts";

// What the RUNNING server judges every shell against, §11.
//
// A fault here is silent in one direction only. An empty reading refuses
// nothing, so the blocks gate allows exactly the shell it exists to refuse -
// and the page still renders, so no check downstream notices. All three of
// Stryker's mutants on this file produce that same empty reading: the file name
// emptied, the body emptied, and `??` turned into `&&`. All three survived
// until 2026-08-29, because the file had no test at all.
describe("blocksWritten", () => {
  test("reads the record committed beside it", async () => {
    const committed = await Bun.file(
      new URL("./blocks.provides.json", import.meta.url),
    ).json();
    const written = await blocksWritten();

    expect(written).toEqual(committed);
    // Stated rather than implied. A record that read as {} would satisfy the
    // line above against a file that was also {}, and judge nothing.
    expect(Object.keys(written).length).toBeGreaterThan(0);
    for (const [member, digest] of Object.entries(written)) {
      expect(typeof digest).toBe("string");
      expect(digest).not.toBe("");
      expect(member).not.toBe("");
    }
  });

  // The reading the doc comment promises. An image built before the file
  // existed, or one where it did not copy, judges no shell rather than
  // refusing every visitor.
  test("a missing file is an empty reading, not a throw", async () => {
    const missing = new URL("./no-such-blocks.provides.json", import.meta.url);
    expect(await blocksWritten(missing)).toEqual({});
  });
});
