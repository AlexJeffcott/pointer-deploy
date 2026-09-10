import { describe, expect, test } from "bun:test";
import {
  HISTORY_DEPTH,
  apiRefusal,
  blockRefusal,
  chooseContract,
  compose,
  compositionRefusal,
  currentIds,
  decidesMembers,
  catalogueUrl,
  historyUrl,
  memberRefusal,
  mergeKnown,
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

  test("reports in the shell's order", () => {
    expect(sharedContracts({ shell: ["c1", "c2"], alpha: ["c2", "c1"] })).toEqual(["c1", "c2"]);
  });

  test("a unit that supports nothing empties the set", () => {
    expect(sharedContracts({ shell: ["c1", "c2"], alpha: [] })).toEqual([]);
  });

  test("a shell that supports nothing empties the set", () => {
    expect(sharedContracts({ alpha: ["c1"] })).toEqual([]);
  });

  test("a composition of no units shares nothing", () => {
    expect(sharedContracts({})).toEqual([]);
  });
});

describe("chooseContract", () => {
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

describe("the block gate", () => {
  const WRITES = {
    "BuildInfo.channel": "l1",
    "BuildInfo.buildId": "u1",
    "AppAssets.js": "j1",
  };

  test("a shell reading only what this server writes is served", () => {
    expect(blockRefusal(WRITES, { blocks: { "BuildInfo.channel": "l1" } })).toBeNull();
  });

  test("a field this server does not write refuses, and names it", () => {
    const refusal = blockRefusal(WRITES, { blocks: { "BuildInfo.region": "d1" } });
    expect(refusal).toContain("BuildInfo.region");
    expect(refusal).toContain("does not write");
  });

  test("a field this server writes differently refuses", () => {
    const refusal = blockRefusal(WRITES, { blocks: { "BuildInfo.channel": "l2" } });
    expect(refusal).toContain("writes differently");
  });

  test("a shell that records nothing cannot be judged", () => {
    expect(blockRefusal(WRITES, {})).toBeUndefined();
    expect(blockRefusal(WRITES, undefined)).toBeUndefined();
  });

  test("a server with no reading of its own judges nothing", () => {
    expect(blockRefusal({}, { blocks: { "BuildInfo.channel": "l1" } })).toContain("does not write");
    expect(blockRefusal({}, {})).toBeUndefined();
  });

  test("two fields wrong are reported as two", () => {
    expect(
      blockRefusal(WRITES, {
        blocks: { "BuildInfo.region": "d1", "BuildInfo.channel": "l2" },
      }),
    ).toBe(
      "that shell reads BuildInfo.region, which this server does not write; " +
        "that shell reads BuildInfo.channel, which this server writes differently",
    );
  });

  test("only the shell is judged on what this server writes", () => {
    const h: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [
          {
            unit: unit("shell", "s1"),
            contracts: ["c1"],
            surface: { blocks: { "BuildInfo.channel": "l1" } },
          },
        ],
        alpha: [
          {
            unit: unit("alpha", "a1"),
            contracts: ["c1"],
            surface: { blocks: { "BuildInfo.region": "d1" } },
          },
        ],
      },
    };
    expect(refuseComposition(h, { shell: "s1", alpha: "a1" }, WRITES)).toBeNull();
  });

});

describe("the API gate", () => {
  const shell = (api: string[]) => ({ api });

  test("a shell calling a version the service answers is served", () => {
    expect(apiRefusal(["v1"], shell(["v1"]))).toBeNull();
    expect(apiRefusal(["v1", "v2"], shell(["v1"]))).toBeNull();
  });

  test("a version the service does not answer refuses, and names it", () => {
    expect(apiRefusal(["v2"], shell(["v1"]))).toBe(
      "that shell calls API v1, which the service does not answer",
    );
  });

  test("every version missing is named, not just the first", () => {
    expect(apiRefusal(["v9"], shell(["v1", "v2"]))).toContain("v1, v2");
  });

  test("a service answering no version at all still decides", () => {
    expect(apiRefusal([], shell(["v1"]))).toContain("does not answer");
  });

  test("nothing can be decided without both sides", () => {
    expect(apiRefusal(["v1"], {})).toBeUndefined();
    expect(apiRefusal(["v1"], undefined)).toBeUndefined();
    expect(apiRefusal(undefined, shell(["v1"]))).toBeUndefined();
    expect(apiRefusal(undefined, undefined)).toBeUndefined();
  });

  test("only the shell is judged on the API", () => {
    const h: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [{ unit: unit("shell", "s1"), contracts: ["c1"], surface: { api: ["v1"] } }],
        alpha: [{ unit: unit("alpha", "a1"), contracts: ["c1"], surface: { api: ["v9"] } }],
      },
    };
    expect(refuseComposition(h, { shell: "s1", alpha: "a1" }, {}, ["v1"])).toBeNull();
  });

  test("refuseComposition refuses a chosen shell the service cannot feed", () => {
    const h: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [{ unit: unit("shell", "s1"), contracts: ["c1"], surface: { api: ["v1"] } }],
      },
    };
    expect(refuseComposition(h, { shell: "s1" }, {}, ["v2"])).toBe(
      "that shell calls API v1, which the service does not answer",
    );
    expect(refuseComposition(h, { shell: "s1" }, {}, ["v1"])).toBeNull();
    expect(refuseComposition(h, { shell: "s1" }, {})).toBeNull();
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

