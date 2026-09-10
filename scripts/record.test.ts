import { expect, test, describe } from "bun:test";
import {
  commandOf,
  describeIds,
  filedUnderRefusal,
  fillBody,
  idsOf,
  keepsRecord,
  outRefusal,
  overrideRefusal,
  pointerIds,
  promoteRecord,
  recordDir,
  recordedIds,
  routeRows,
  sameIds,
  shootCommand,
  stampOf,
  staleRefusal,
  unitMoves,
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

// -- the promote's half of the record -----------------------------------------

describe("stampOf", () => {
  test("the colons and the milliseconds go, because a directory name carries them badly", () => {
    expect(stampOf("2026-09-10T16:12:51.123Z")).toBe("2026-09-10T16-12-51Z");
  });

  // Two spellings of one instant have to name ONE directory. A stamp taken as
  // written would sort a +02:00 promote two hours from where it belongs, and
  // the archive's order is the only thing that says which deploy came last.
  test("an offset names the same directory as the same instant in UTC", () => {
    expect(stampOf("2026-09-10T18:12:51.000+02:00")).toBe(stampOf("2026-09-10T16:12:51.000Z"));
  });

  test("a time with no milliseconds is not a different directory", () => {
    expect(stampOf("2026-09-10T16:12:51Z")).toBe(stampOf("2026-09-10T16:12:51.000Z"));
  });

  test("a string that is not a time throws rather than naming a directory", () => {
    expect(() => stampOf("soon")).toThrow("not a time");
  });
});

describe("recordDir", () => {
  test("a promote's record goes in deploys/", () => {
    expect(recordDir("deploy", "2026-09-10T16:12:51.123Z", "qa")).toBe(
      "deploys/2026-09-10T16-12-51Z-qa",
    );
  });

  test("a preview goes in previews/", () => {
    expect(recordDir("preview", "2026-09-10T16:12:51.123Z", "qa")).toStartWith("previews/");
  });

  // The two halves compose only if the name promote prints is one shoot would
  // have chosen for itself and would then accept. Either half spelling this on
  // its own is two directories for one deploy.
  test("the directory a promote names is one a shoot into it will take", () => {
    const dir = recordDir("deploy", "2026-09-10T16:12:51.123Z", "qa");
    expect(outRefusal(dir, "deploy")).toBeNull();
    expect(dir).toBe(recordDir("deploy", "2026-09-10T16:12:51.123Z", "qa"));
  });
});

describe("keepsRecord", () => {
  test("the channels a visitor is served", () => {
    expect(keepsRecord("qa")).toBe(true);
    expect(keepsRecord("prod")).toBe(true);
  });

  // The live suite promotes several times per run. Recording those would fill
  // the archive with compositions nobody was ever served.
  test("the suite's own channels keep no record", () => {
    expect(keepsRecord("test-qa")).toBe(false);
    expect(keepsRecord("test-prod")).toBe(false);
  });

  test("a channel that only starts like a real one", () => {
    expect(keepsRecord("qa-2")).toBe(false);
    expect(keepsRecord("")).toBe(false);
  });
});

describe("unitMoves", () => {
  // The distinction the record exists for. The pointer bytes hold the whole
  // composition either way, so nothing in them says which unit the operator
  // asked for and which the merge carried.
  test("a unit at the same id was carried, not deployed", () => {
    const moves = unitMoves({ shell: "s1", hello: "h1" }, { shell: "s1", hello: "h2" });
    expect(moves.shell).toEqual({ unitId: "s1", from: "s1", state: "carried" });
    expect(moves.hello).toEqual({ unitId: "h2", from: "h1", state: "moved" });
  });

  test("a first promote has nothing to have moved from", () => {
    expect(unitMoves(null, { shell: "s1" })).toEqual({
      shell: { unitId: "s1", from: null, state: "new" },
    });
  });

  test("a unit the channel has and the composition does not is dropped, not lost", () => {
    const moves = unitMoves({ shell: "s1", board: "b1" }, { shell: "s1" });
    expect(moves.board).toEqual({ unitId: null, from: "b1", state: "dropped" });
  });

  test("a rollback reads as a move, with the id it came back from", () => {
    expect(unitMoves({ hello: "new" }, { hello: "old" }).hello).toEqual({
      unitId: "old",
      from: "new",
      state: "moved",
    });
  });
});

describe("recordedIds", () => {
  test("a dropped unit is not an id the channel serves", () => {
    expect(
      recordedIds({ shell: { unitId: "s1" }, board: { unitId: null } }),
    ).toEqual({ shell: "s1" });
  });
});

describe("commandOf", () => {
  test("what an operator can paste back", () => {
    expect(commandOf(["qa", "--app", "hello=h1"])).toBe("bun run promote qa --app hello=h1");
  });

  // argv beside it is the exact reading. This one is for a person, and a
  // person pasting it back has to get the same command.
  test("an argument with a space is quoted", () => {
    expect(commandOf(["qa", "--note", "two words"])).toBe('bun run promote qa --note "two words"');
  });

  test("an empty argument does not vanish", () => {
    expect(commandOf(["qa", ""])).toBe('bun run promote qa ""');
  });
});

describe("shootCommand", () => {
  test("qa is shoot's default, so naming it would be noise", () => {
    expect(shootCommand("qa", "deploys/x-qa")).toBe("bun run shoot --out deploys/x-qa");
  });

  test("any other channel has to be named", () => {
    expect(shootCommand("prod", "deploys/x-prod")).toBe(
      "bun run shoot --channel prod --out deploys/x-prod",
    );
  });
});

describe("promoteRecord", () => {
  const act = {
    channel: "qa",
    argv: ["qa", "--app", "hello=h2"],
    regions: ["eu", "us"],
    source: { commit: "0367d82".padEnd(40, "0"), dirty: false },
    contract: "9d1b0a3",
    before: { shell: "s1", hello: "h1" },
    after: { shell: "s1", hello: "h2" },
    startedAt: "2026-09-10T16:12:50.000Z",
    composedAt: "2026-09-10T16:12:51.123Z",
    writtenAt: "2026-09-10T16:12:53.000Z",
    warnings: ["hello carries no digests"],
  };

  test("one manifest file per region written, and no others", () => {
    expect(promoteRecord(act).manifests).toEqual({
      eu: "manifest.eu.json",
      us: "manifest.us.json",
    });
  });

  // --region eu leaves the other region serving what it served. A record
  // naming both would state the drift §3 refuses to flatten as though it were
  // this promote's doing.
  test("one region named writes one manifest", () => {
    expect(promoteRecord({ ...act, regions: ["eu"] }).manifests).toEqual({
      eu: "manifest.eu.json",
    });
  });

  test("what moved and what was carried", () => {
    const record = promoteRecord(act);
    expect(record.units.shell?.state).toBe("carried");
    expect(record.units.hello).toEqual({ unitId: "h2", from: "h1", state: "moved" });
  });

  test("the argv is copied, so a later read is of the command that ran", () => {
    const argv = ["qa", "--app", "hello=h2"];
    const record = promoteRecord({ ...act, argv });
    argv.push("--and-then-some");
    expect(record.argv).toEqual(["qa", "--app", "hello=h2"]);
  });

  test("a promote with nothing to warn about says so with an empty list", () => {
    expect(promoteRecord({ ...act, warnings: [] }).warnings).toEqual([]);
  });

  test("a tree with no git behind it records no source rather than inventing one", () => {
    expect(promoteRecord({ ...act, source: null }).source).toBeNull();
  });
});

describe("filedUnderRefusal", () => {
  const promote = {
    channel: "qa",
    composedAt: "2026-09-10T16:12:51.123Z",
    units: { shell: { unitId: "s1" }, hello: { unitId: "h1" } },
  };
  const serving = { composedAt: "2026-09-10T16:12:51.123Z", ids: { shell: "s1", hello: "h1" } };

  test("a directory no promote wrote is nobody's record to contradict", () => {
    expect(filedUnderRefusal(null, "qa", serving, "deploys/x")).toBeNull();
  });

  test("the promote this run is filling in", () => {
    expect(filedUnderRefusal(promote, "qa", serving, "deploys/x")).toBeNull();
  });

  // Every other gate in the shooter is about the pointer as it is NOW, so a
  // later promote would be shot correctly and filed under this one.
  test("a promote landed after the one this directory records", () => {
    const refusal = filedUnderRefusal(
      promote,
      "qa",
      { ...serving, ids: { shell: "s1", hello: "h2" } },
      "deploys/x",
    );
    expect(refusal).toContain("hello=h1");
    expect(refusal).toContain("hello=h2");
  });

  // The no-op promote an operator runs to check a channel: every id stays and
  // composedAt moves. Ids alone would call this the same deploy.
  test("the same composition promoted again is a different promote", () => {
    const refusal = filedUnderRefusal(
      promote,
      "qa",
      { ...serving, composedAt: "2026-09-10T17:00:00.000Z" },
      "deploys/x",
    );
    expect(refusal).toContain("The ids match");
  });

  test("a record of another channel says so rather than comparing ids", () => {
    const refusal = filedUnderRefusal(promote, "prod", serving, "deploys/x");
    expect(refusal).toContain("records a promote of qa");
    expect(refusal).not.toContain("shell=s1");
  });

  // A schema-2 pointer carries no composedAt, and a record of one is still
  // worth filing. The ids are the reading that remains.
  test("a pointer that names no instant is judged on its ids alone", () => {
    expect(filedUnderRefusal(promote, "qa", { ...serving, composedAt: null }, "deploys/x")).toBeNull();
  });
});
