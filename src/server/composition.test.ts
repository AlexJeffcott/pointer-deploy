import { describe, expect, test } from "bun:test";
import {
  HISTORY_DEPTH,
  blockRefusal,
  chooseContract,
  compose,
  compositionRefusal,
  currentIds,
  decidesMembers,
  historyUrl,
  memberRefusal,
  optionsFor,
  parseHistory,
  refuseComposition,
  sharedContracts,
  surfaceOf,
  type ChannelHistory,
  type UnitSurface,
} from "./composition.ts";
import type { ComposedUnit, ManifestV3 } from "./manifest.ts";

const unit = (name: string, id: string, extra: Partial<ComposedUnit> = {}): ComposedUnit => ({
  unitId: id,
  commit: `${id}${"0".repeat(40)}`.slice(0, 40),
  assetBase: `https://store.test/units/${name}/${id}/`,
  js: `${name}-${id}.js`,
  css: `${name}-${id}.css`,
  marker: "",
  ...extra,
});

const manifest: ManifestV3 = {
  schema: 3,
  composedAt: "2026-08-28T00:00:00.000Z",
  contract: "c2",
  shell: unit("shell", "s1", { imports: { preact: "preact-a.js" } }),
  apps: { alpha: unit("alpha", "a1"), bravo: unit("bravo", "b1") },
};

/** s1+a1+b1 all support c2. s0 is older and supports c1 only. */
const history: ChannelHistory = {
  schema: 1,
  updatedAt: "2026-08-28T00:00:00.000Z",
  units: {
    shell: [
      { unit: unit("shell", "s1", { imports: { preact: "preact-a.js" } }), contracts: ["c1", "c2"] },
      { unit: unit("shell", "s0", { imports: { preact: "preact-a.js" } }), contracts: ["c1"] },
    ],
    alpha: [
      { unit: unit("alpha", "a1"), contracts: ["c2"] },
      { unit: unit("alpha", "a0"), contracts: ["c1", "c2"] },
    ],
    bravo: [{ unit: unit("bravo", "b1"), contracts: ["c1", "c2"] }],
  },
};

const served = { shell: "s1", alpha: "a1", bravo: "b1" };

describe("sharedContracts", () => {
  test("keeps only what every unit supports", () => {
    expect(sharedContracts({ shell: ["c1", "c2"], alpha: ["c2"], bravo: ["c1", "c2"] })).toEqual(["c2"]);
  });

  test("is empty when nothing is common", () => {
    expect(sharedContracts({ shell: ["c1"], alpha: ["c2"] })).toEqual([]);
  });

  // The shell seeds the result, so the answer reads in the order the contracts
  // were minted rather than in the order an app happens to list them.
  test("reports in the shell's order", () => {
    expect(sharedContracts({ shell: ["c1", "c2"], alpha: ["c2", "c1"] })).toEqual(["c1", "c2"]);
  });

  test("a unit that supports nothing empties the set", () => {
    expect(sharedContracts({ shell: ["c1", "c2"], alpha: [] })).toEqual([]);
  });

  test("a shell that supports nothing empties the set", () => {
    expect(sharedContracts({ alpha: ["c1"] })).toEqual([]);
  });

  // Nothing filters the seed here, so this is the only place an absent shell
  // can be told from one that seeded the answer with something.
  test("a composition of no units shares nothing", () => {
    expect(sharedContracts({})).toEqual([]);
  });
});

describe("chooseContract", () => {
  // The registry keeps contracts oldest first, so the last one they all support
  // is the newest they all support.
  test("takes the last shared hash", () => {
    expect(chooseContract({ shell: ["c1", "c2"], alpha: ["c1", "c2"] })).toBe("c2");
  });

  test("is null when no contract is shared", () => {
    expect(chooseContract({ shell: ["c1"], alpha: ["c2"] })).toBeNull();
  });
});

