import { describe, expect, test } from "bun:test";
import {
  HISTORY_DEPTH,
  chooseContract,
  compose,
  currentIds,
  historyUrl,
  optionsFor,
  parseHistory,
  refuseComposition,
  sharedContracts,
  type ChannelHistory,
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

  test("refuses a composition with no contract in common", () => {
    expect(refuseComposition(history, { ...served, shell: "s0" })).toBe(
      "no contract is supported by every unit in that composition",
    );
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