describe("refuseComposition", () => {
  test("allows what the channel serves", () => {
    expect(refuseComposition(history, served)).toBeNull();
  });

  test("allows an older unit the rest can be composed with", () => {
    expect(refuseComposition(history, { ...served, alpha: "a0" })).toBeNull();
  });

  test("refuses an id this channel has never served", () => {
    expect(refuseComposition(history, { ...served, alpha: "0000dead" })).toBe(
      "the alpha unit 0000dead is not one this channel can serve",
    );
  });

  test("refuses a unit the history knows nothing about", () => {
    expect(refuseComposition(history, { ...served, charlie: "c1" })).toContain("charlie");
  });

  test("refuses a chosen shell this server cannot feed, and names the field", () => {
    const h: ChannelHistory = {
      schema: 1,
      updatedAt: "2026-08-29T00:00:00.000Z",
      units: {
        shell: [
          {
            unit: unit("shell", "s1"),
            contracts: ["c1"],
            surface: { blocks: { "BuildInfo.region": "d1" } },
          },
        ],
      },
    };
    expect(refuseComposition(h, { shell: "s1" }, { "BuildInfo.channel": "l1" })).toBe(
      "that shell reads BuildInfo.region, which this server does not write",
    );
    expect(refuseComposition(h, { shell: "s1" }, { "BuildInfo.region": "d1" })).toBeNull();
  });

  test("refuses a composition with no contract in common", () => {
    expect(refuseComposition(history, { ...served, shell: "s0" })).toBe(
      "no contract is supported by every unit in that composition",
    );
  });
});