describe("historyUrl", () => {
  test("sits beside the pointer, with or without a trailing slash", () => {
    expect(historyUrl("https://s.test/manifests", "eu", "qa")).toBe(
      "https://s.test/manifests/eu/qa.history.json",
    );
    expect(historyUrl("https://s.test/manifests/", "eu", "qa")).toBe(
      "https://s.test/manifests/eu/qa.history.json",
    );
  });
});

describe("currentIds", () => {
  test("names the shell and every app", () => {
    expect(currentIds(manifest)).toEqual({ shell: "s1", alpha: "a1", bravo: "b1" });
  });
});

describe("parseHistory", () => {
  test("accepts a history and keeps every entry", () => {
    const parsed = parseHistory(JSON.parse(JSON.stringify(history)));
    expect(parsed.updatedAt).toBe("2026-08-28T00:00:00.000Z");
    expect(parsed.units.shell?.map((e) => e.unit.unitId)).toEqual(["s1", "s0"]);
    expect(parsed.units.alpha?.[1]?.contracts).toEqual(["c1", "c2"]);
  });

  test("accepts a history that names no units at all", () => {
    expect(parseHistory({ schema: 1, updatedAt: "t", units: {} }).units).toEqual({});
  });

  const rejects = (input: unknown, message: string) =>
    expect(() => parseHistory(input)).toThrow(message);

  test("rejects a non-object", () => {
    rejects(null, "history is not an object");
    rejects("no", "history is not an object");
  });

  test("rejects an unsupported schema", () => {
    rejects({ schema: 2, updatedAt: "t", units: {} }, "unsupported history schema 2");
  });

  test("rejects a missing timestamp", () => {
    rejects({ schema: 1, units: {} }, "history field updatedAt is missing or not a string");
  });

  // An empty string is a name nobody can act on, so it is missing.
  test("rejects an empty string where a value belongs", () => {
    rejects({ schema: 1, updatedAt: "", units: {} }, "history field updatedAt is missing or not a string");
    rejects(
      { schema: 1, updatedAt: "t", units: { shell: [{ unit: { unitId: "" }, contracts: [] }] } },
      "history field units.shell[0].unit.unitId is missing or not a string",
    );
  });

  test("rejects units that is not an object", () => {
    rejects({ schema: 1, updatedAt: "t" }, "history field units is missing or not an object");
    rejects(
      { schema: 1, updatedAt: "t", units: null },
      "history field units is missing or not an object",
    );
  });

  // Truthy and not an object. The falsy cases above leave the second half of
  // each guard untested, and it is the half that catches a malformed document
  // rather than a missing one.
  test("rejects units that is a string rather than an object", () => {
    rejects(
      { schema: 1, updatedAt: "t", units: "no" },
      "history field units is missing or not an object",
    );
  });

  test("rejects an entry that is a string rather than an object", () => {
    rejects(
      { schema: 1, updatedAt: "t", units: { shell: ["no"] } },
      "history field units.shell[0] is not an object",
    );
  });

  test("rejects a unit that is a string rather than an object", () => {
    rejects(
      { schema: 1, updatedAt: "t", units: { shell: [{ unit: "no", contracts: [] }] } },
      "history field units.shell[0].unit is not an object",
    );
  });

  // null is an object to typeof, so it is the case the first half of the guard
  // has to catch on its own.
  test("rejects a unit that is null", () => {
    rejects(
      { schema: 1, updatedAt: "t", units: { shell: [{ unit: null, contracts: [] }] } },
      "history field units.shell[0].unit is not an object",
    );
  });

  test("rejects a unit whose entries are not an array", () => {
    rejects(
      { schema: 1, updatedAt: "t", units: { shell: {} } },
      "history field units.shell is not an array",
    );
  });

  test("rejects an entry that is not an object", () => {
    rejects(
      { schema: 1, updatedAt: "t", units: { shell: [null] } },
      "history field units.shell[0] is not an object",
    );
  });

  test("rejects an entry carrying no unit", () => {
    rejects(
      { schema: 1, updatedAt: "t", units: { shell: [{ contracts: [] }] } },
      "history field units.shell[0].unit is not an object",
    );
  });

  test("rejects a unit with no id", () => {
    rejects(
      { schema: 1, updatedAt: "t", units: { shell: [{ unit: {}, contracts: [] }] } },
      "history field units.shell[0].unit.unitId is missing or not a string",
    );
  });

  test("rejects contracts that are not an array", () => {
    rejects(
      { schema: 1, updatedAt: "t", units: { alpha: [{ unit: { unitId: "a1" }, contracts: "c1" }] } },
      "history field units.alpha[0].contracts is not an array",
    );
  });

  // The index the failure names is the one an operator has to look at.
  test("names the position of the entry that is wrong", () => {
    rejects(
      {
        schema: 1,
        updatedAt: "t",
        units: { shell: [{ unit: { unitId: "s1" }, contracts: [] }, { unit: {}, contracts: [] }] },
      },
      "history field units.shell[1].unit.unitId is missing or not a string",
    );
  });
});

