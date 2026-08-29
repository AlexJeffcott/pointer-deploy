// §11. The committed reading of what the server writes, against the surface it
// is derived from.
//
// This is the check that makes `src/server/blocks.ts` append-only in practice
// rather than in a comment: renaming a field there and not recording it leaves
// the file the SERVER reads describing a server that no longer exists, and the
// gate would then judge every shell against a lie.

import { describe, expect, test } from "bun:test";
import { blocksProvided, sameProvided } from "./blocks.ts";
import { readBlockMembers } from "./members.ts";

describe("the committed block reading", () => {
  test(
    "matches the surface it is derived from",
    async () => {
      const committed = await blocksProvided();
      const derived = (await readBlockMembers()).provides;
      expect(Object.keys(committed).length).toBeGreaterThan(0);
      expect(committed).toEqual(derived);
      expect(sameProvided(committed, derived)).toBe(true);
    },
    120_000,
  );
});

describe("sameProvided", () => {
  test("a field added, removed or re-declared is a difference", () => {
    expect(sameProvided({ a: "1" }, { a: "1" })).toBe(true);
    expect(sameProvided({ a: "1" }, { a: "2" })).toBe(false);
    expect(sameProvided({ a: "1" }, { a: "1", b: "1" })).toBe(false);
    expect(sameProvided({ a: "1", b: "1" }, { a: "1" })).toBe(false);
  });
});
