import { describe, expect, test } from "bun:test";
import { blocksWritten } from "./provides.ts";

describe("blocksWritten", () => {
  test("reads the record committed beside it", async () => {
    const committed = await Bun.file(
      new URL("./blocks.provides.json", import.meta.url),
    ).json();
    const written = await blocksWritten();

    expect(written).toEqual(committed);
    expect(Object.keys(written).length).toBeGreaterThan(0);
    for (const [member, digest] of Object.entries(written)) {
      expect(typeof digest).toBe("string");
      expect(digest).not.toBe("");
      expect(member).not.toBe("");
    }
  });

  test("a missing file is an empty reading, not a throw", async () => {
    const missing = new URL("./no-such-blocks.provides.json", import.meta.url);
    expect(await blocksWritten(missing)).toEqual({});
  });
});