// §11. The other boundary: the server writes three JSON blocks and the shell
// reads part of them, and the two are separate deploys. Only a running server
// can compare them, so this rule is not in `compositionRefusal`.
describe("the block gate", () => {
  const WRITES = {
    "VersionOption.live": "l1",
    "VersionOption.unitId": "u1",
    "AppAssets.js": "j1",
  };

  test("a shell reading only what this server writes is served", () => {
    expect(blockRefusal(WRITES, { blocks: { "VersionOption.live": "l1" } })).toBeNull();
  });

  test("a field this server does not write refuses, and names it", () => {
    const refusal = blockRefusal(WRITES, { blocks: { "VersionOption.deployed": "d1" } });
    expect(refusal).toContain("VersionOption.deployed");
    expect(refusal).toContain("does not write");
  });

  test("a field this server writes differently refuses", () => {
    const refusal = blockRefusal(WRITES, { blocks: { "VersionOption.live": "l2" } });
    expect(refusal).toContain("writes differently");
  });

  // Every shell published before §11, including the one whose rename
  // demonstrated the problem. It cannot say what it reads, so nothing may be
  // concluded - which is why the renamed field is still written.
  test("a shell that records nothing cannot be judged", () => {
    expect(blockRefusal(WRITES, {})).toBeUndefined();
    expect(blockRefusal(WRITES, undefined)).toBeUndefined();
  });

  test("a server with no reading of its own judges nothing", () => {
    expect(blockRefusal({}, { blocks: { "VersionOption.live": "l1" } })).toContain("does not write");
    expect(blockRefusal({}, {})).toBeUndefined();
  });

  // Two faults reported as two. The separator is what a reader of the header
  // has to split on, and a single toContain cannot see it.
  test("two fields wrong are reported as two", () => {
    expect(
      blockRefusal(WRITES, {
        blocks: { "VersionOption.deployed": "d1", "VersionOption.live": "l2" },
      }),
    ).toBe(
      "that shell reads VersionOption.deployed, which this server does not write; " +
        "that shell reads VersionOption.live, which this server writes differently",
    );
  });

  // The blocks are a surface between the server and the SHELL. A sub-app never
  // reads them, so judging one would grey out an option a promote allows.
  test("only the shell is judged on what this server writes", () => {
    const h: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [
          {
            unit: unit("shell", "s1"),
            contracts: ["c1"],
            surface: { blocks: { "VersionOption.live": "l1" } },
          },
        ],
        alpha: [
          {
            unit: unit("alpha", "a1"),
            contracts: ["c1"],
            surface: { blocks: { "VersionOption.deployed": "d1" } },
          },
        ],
      },
    };
    const chosen = { shell: "s1", alpha: "a1" };
    const options = optionsFor(h, chosen, chosen, WRITES);
    expect(options.shell![0]!.disabled).toBe(false);
    expect(options.alpha![0]!.disabled).toBe(false);
  });

  test("the switcher greys out a shell this server cannot feed", () => {
    const history: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [
          { unit: unit("shell", "s2"), contracts: ["c1"], surface: { blocks: { "VersionOption.live": "l1" } } },
          { unit: unit("shell", "s1"), contracts: ["c1"], surface: { blocks: { "VersionOption.deployed": "d1" } } },
          { unit: unit("shell", "s0"), contracts: ["c1"] },
        ],
      },
    };
    const options = optionsFor(history, { shell: "s2" }, { shell: "s2" }, WRITES);
    const by = (id: string) => options.shell!.find((o) => o.unitId === id)!;
    expect(by("s2").disabled).toBe(false);
    expect(by("s1").disabled).toBe(true);
    // Records nothing, so it is offered: the append-only rule is what protects
    // this one, and a guess would take away a rollback that works.
    expect(by("s0").disabled).toBe(false);
  });
});

