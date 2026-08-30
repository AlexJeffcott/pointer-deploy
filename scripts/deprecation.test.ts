// §10, the deprecation dynamic. Build-time code, so `bun test scripts` is its
// home rather than `bun test src/server`.
//
// Everything here is a pure reading over a registry: what is wrong with a
// deprecation somebody wrote, and what an operator is told at the promote that
// resolves at one. The wiring into promote.ts and contract-matrix.ts is a call
// site each, and `falsify` is what holds those - see the §10 mutations there.

import { describe, expect, test } from "bun:test";
import {
  UNITS,
  deprecationOf,
  deprecationProblems,
  deprecationWarnings,
  renderMatrix,
  type ContractRecord,
  type Deprecation,
  type MatrixResult,
  type Registry,
  type Unit,
} from "./contract.ts";

const record = (name: string, hash: string, deprecated?: Deprecation): ContractRecord => ({
  name,
  hash,
  firstSeenCommit: "0".repeat(40),
  firstSeenAt: "2026-08-01T00:00:00.000Z",
  ...(deprecated ? { deprecated } : {}),
});

const going = (instead: string | null): Deprecation => ({
  reason: "the store is injected now",
  at: "2026-08-30T09:00:00.000Z",
  instead,
});

/** Two contracts, the older one going away, both retained. */
const registry = (deprecated: Deprecation | undefined, retained = ["old1234", "new5678"]): Registry => ({
  contracts: [record("counters", "old1234", deprecated), record("injected", "new5678")],
  retained,
});

describe("what is wrong with a deprecation", () => {
  test("nothing, when there is none", () => {
    expect(deprecationProblems(registry(undefined))).toEqual([]);
    expect(deprecationOf(registry(undefined), "old1234")).toBeNull();
  });

  test("nothing, when it names a retained replacement", () => {
    expect(deprecationProblems(registry(going("new5678")))).toEqual([]);
  });

  test("nothing, when it names no replacement at all", () => {
    expect(deprecationProblems(registry(going(null)))).toEqual([]);
  });

  test("a deprecation that does not say why is refused", () => {
    const problems = deprecationProblems(registry({ ...going(null), reason: "  " }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("has to say why");
  });

  test("a deprecation dated with something that is not a date is refused", () => {
    const problems = deprecationProblems(registry({ ...going(null), at: "soon" }));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("not a date");
  });

  test("a deprecation naming a contract that is not here is refused", () => {
    const problems = deprecationProblems(registry(going("abc1234")));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("not a contract here");
  });

  // The reading the field exists for. A replacement nobody retains cannot be
  // promoted against, so the warning would send an operator somewhere they
  // cannot go - and they would find that out at the promote, not here.
  test("a deprecation naming a replacement nobody retains is refused", () => {
    const problems = deprecationProblems(registry(going("new5678"), ["old1234"]));
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("not retained");
  });

  test("a deprecation naming a deprecated replacement is refused", () => {
    const both: Registry = {
      contracts: [
        record("counters", "old1234", going("new5678")),
        record("injected", "new5678", going(null)),
      ],
      retained: ["old1234", "new5678"],
    };
    const problems = deprecationProblems(both);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("deprecated too");
  });
});

describe("what a promote at a deprecated contract is told", () => {
  test("nothing, when the contract it resolved at is not deprecated", () => {
    expect(deprecationWarnings(registry(going("new5678")), "new5678", ["new5678"])).toEqual([]);
  });

  test("nothing, when the composition resolved at no contract at all", () => {
    expect(deprecationWarnings(registry(going("new5678")), "none", [])).toEqual([]);
  });

  test("the reason, the date and the replacement", () => {
    const said = deprecationWarnings(registry(going("new5678")), "old1234", ["old1234"]).join("\n");
    expect(said).toContain("WARNING");
    expect(said).toContain("old1234 (counters)");
    expect(said).toContain("2026-08-30");
    expect(said).toContain("the store is injected now");
    expect(said).toContain("Move to new5678 (injected)");
  });

  test("that nothing is named to move to, when nothing is", () => {
    const said = deprecationWarnings(registry(going(null)), "old1234", ["old1234"]).join("\n");
    expect(said).toContain("Nothing is named to move to");
  });

  // The state the whole warning exists to prevent: every option this promote
  // has is going away, so there is nothing to move to without republishing.
  test("that a promote with no other option has none", () => {
    const said = deprecationWarnings(registry(going("new5678")), "old1234", ["old1234"]).join("\n");
    expect(said).toContain("no other option");
  });

  test("which option is still alive, when one is", () => {
    const said = deprecationWarnings(
      registry(going("new5678")),
      "old1234",
      ["old1234", "new5678"],
    ).join("\n");
    expect(said).toContain("also shares new5678");
    expect(said).not.toContain("no other option");
  });
});

describe("the matrix and a contract that is going away", () => {
  const matrix = (deprecated?: Deprecation): MatrixResult => ({
    sets: Object.fromEntries(UNITS.map((u) => [u, ["old1234"]])) as Record<Unit, string[]>,
    contracts: registry(deprecated).contracts,
    ms: 1,
  });

  test("the deprecation is named under the table", () => {
    const rendered = renderMatrix(matrix(going("new5678")));
    expect(rendered).toContain("old1234 (counters) is deprecated as of 2026-08-30");
    expect(rendered).toContain("the store is injected now");
    expect(rendered).toContain("Move to new5678.");
    expect(rendered).toContain("still retained");
  });

  // Below the table and not in it. A marked column would be wider than its
  // hash, and every cell under it is padded to that width.
  test("and the table itself is untouched", () => {
    const plain = renderMatrix(matrix(undefined)).split("\n");
    const marked = renderMatrix(matrix(going(null))).split("\n");
    expect(marked.slice(0, UNITS.length + 1)).toEqual(plain);
  });
});
