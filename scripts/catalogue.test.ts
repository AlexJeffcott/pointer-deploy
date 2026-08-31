import { describe, expect, test } from "bun:test";
import { catalogueFrom, composedUnit, entryOf, surfaceOfManifest, unitNameOf } from "./catalogue.ts";
import type { UnitManifest } from "./publish.ts";

const manifest = (over: Partial<UnitManifest> = {}): UnitManifest => ({
  schema: 3,
  unit: "alpha",
  id: "a1",
  commit: "c".repeat(40),
  dirty: false,
  publishedAt: "2026-08-01T00:00:00.000Z",
  assetBase: "https://store.test/units/alpha/a1/",
  js: "alpha-a1.js",
  css: "alpha-a1.css",
  files: ["alpha-a1.js", "alpha-a1.css"],
  contracts: ["c2"],
  shared: {},
  marker: "",
  ...over,
});

/** What `buildCatalogue` hands the grouping: the unit's name, and its entry. */
const reads = (ms: UnitManifest[]) =>
  ms.map((m) => ({ name: m.unit, entry: entryOf(m, "2026-08-31T00:00:00.000Z") }));

describe("composedUnit", () => {
  test("carries the digests, so a composed page can still check its files", () => {
    const integrity = { "alpha-a1.js": "sha384-x" };
    expect(composedUnit(manifest({ integrity }))).toMatchObject({
      unitId: "a1",
      assetBase: "https://store.test/units/alpha/a1/",
      js: "alpha-a1.js",
      css: "alpha-a1.css",
      integrity,
    });
  });

  test("omits an empty digest map rather than claiming one", () => {
    expect(composedUnit(manifest({ integrity: {} }))).not.toHaveProperty("integrity");
  });

  test("omits imports a unit does not declare", () => {
    expect(composedUnit(manifest())).not.toHaveProperty("imports");
  });
});

describe("surfaceOfManifest", () => {
  test("passes the member reading through, because the gate reads it", () => {
    const uses = { "Store.count": "d1" };
    expect(surfaceOfManifest(manifest({ uses, subapps: ["h1"] }))).toMatchObject({
      uses,
      subapps: ["h1"],
    });
  });
});

describe("entryOf", () => {
  test("records when the unit was published and whether the tree was dirty", () => {
    const e = entryOf(manifest({ dirty: true }), "2026-08-02T00:00:00.000Z");
    expect(e.publishedAt).toBe("2026-08-01T00:00:00.000Z");
    expect(e.dirty).toBe(true);
    expect(e.contracts).toEqual(["c2"]);
    expect(e.recordedAt).toBe("2026-08-02T00:00:00.000Z");
  });
});

describe("unitNameOf", () => {
  test("takes the unit from the key, which is what says which unit it is", () => {
    expect(unitNameOf("units/alpha/a1/unit.json")).toBe("alpha");
  });
});

describe("catalogueFrom", () => {
  test("groups by unit and lists the newest publish first", () => {
    const built = catalogueFrom(reads([
      manifest({ id: "a1", publishedAt: "2026-08-01T00:00:00.000Z" }),
      manifest({ id: "a3", publishedAt: "2026-08-03T00:00:00.000Z" }),
      manifest({ id: "a2", publishedAt: "2026-08-02T00:00:00.000Z" }),
    ]));
    expect(built.catalogue.units.alpha?.map((e) => e.unit.unitId)).toEqual(["a3", "a2", "a1"]);
  });

  test("orders two publishes of the same instant by id, so a rebuild does not reshuffle", () => {
    const at = "2026-08-01T00:00:00.000Z";
    const first = catalogueFrom(reads([
      manifest({ id: "b2", publishedAt: at }),
      manifest({ id: "b1", publishedAt: at }),
    ]));
    const again = catalogueFrom(reads([
      manifest({ id: "b1", publishedAt: at }),
      manifest({ id: "b2", publishedAt: at }),
    ]));
    expect(first.catalogue.units.alpha?.map((e) => e.unit.unitId)).toEqual(["b1", "b2"]);
    expect(again.catalogue.units.alpha?.map((e) => e.unit.unitId)).toEqual(["b1", "b2"]);
  });

  test("lists a build the harness made, and counts it", () => {
    // Whether a channel may SERVE it is `mergeKnown`'s question, not this one.
    const built = catalogueFrom(reads([
      manifest({ id: "a1", publishedAt: "2026-08-01T00:00:00.000Z" }),
      manifest({ id: "a2", marker: "e2e", publishedAt: "2026-08-02T00:00:00.000Z" }),
    ]));
    expect(built.catalogue.units.alpha?.map((e) => e.unit.unitId)).toEqual(["a2", "a1"]);
    expect(built.marked).toBe(1);
  });

  test("leaves out what it could not read, and counts it", () => {
    const built = catalogueFrom([null, ...reads([manifest({ id: "a1" })])]);
    expect(built.unreadable).toBe(1);
    expect(built.catalogue.units.alpha).toHaveLength(1);
  });

  test("puts the shell first, whatever order the store listed", () => {
    const built = catalogueFrom(reads([
      manifest({ unit: "delta", id: "d1" }),
      manifest({ unit: "shell", id: "s1" }),
      manifest({ unit: "alpha", id: "a1" }),
    ]));
    expect(Object.keys(built.catalogue.units)).toEqual(["shell", "alpha", "delta"]);
  });

  test("is a history, so a channel-shaped reader parses it unchanged", () => {
    const built = catalogueFrom(reads([manifest()]));
    expect(built.catalogue.schema).toBe(1);
    expect(typeof built.catalogue.updatedAt).toBe("string");
  });
});