describe("parseHistory carries the member reading", () => {
  test("keeps a surface when the entry has one", () => {
    const parsed = parseHistory({
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [
          {
            unit: { unitId: "s1" },
            contracts: ["c1"],
            surface: { provides: { "ShellStore.user": "u1" }, subapps: ["sub1"] },
          },
        ],
      },
    });
    expect(parsed.units.shell![0]!.surface).toEqual({
      provides: { "ShellStore.user": "u1" },
      subapps: ["sub1"],
    });
  });

  test("leaves it absent when the entry has none", () => {
    const parsed = parseHistory({
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: { shell: [{ unit: { unitId: "s1" }, contracts: ["c1"] }] },
    });
    expect(parsed.units.shell![0]!.surface).toBeUndefined();
  });

  // A reading that is not an object is worth nothing and must not be carried
  // as though it were: every reader indexes into it, and a string would answer
  // every lookup with undefined - which reads as "records nothing" and allows
  // what the gate exists to refuse.
  test("a surface that is not an object is dropped", () => {
    const parsed = parseHistory({
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: { shell: [{ unit: { unitId: "s1" }, contracts: ["c1"], surface: "nope" }] },
    });
    expect(parsed.units.shell![0]!.surface).toBeUndefined();
  });

  test("surfaceOf reads the id it was asked for", () => {
    const h: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [
          { unit: unit("shell", "s2"), contracts: ["c1"], surface: { subapps: ["sub2"] } },
          { unit: unit("shell", "s1"), contracts: ["c1"], surface: { subapps: ["sub1"] } },
        ],
      },
    };
    expect(surfaceOf(h, "shell", "s1")).toEqual({ subapps: ["sub1"] });
    expect(surfaceOf(h, "shell", "s9")).toBeUndefined();
    expect(surfaceOf(h, "alpha", "a1")).toBeUndefined();
  });
});