describe("the member gate", () => {
  const HALF = "sub1";

  const shell = (provides: Record<string, string>, subapps = [HALF]): UnitSurface => ({
    provides,
    subapps,
  });
  const app = (uses: Record<string, string>, subapps = [HALF]): UnitSurface => ({ uses, subapps });

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

  test("a shell recording only half of its own surface cannot answer", () => {
    expect(memberRefusal({ shell: { provides: FULL }, alpha: app(ALPHA) })).toBeUndefined();
    expect(memberRefusal({ shell: { subapps: [HALF] }, alpha: app(ALPHA) })).toBeUndefined();
  });

  test("an app with no reading is skipped rather than judged", () => {
    expect(memberRefusal({ shell: shell(FULL), alpha: undefined })).toBeUndefined();
    expect(memberRefusal({ shell: shell(FULL), alpha: undefined, bravo: app(BRAVO) })).toBeNull();
  });

  test("an app that records members but not its SubApp half is skipped", () => {
    expect(memberRefusal({ shell: shell(FULL), alpha: { uses: ALPHA } })).toBeUndefined();
    expect(memberRefusal({ shell: shell(FULL), alpha: { subapps: [HALF] } })).toBeUndefined();
  });

  test("a member the shell does not have is named as missing, not as changed", () => {
    const { "ShellStore.reset": _gone, ...smaller } = FULL;
    expect(memberRefusal({ shell: shell(smaller), bravo: app(BRAVO) })).toBe(
      "bravo uses ShellStore.reset, which this shell does not have",
    );
  });

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

describe("catalogueUrl", () => {
  test("sits beside the pointers, one prefix over", () => {
    expect(catalogueUrl("https://s.test/manifests")).toBe("https://s.test/units/catalogue.json");
    expect(catalogueUrl("https://s.test/manifests/")).toBe("https://s.test/units/catalogue.json");
  });

  test("keeps a prefix the bucket is nested under", () => {
    expect(catalogueUrl("https://s.test/a/b/manifests")).toBe(
      "https://s.test/a/b/units/catalogue.json",
    );
  });
});

describe("mergeKnown", () => {
  const catalogue: ChannelHistory = {
    schema: 1,
    updatedAt: "2026-08-31T00:00:00.000Z",
    units: {
      alpha: [
        { unit: unit("alpha", "a9"), contracts: ["c2"], publishedAt: "2026-08-31T00:00:00.000Z" },
        { unit: unit("alpha", "a1"), contracts: ["c9"], publishedAt: "2026-08-01T00:00:00.000Z" },
      ],
      charlie: [{ unit: unit("charlie", "c1"), contracts: ["c2"] }],
    },
  };

  test("adds a published build this channel has never served", () => {
    const merged = mergeKnown(history, catalogue);
    expect(merged.units.alpha?.map((e) => e.unit.unitId)).toEqual(["a1", "a0", "a9"]);
  });

  test("adds a unit the channel has no history for at all", () => {
    expect(mergeKnown(history, catalogue).units.charlie?.map((e) => e.unit.unitId)).toEqual(["c1"]);
  });

  test("what the channel served wins, because only it knows the order and the stamps", () => {
    const merged = mergeKnown(history, catalogue);
    expect(merged.units.alpha?.find((e) => e.unit.unitId === "a1")?.contracts).toEqual(["c2"]);
  });

  test("keeps every unit the channel has served", () => {
    const merged = mergeKnown(history, catalogue);
    expect(merged.units.shell?.map((e) => e.unit.unitId)).toEqual(["s1", "s0"]);
    expect(merged.units.bravo?.map((e) => e.unit.unitId)).toEqual(["b1"]);
  });

  test("no catalogue leaves the channel exactly as it was", () => {
    expect(mergeKnown(history, null)).toBe(history);
  });

  test("a real channel is offered no build the harness made", () => {
    const withHarness: ChannelHistory = {
      schema: 1,
      updatedAt: "t",
      units: { alpha: [{ unit: unit("alpha", "a7", { marker: "e2e" }), contracts: ["c2"] }] },
    };
    expect(mergeKnown(history, withHarness).units.alpha?.map((e) => e.unit.unitId)).toEqual([
      "a1",
      "a0",
    ]);
  });

  test("the suite's own channels are, because that is where the suite promotes", () => {
    const withHarness: ChannelHistory = {
      schema: 1,
      updatedAt: "t",
      units: { alpha: [{ unit: unit("alpha", "a7", { marker: "e2e" }), contracts: ["c2"] }] },
    };
    expect(mergeKnown(history, withHarness, true).units.alpha?.map((e) => e.unit.unitId)).toEqual([
      "a1",
      "a0",
      "a7",
    ]);
  });

  test("a marked build the channel already served stays, whatever the channel is", () => {
    const served: ChannelHistory = {
      schema: 1,
      updatedAt: "t",
      units: { alpha: [{ unit: unit("alpha", "a7", { marker: "e2e" }), contracts: ["c2"] }] },
    };
    expect(mergeKnown(served, { schema: 1, updatedAt: "t", units: {} }).units.alpha).toHaveLength(1);
  });

  test("a composition is judged the same whichever side an entry came from", () => {
    const merged = mergeKnown(history, catalogue);
    expect(refuseComposition(merged, { shell: "s1", alpha: "a9", bravo: "b1" })).toBeNull();
    expect(compose(manifest, merged, { shell: "s1", alpha: "a9", bravo: "b1" }).apps.alpha?.unitId).toBe(
      "a9",
    );
  });

});

describe("parseHistory of a catalogue", () => {
  test("keeps when a unit was published and whether the tree was dirty", () => {
    const parsed = parseHistory({
      schema: 1,
      updatedAt: "t",
      units: {
        alpha: [
          {
            unit: { unitId: "a1" },
            contracts: [],
            publishedAt: "2026-08-01T00:00:00.000Z",
            dirty: true,
          },
        ],
      },
    });
    expect(parsed.units.alpha?.[0]?.publishedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(parsed.units.alpha?.[0]?.dirty).toBe(true);
  });

  test("a history that records neither carries neither", () => {
    const parsed = parseHistory({
      schema: 1,
      updatedAt: "t",
      units: { alpha: [{ unit: { unitId: "a1" }, contracts: [] }] },
    });
    expect(parsed.units.alpha?.[0]).not.toHaveProperty("publishedAt");
    expect(parsed.units.alpha?.[0]).not.toHaveProperty("dirty");
  });
});
