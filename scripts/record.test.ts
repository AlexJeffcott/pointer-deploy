import { expect, test, describe } from "bun:test";
import {
  describeIds,
  fillBody,
  idsOf,
  outRefusal,
  overrideRefusal,
  pointerIds,
  routeRows,
  sameIds,
  staleRefusal,
  type ShotEntry,
} from "./record.ts";

const shot = (route: string, title = route): ShotEntry => ({
  route,
  file: `${route.replace(/^\//, "") || "root"}.png`,
  title,
  units: { shell: "aaaa", hello: "bbbb" },
  panelErrors: [],
  waitedMs: 1,
});

describe("idsOf", () => {
  test("takes the id and drops the commit and the marker", () => {
    expect(
      idsOf({
        channel: "qa",
        region: "eu",
        units: { shell: { unitId: "a1", commit: "c", marker: "" } },
      }),
    ).toEqual({ shell: "a1" });
  });

  test("a block with no units is no ids, not a throw", () => {
    expect(idsOf({ channel: "qa", region: "eu" })).toEqual({});
  });
});

describe("sameIds", () => {
  test("equal", () => {
    expect(sameIds({ a: "1", b: "2" }, { b: "2", a: "1" })).toBe(true);
  });

  test("one id moved", () => {
    expect(sameIds({ a: "1" }, { a: "2" })).toBe(false);
  });

  // The union, not one side's keys. A composition that GAINED a unit is a
  // different composition, and comparing only the left side would miss it -
  // which is the shape a new sub-app arrives in.
  test("a unit only the right side has", () => {
    expect(sameIds({ shell: "1" }, { shell: "1", board: "9" })).toBe(false);
  });

  test("a unit only the left side has", () => {
    expect(sameIds({ shell: "1", board: "9" }, { shell: "1" })).toBe(false);
  });

  test("two empty sets", () => {
    expect(sameIds({}, {})).toBe(true);
  });
});

describe("describeIds", () => {
  test("sorted by name, so two readings of one composition read the same", () => {
    expect(describeIds({ shell: "s1", hello: "h1" })).toBe("hello=h1 shell=s1");
  });
});

describe("pointerIds", () => {
  test("reads the shell and every app", () => {
    expect(
      pointerIds({ shell: { unitId: "s1" }, apps: { hello: { unitId: "h1" } } }),
    ).toEqual({ shell: "s1", hello: "h1" });
  });

  test("a manifest with no shell is null rather than an empty composition", () => {
    expect(pointerIds({ apps: {} })).toBeNull();
  });

  test("not an object", () => {
    expect(pointerIds("nope")).toBeNull();
    expect(pointerIds(null)).toBeNull();
  });
});

describe("overrideRefusal", () => {
  test("a unit the channel composes is allowed", () => {
    expect(overrideRefusal({ hello: "x" }, { shell: "s", hello: "h" }, "qa")).toBeNull();
  });

  // The origin replaces only a unit the query string names and IGNORES a name
  // it does not compose, so this would have served the channel's own page and
  // filed it as a preview of something else.
  test("a name the channel does not compose is refused, and named", () => {
    const refusal = overrideRefusal({ board: "x" }, { shell: "s", hello: "h" }, "qa");
    expect(refusal).toContain("board");
    expect(refusal).toContain("filed it as a preview");
  });

  test("no override at all", () => {
    expect(overrideRefusal({}, { shell: "s" }, "qa")).toBeNull();
  });
});