describe("optionsFor", () => {
  test("marks what the page shows and what the channel serves now", () => {
    const options = optionsFor(history, served, served);
    expect(options.shell?.map((o) => [o.unitId, o.current, o.live])).toEqual([
      ["s1", true, true],
      ["s0", false, false],
    ]);
  });

  // The two differ the moment a visitor chooses something, and the shell needs
  // both: choosing the live id clears the override rather than pinning it.
  test("current and live separate once a choice is made", () => {
    const options = optionsFor(history, { ...served, shell: "s0" }, served);
    expect(options.shell?.map((o) => [o.unitId, o.current, o.live])).toEqual([
      ["s1", false, true],
      ["s0", true, false],
    ]);
  });

  // s0 supports c1 alone, and alpha a1 supports c2 alone, so that pair has no
  // contract in common and the older shell cannot be chosen beside it.
  test("disables an option that leaves no shared contract", () => {
    const options = optionsFor(history, served, served);
    expect(options.shell?.map((o) => [o.unitId, o.disabled])).toEqual([
      ["s1", false],
      ["s0", true],
    ]);
  });

  // The same option, against a different rest of the composition. Rolling alpha
  // back to a0 first makes the older shell selectable, which is the whole point
  // of computing this against what is chosen rather than against what is live.
  test("the same option is allowed once the rest of the composition moves", () => {
    const options = optionsFor(history, { ...served, alpha: "a0" }, served);
    expect(options.shell?.map((o) => [o.unitId, o.disabled])).toEqual([
      ["s1", false],
      ["s0", false],
    ]);
  });

  // A composition published before markers reached a unit carries none, and a
  // switcher that printed "undefined" beside an id would read as a build fault.
  test("an entry with no marker reads as no marker", () => {
    const bare = {
      schema: 1 as const,
      updatedAt: "t",
      units: { shell: [{ unit: { ...unit("shell", "s1"), marker: undefined } as unknown as ComposedUnit, contracts: ["c2"] }] },
    };
    expect(optionsFor(bare, { shell: "s1" }, { shell: "s1" }).shell?.[0]?.marker).toBe("");
  });

  // Retained for a shell published before the rename. That shell reads
  // `deployed`, it is still in qa's history, and the switcher offers it - so
  // dropping the field makes a rollback target quietly do the wrong thing.
  test("carries the old name of live, with the same value", () => {
    for (const o of optionsFor(history, { ...served, shell: "s0" }, served).shell ?? []) {
      expect(`${o.unitId} deployed=${o.deployed}`).toBe(`${o.unitId} deployed=${o.live}`);
    }
    expect(optionsFor(history, served, served).shell?.[0]?.deployed).toBe(true);
    expect(optionsFor(history, served, served).shell?.[1]?.deployed).toBe(false);
  });

  test("carries the marker a build was labelled with", () => {
    const marked: ChannelHistory = {
      ...history,
      units: { shell: [{ unit: unit("shell", "s1", { marker: "beta" }), contracts: ["c2"] }] },
    };
    expect(optionsFor(marked, { shell: "s1" }, { shell: "s1" }).shell?.[0]?.marker).toBe("beta");
  });

  test("an id the history does not hold supports nothing, so every option is refused", () => {
    const options = optionsFor(history, { ...served, alpha: "gone" }, served);
    expect(options.shell?.every((o) => o.disabled)).toBe(true);
  });

  test("a history naming no units offers nothing", () => {
    expect(optionsFor({ schema: 1, updatedAt: "t", units: {} }, served, served)).toEqual({});
  });
});

describe("refuseComposition", () => {
  test("allows what the channel serves", () => {
    expect(refuseComposition(history, served)).toBeNull();
  });

  test("allows an older unit the rest can be composed with", () => {
    expect(refuseComposition(history, { ...served, alpha: "a0" })).toBeNull();
  });

  // The refusal that matters. Without it the query string is a way to make this
  // origin serve any object in the store.
  test("refuses an id this channel has never served", () => {
    expect(refuseComposition(history, { ...served, alpha: "0000dead" })).toBe(
      "the alpha unit 0000dead is not one this channel has served",
    );
  });

  test("refuses a unit the history knows nothing about", () => {
    expect(refuseComposition(history, { ...served, charlie: "c1" })).toContain("charlie");
  });

  // The block gate, through the function `promote` and the switcher both
  // call. Reaching it any other way tests blockRefusal and not the refusal.
  test("refuses a chosen shell this server cannot feed, and names the field", () => {
    const h: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [
          {
            unit: unit("shell", "s1"),
            contracts: ["c1"],
            surface: { blocks: { "VersionOption.deployed": "d1" } },
          },
        ],
      },
    };
    expect(refuseComposition(h, { shell: "s1" }, { "VersionOption.live": "l1" })).toBe(
      "that shell reads VersionOption.deployed, which this server does not write",
    );
    // The same composition, judged by a server that writes what it reads.
    expect(refuseComposition(h, { shell: "s1" }, { "VersionOption.deployed": "d1" })).toBeNull();
  });

  test("refuses a composition with no contract in common", () => {
    expect(refuseComposition(history, { ...served, shell: "s0" })).toBe(
      "no contract is supported by every unit in that composition",
    );
  });
});


// §9. The gate an operator actually needs: does this app need anything this
// shell does not have. The contract sets below are DISJOINT throughout, which
// is the state a published app reaches the moment a contract is minted after
// it - and the old rule refused every one of these.
describe("the member gate", () => {
  const HALF = "sub1";

  const shell = (provides: Record<string, string>, subapps = [HALF]): UnitSurface => ({
    provides,
    subapps,
  });
  const app = (uses: Record<string, string>, subapps = [HALF]): UnitSurface => ({ uses, subapps });

  /** Eight members, of which alpha calls three and bravo calls four. */
  const FULL = {
    "ShellStore.user": "u1",
    "ShellStore.register": "r1",
    "ShellStore.increment": "i1",
    "ShellStore.countOf": "c1",
    "ShellStore.reset": "x1",
    "ShellStore.setName": "n1",
    "ShellStore.setColour": "o1",
    "ShellStore.snapshot": "s1",
  };
  const ALPHA = { "ShellStore.user": "u1", "ShellStore.register": "r1", "ShellStore.increment": "i1" };
  const BRAVO = { ...ALPHA, "ShellStore.reset": "x1" };

  const DISJOINT = { shell: ["c9"], alpha: ["c1"], bravo: ["c1"] };
  const surfaces = (provides: Record<string, string>) => ({
    shell: shell(provides),
    alpha: app(ALPHA),
    bravo: app(BRAVO),
  });

  test("a member added changes nothing", () => {
    const grown = { ...FULL, "ShellStore.clear": "z1" };
    expect(compositionRefusal(DISJOINT, surfaces(grown))).toBeNull();
  });

  test("a member removed that no app uses changes nothing", () => {
    const { "ShellStore.setName": _gone, ...smaller } = FULL;
    expect(compositionRefusal(DISJOINT, surfaces(smaller))).toBeNull();
  });

  test("a member removed that one app uses refuses, and names both", () => {
    const { "ShellStore.reset": _gone, ...smaller } = FULL;
    const refusal = compositionRefusal(DISJOINT, surfaces(smaller));
    expect(refusal).toContain("bravo");
    expect(refusal).toContain("ShellStore.reset");
    expect(refusal).not.toContain("alpha");
  });

  // The case a list of member NAMES would miss. A narrowed parameter keeps the
  // name and changes the declaration, so the digest moves.
  test("a re-declared member refuses only the apps that name it", () => {
    const narrowed = { ...FULL, "ShellStore.reset": "x2" };
    const refusal = compositionRefusal(DISJOINT, surfaces(narrowed));
    expect(refusal).toContain("bravo");
    expect(refusal).toContain("declares differently");
    expect(refusal).not.toContain("alpha");
  });

  test("a re-declared member no app uses changes nothing", () => {
    expect(compositionRefusal(DISJOINT, surfaces({ ...FULL, "ShellStore.setName": "n2" }))).toBeNull();
  });

  // The half a sub-app PRODUCES. Nothing about `uses` can see it, because the
  // shell requires all of it rather than part of it.
  test("a different SubApp half refuses even when every member fits", () => {
    const refusal = compositionRefusal(DISJOINT, {
      shell: shell(FULL, ["sub2"]),
      alpha: app(ALPHA),
      bravo: app(BRAVO),
    });
    expect(refusal).toContain("alpha");
    expect(refusal).toContain("SubApp");
  });

  test("the contract sets decide when the shell carries no reading", () => {
    expect(compositionRefusal(DISJOINT, { shell: {}, alpha: app(ALPHA), bravo: app(BRAVO) })).toBe(
      "no contract is supported by every unit in that composition",
    );
  });

  // Rolling back onto a unit published before any of this existed has to go on
  // working, and it is judged the only way it can be.
  test("an app with no reading falls back to the contract sets", () => {
    const mixed = { shell: shell(FULL), alpha: app(ALPHA), bravo: undefined };
    expect(compositionRefusal({ shell: ["c9"], alpha: ["c1"], bravo: ["c9"] }, mixed)).toBeNull();
    expect(compositionRefusal(DISJOINT, mixed)).toBe(
      "no contract is supported by every unit in that composition",
    );
  });

  test("memberRefusal cannot answer without both sides", () => {
    expect(memberRefusal({ shell: shell(FULL) })).toBeUndefined();
    expect(memberRefusal({ shell: {}, alpha: app(ALPHA) })).toBeUndefined();
    expect(memberRefusal({ shell: shell(FULL), alpha: app(ALPHA) })).toBeNull();
  });

  // Half a reading is not a reading. Without the first check the second half
  // is read anyway, and `shellHalves.includes` is called on nothing.
  test("a shell recording only half of its own surface cannot answer", () => {
    expect(memberRefusal({ shell: { provides: FULL }, alpha: app(ALPHA) })).toBeUndefined();
    expect(memberRefusal({ shell: { subapps: [HALF] }, alpha: app(ALPHA) })).toBeUndefined();
  });

  // The rollback case, from the other side: an entry the history carries with
  // no surface at all, beside one that has it.
  test("an app with no reading is skipped rather than judged", () => {
    expect(memberRefusal({ shell: shell(FULL), alpha: undefined })).toBeUndefined();
    expect(memberRefusal({ shell: shell(FULL), alpha: undefined, bravo: app(BRAVO) })).toBeNull();
  });

  test("an app that records members but not its SubApp half is skipped", () => {
    expect(memberRefusal({ shell: shell(FULL), alpha: { uses: ALPHA } })).toBeUndefined();
    expect(memberRefusal({ shell: shell(FULL), alpha: { subapps: [HALF] } })).toBeUndefined();
  });

  // Which half of the gate refused, exactly. Both halves name the member, so a
  // toContain on the name passes when the wrong branch fires - which is how a
  // mutation of this line went unnoticed until 2026-08-29.
  test("a member the shell does not have is named as missing, not as changed", () => {
    const { "ShellStore.reset": _gone, ...smaller } = FULL;
    expect(memberRefusal({ shell: shell(smaller), bravo: app(BRAVO) })).toBe(
      "bravo uses ShellStore.reset, which this shell does not have",
    );
  });

  // A unit records the half of EVERY contract it compiles against, so carrying
  // more than one is ordinary. Sharing one is the fit; needing all of them
  // would refuse a sub-app that compiles against the shell perfectly well.
  test("one SubApp half in common is enough", () => {
    expect(
      memberRefusal({
        shell: shell(FULL, ["sub1", "sub2"]),
        alpha: app(ALPHA, ["sub2", "sub3"]),
      }),
    ).toBeNull();
  });

  test("two problems are reported as two", () => {
    const { "ShellStore.reset": _gone, ...smaller } = FULL;
    expect(memberRefusal({ shell: shell(smaller, ["sub2"]), bravo: app(BRAVO) })).toBe(
      "bravo uses ShellStore.reset, which this shell does not have; " +
        "bravo was built against a different SubApp type",
    );
  });

  // Every app judged on members leaves the shell alone in the contract half,
  // and a shell that shares nothing with itself is not a refusal. The guard
  // that makes this pass is the one the comment beside it argues for.
  test("a shell alone in the contract half is not refused for sharing nothing", () => {
    expect(
      compositionRefusal({ shell: [], alpha: ["c1"] }, { shell: shell(FULL), alpha: app(ALPHA) }),
    ).toBeNull();
  });

  test("decidesMembers needs all four fields", () => {
    expect(decidesMembers(shell(FULL), app(ALPHA))).toBe(true);
    expect(decidesMembers({ provides: FULL }, app(ALPHA))).toBe(false);
    expect(decidesMembers(shell(FULL), { uses: ALPHA })).toBe(false);
    expect(decidesMembers(undefined, app(ALPHA))).toBe(false);
  });

  // The switcher greys an option out with the rule `promote` refuses on. If the
  // two ever part, the control lies about what an operator could deploy.
  test("the switcher offers what promote would allow", () => {
    const { "ShellStore.setName": _gone, ...smaller } = FULL;
    const withSurfaces: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [
          { unit: unit("shell", "s2"), contracts: ["c9"], surface: shell(smaller) },
          { unit: unit("shell", "s1"), contracts: ["c1"], surface: shell(FULL) },
        ],
        bravo: [{ unit: unit("bravo", "b0"), contracts: ["c1"], surface: app(BRAVO) }],
      },
    };
    const options = optionsFor(withSurfaces, { shell: "s2", bravo: "b0" }, { shell: "s2", bravo: "b0" });
    // b0 uses reset, s2 still has it, and their contract sets share nothing.
    expect(options.shell!.find((o) => o.unitId === "s2")!.disabled).toBe(false);
    expect(options.shell!.find((o) => o.unitId === "s1")!.disabled).toBe(false);
  });

  test("the switcher greys out a shell that dropped a member in use", () => {
    const { "ShellStore.reset": _gone, ...noReset } = FULL;
    const withSurfaces: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [
          { unit: unit("shell", "s2"), contracts: ["c9"], surface: shell(noReset) },
          { unit: unit("shell", "s1"), contracts: ["c9"], surface: shell(FULL) },
        ],
        bravo: [{ unit: unit("bravo", "b0"), contracts: ["c9"], surface: app(BRAVO) }],
      },
    };
    const options = optionsFor(withSurfaces, { shell: "s1", bravo: "b0" }, { shell: "s1", bravo: "b0" });
    expect(options.shell!.find((o) => o.unitId === "s2")!.disabled).toBe(true);
    expect(options.shell!.find((o) => o.unitId === "s1")!.disabled).toBe(false);
  });
});