describe("outRefusal", () => {
  test("a deploy record in deploys/", () => {
    expect(outRefusal("deploys/2026-09-10T00-00-00Z-qa", "deploy")).toBeNull();
  });

  test("a preview in previews/", () => {
    expect(outRefusal("previews/pr-2", "preview")).toBeNull();
  });

  // The directory WAS the whole distinction between what was served and what
  // was not, and --out crossed it in silence.
  test("a preview asked to land in the archive of what was served", () => {
    expect(outRefusal("deploys/anything", "preview")).toContain("nobody promoted");
  });

  test("a deploy record asked to land in previews/", () => {
    expect(outRefusal("previews/pr-2", "deploy")).toContain("WOULD serve");
  });

  test("a leading ./ does not get past it", () => {
    expect(outRefusal("./deploys/x", "preview")).not.toBeNull();
  });

  test("any other directory is the operator's business", () => {
    expect(outRefusal("/tmp/scratch", "preview")).toBeNull();
  });
});

describe("routeRows", () => {
  const prod = [shot("/", "Hello"), shot("/service", "Service")];

  test("no preview: every route is one row, and nothing reads as changed", () => {
    const rows = routeRows(prod, null);
    expect(rows.map((r) => r.route)).toEqual(["/", "/service"]);
    expect(rows.every((r) => r.state === "both")).toBe(true);
    expect(rows.every((r) => r.preview === null)).toBe(true);
  });

  // The table used to iterate the PRODUCTION record's routes, so the pull
  // request whose whole subject is a new view showed no picture of it.
  test("a route this branch adds gets a row", () => {
    const rows = routeRows(prod, [...prod, shot("/board", "Board")]);
    const added = rows.find((r) => r.route === "/board");
    expect(added?.state).toBe("added");
    expect(added?.title).toBe("Board");
    expect(added?.prod).toBeNull();
  });

  test("a route this branch removes reads as removed, not as unchanged", () => {
    const rows = routeRows(prod, [shot("/", "Hello")]);
    expect(rows.find((r) => r.route === "/service")?.state).toBe("removed");
  });

  test("a route both have", () => {
    const rows = routeRows(prod, prod);
    expect(rows.every((r) => r.state === "both")).toBe(true);
  });

  test("rows are sorted, so two runs read the same", () => {
    const rows = routeRows([shot("/service"), shot("/")], null);
    expect(rows.map((r) => r.route)).toEqual(["/", "/service"]);
  });
});

describe("fillBody", () => {
  const template = "## A\n\n<!--REVIEW: instructions -->\n\n## B\n";

  test("replaces the block and keeps what is around it", () => {
    const out = fillBody(template, "TABLE");
    expect(out).toBe("## A\n\nTABLE\n\n## B\n");
  });

  // Null is the second run on one pull request. The caller has to take this
  // reading BEFORE it publishes: the first version published, committed and
  // pushed, and only then found there was nothing to replace.
  test("a body whose block is already gone", () => {
    expect(fillBody("## A\n\nTABLE\n", "TABLE2")).toBeNull();
  });

  test("an unterminated block", () => {
    expect(fillBody("<!--REVIEW never closed", "TABLE")).toBeNull();
  });
});

describe("staleRefusal", () => {
  const live = { shell: "s1", hello: "h1" };

  test("a record that still names what the channel serves", () => {
    expect(staleRefusal({ channel: "qa", units: live }, "qa", live, "deploys/x")).toBeNull();
  });

  test("no record at all", () => {
    expect(staleRefusal(null, "qa", live, "")).toContain("bun run shoot");
  });

  // §2 makes a prod record possible, and the newest record is then not
  // necessarily this channel's. Comparing its ids would have produced a
  // mismatch message about two compositions that were never comparable.
  test("a record of another channel says so, rather than comparing ids", () => {
    const refusal = staleRefusal({ channel: "prod", units: { shell: "z" } }, "qa", live, "deploys/x");
    expect(refusal).toContain("record of prod");
    expect(refusal).not.toContain("shell=z");
  });

  test("a record whose ids have moved on", () => {
    const refusal = staleRefusal(
      { channel: "qa", units: { shell: "old", hello: "h1" } },
      "qa",
      live,
      "deploys/x",
    );
    expect(refusal).toContain("shell=old");
    expect(refusal).toContain("shell=s1");
  });
});