describe("compose", () => {
  test("substitutes the shell and keeps every app", () => {
    const out = compose(manifest, history, { ...served, shell: "s0" });
    expect(out.shell.unitId).toBe("s0");
    expect(out.apps.alpha?.unitId).toBe("a1");
    expect(out.apps.bravo?.unitId).toBe("b1");
  });

  test("substitutes one app and leaves the others where they were", () => {
    const out = compose(manifest, history, { ...served, alpha: "a0" });
    expect(out.apps.alpha?.unitId).toBe("a0");
    expect(out.apps.alpha?.assetBase).toBe("https://store.test/units/alpha/a0/");
    expect(out.apps.bravo?.unitId).toBe("b1");
    expect(out.shell.unitId).toBe("s1");
  });

  // The contract a composition resolves at is a property of the composition and
  // not of the pointer, so choosing an older unit has to recompute it.
  test("recomputes the contract for what was chosen", () => {
    expect(compose(manifest, history, { ...served, alpha: "a0" }).contract).toBe("c2");
    expect(compose(manifest, history, { shell: "s0", alpha: "a0", bravo: "b1" }).contract).toBe("c1");
  });

  test("keeps the base's contract when the choice resolves at none", () => {
    expect(compose(manifest, history, { ...served, shell: "s0" }).contract).toBe("c2");
  });

  test("keeps the base's unit when the history does not hold the id", () => {
    const out = compose(manifest, history, { shell: "gone", alpha: "gone", bravo: "b1" });
    expect(out.shell.unitId).toBe("s1");
    expect(out.apps.alpha?.unitId).toBe("a1");
  });

  // A unit this channel has no history for at all, which is not the same as an
  // id it does not hold. The lookup has to answer rather than throw.
  test("a unit the history never names leaves the composition alone", () => {
    const out = compose(manifest, history, { ...served, charlie: "c9" });
    expect(out.apps.charlie).toBeUndefined();
    expect(out.apps.alpha?.unitId).toBe("a1");
    expect(out.shell.unitId).toBe("s1");
  });

  test("choosing nothing changes nothing", () => {
    expect(compose(manifest, history, served)).toEqual({ ...manifest, contract: "c2" });
  });

  test("everything else about the manifest survives", () => {
    const out = compose(manifest, history, { ...served, alpha: "a0" });
    expect(out.schema).toBe(3);
    expect(out.composedAt).toBe("2026-08-28T00:00:00.000Z");
    expect(out.shell.imports).toEqual({ preact: "preact-a.js" });
  });
});

test("the depth a channel keeps is stated once", () => {
  expect(HISTORY_DEPTH).toBe(20);
});
