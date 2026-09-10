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
  servesWanted,
  shootCommand,
  stampOf,
  dirtyPaths,
  freeDir,
  pendingRefusal,
  unshotNote,
  staleRefusal,
  unitMoves,
  type ShotEntry,
} from "./record.ts";
import {
  carriedSummary,
  cell,
  changeKind,
  changelogEntry,
  changelogIndex,
  changelogSummary,
  channelOf,
  entryInstant,
  entryTitle,
  humanTime,
  movedSummary,
  noteHeadline,
  picturesCell,
  regionsCell,
  renderChangelog,
  sortArchive,
  sourceCell,
  warningsBlock,
  warningsCell,
  type ArchiveRecord,
  type PromoteFile,
  type ShotsFile,
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

  // This test used to assert `--channel prod`, which `shoot` refuses outright:
  // no browser can send the Host header prod is reached by. Every prod deploy
  // ended with an instruction that cannot work, and the test held it there.
  test("a channel no browser can reach gets a reason and no command", () => {
    const line = shootCommand("prod", "deploys/x-prod");
    expect(line).not.toContain("bun run shoot");
    expect(line).toContain("deploys/x-prod");
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

describe("servesWanted", () => {
  const block = {
    channel: "qa",
    region: "eu",
    publishedAt: "2026-09-10T16:33:38.633Z",
    units: { shell: { unitId: "s1", commit: "c", marker: "" } },
  };

  test("the page the pointer names", () => {
    expect(servesWanted(block, { shell: "s1" }, "2026-09-10T16:33:38.633Z")).toBe(true);
  });

  test("a page still serving the composition from before the promote", () => {
    expect(servesWanted(block, { shell: "s2" }, "2026-09-10T16:33:38.633Z")).toBe(false);
  });

  // The whole reason the stamp is compared. Promoting the ids a channel already
  // serves moves composedAt and moves no id, and MANIFEST_TTL_MS means the page
  // is the earlier composition for up to §6's 27 s - correct on every id.
  test("the same ids promoted again is not the same page", () => {
    expect(servesWanted(block, { shell: "s1" }, "2026-09-10T17:00:00.000Z")).toBe(false);
  });

  test("a page that carries no stamp cannot prove one", () => {
    const { publishedAt, ...quiet } = block;
    expect(servesWanted(quiet, { shell: "s1" }, "2026-09-10T16:33:38.633Z")).toBe(false);
  });

  test("a stamp nobody asked for is not compared", () => {
    expect(servesWanted(block, { shell: "s1" }, null)).toBe(true);
  });
});

describe("dirtyPaths", () => {
  test("a clean tree", () => {
    expect(dirtyPaths("")).toEqual([]);
  });

  test("the path, not the status letters", () => {
    expect(dirtyPaths("?? deploys/2026-09-10T16-33-38Z-qa/\n M scripts/promote.ts")).toEqual([
      "deploys/2026-09-10T16-33-38Z-qa/",
      "scripts/promote.ts",
    ]);
  });

  // The whole reason it exists: a second promote made before the first record
  // was committed reads as dirty, and the dirt is the record.
  test("a previous record is visible as the thing that made the tree dirty", () => {
    expect(dirtyPaths("?? deploys/2026-09-10T16-33-38Z-qa/")).toEqual([
      "deploys/2026-09-10T16-33-38Z-qa/",
    ]);
  });

  test("a trailing newline adds no empty path", () => {
    expect(dirtyPaths(" M a.ts\n")).toEqual(["a.ts"]);
  });
});

describe("pendingRefusal", () => {
  const shot = { dir: "deploys/2026-01-01T00-00-00Z-qa", channel: "qa", hasPromote: true, hasShots: true };
  const pending = { dir: "deploys/2026-02-02T00-00-00Z-qa", channel: "qa", hasPromote: true, hasShots: false };

  test("nothing pending", () => {
    expect(pendingRefusal([shot], "qa")).toBeNull();
  });

  test("the newest promote has no pictures: named, with the command", () => {
    const refusal = pendingRefusal([shot, pending], "qa");
    expect(refusal).toContain(pending.dir);
    expect(refusal).toContain(`--out ${pending.dir}`);
  });

  // THE DEADLOCK. Two ordinary promotes - a deploy and the rollback of it -
  // where the first was never shot. `shoot` refuses to file a picture under a
  // promote the pointer moved past, so refusing here told the operator to run
  // a command that would be refused, and `bun run pr` never ran again.
  test("an older unshot promote does not block once a newer one is shot", () => {
    const older = { ...pending, dir: "deploys/2026-01-15T00-00-00Z-qa" };
    const newer = { ...shot, dir: "deploys/2026-03-03T00-00-00Z-qa" };
    expect(pendingRefusal([older, newer], "qa")).toBeNull();
  });

  test("older unshot ones do not change the refusal when the newest is pending", () => {
    const older = { ...pending, dir: "deploys/2026-01-15T00-00-00Z-qa" };
    const refusal = pendingRefusal([older, pending], "qa");
    expect(refusal).toContain(pending.dir);
    expect(refusal).not.toContain(older.dir);
  });

  test("another channel's pending promote is not this run's business", () => {
    expect(pendingRefusal([{ ...pending, channel: "prod" }], "qa")).toBeNull();
  });

  // A record with pictures and no promote.json is every record written before
  // promote kept one. It is complete, and it is not pending.
  test("a shot record with no promote record is not pending", () => {
    expect(pendingRefusal([{ ...shot, hasPromote: false }], "qa")).toBeNull();
  });

  test("no directories at all", () => {
    expect(pendingRefusal([], "qa")).toBeNull();
  });
});

describe("unshotNote", () => {
  const shot = { dir: "deploys/2026-03-03T00-00-00Z-qa", channel: "qa", hasPromote: true, hasShots: true };
  const stranded = { dir: "deploys/2026-01-15T00-00-00Z-qa", channel: "qa", hasPromote: true, hasShots: false };

  test("nothing stranded", () => {
    expect(unshotNote([shot], "qa")).toBeNull();
  });

  test("a promote the pointer moved past is named, and it is a note", () => {
    const note = unshotNote([stranded, shot], "qa");
    expect(note).toContain(stranded.dir);
    expect(note).toContain("can no longer be shot");
  });

  test("the newest is never stranded, whatever state it is in", () => {
    expect(unshotNote([{ ...stranded, dir: "deploys/2026-09-09T00-00-00Z-qa" }], "qa")).toBeNull();
  });

  test("two of them read as plural", () => {
    const a = { ...stranded, dir: "deploys/2026-01-01T00-00-00Z-qa" };
    expect(unshotNote([a, stranded, shot], "qa")).toContain("2 promotes have");
  });
});

describe("shootCommand", () => {
  test("qa needs no --channel", () => {
    expect(shootCommand("qa", "deploys/x")).toBe("bun run shoot --out deploys/x");
  });

  // Every prod deploy used to end with `--channel prod`, which shoot refuses
  // outright: no browser can send the Host header prod is reached by.
  test("prod says why there is no command, and names the item that would change it", () => {
    const line = shootCommand("prod", "deploys/x");
    expect(line).not.toContain("bun run shoot");
    expect(line).toContain("§2");
  });
});

describe("freeDir", () => {
  test("a free name is taken as it is", () => {
    expect(freeDir("deploys/x", () => false)).toBe("deploys/x");
  });

  // stampOf truncates to the second, so two promotes inside one second name
  // one directory. The record write cannot refuse - the pointer has already
  // moved - so it takes the next name instead of overwriting the first.
  test("a taken name steps to the next one", () => {
    expect(freeDir("deploys/x", (d) => d === "deploys/x")).toBe("deploys/x-2");
  });

  test("two taken names step twice", () => {
    const taken = new Set(["deploys/x", "deploys/x-2"]);
    expect(freeDir("deploys/x", (d) => taken.has(d))).toBe("deploys/x-3");
  });

  test("no free name at all throws rather than overwriting", () => {
    expect(() => freeDir("deploys/x", () => true)).toThrow("all hold a record");
  });
});

describe("dirtyPaths, bounded", () => {
  // Committed to a public repository, and `git status` lists untracked files,
  // so without a cap a record publishes an operator's whole checkout.
  test("a long list is capped and says how many it dropped", () => {
    const porcelain = Array.from({ length: 25 }, (_, i) => `?? file-${i}.ts`).join("\n");
    const paths = dirtyPaths(porcelain, 20);
    expect(paths).toHaveLength(21);
    expect(paths.at(-1)).toBe("and 5 more");
  });

  test("a list at the cap is not annotated", () => {
    const porcelain = Array.from({ length: 20 }, (_, i) => `?? file-${i}.ts`).join("\n");
    expect(dirtyPaths(porcelain, 20)).toHaveLength(20);
  });

  test("a rename records where the content is now", () => {
    expect(dirtyPaths("R  old/a.ts -> new/a.ts")).toEqual(["new/a.ts"]);
  });
});

describe("staleRefusal, on composedAt", () => {
  const live = { shell: "s1", hello: "h1" };

  // The ids cannot see a promote of the ids a channel already serves, and that
  // promote is what this work used to verify itself.
  test("the same ids promoted again is not a picture of production", () => {
    const refusal = staleRefusal({ channel: "qa", units: live }, "qa", live, "deploys/x", {
      record: "2026-09-10T16:33:38.000Z",
      live: "2026-09-10T16:51:48.000Z",
    });
    expect(refusal).toContain("16:33:38");
    expect(refusal).toContain("16:51:48");
    expect(refusal).toContain("did not move");
  });

  test("one composedAt reading missing falls back to the ids", () => {
    expect(
      staleRefusal({ channel: "qa", units: live }, "qa", live, "deploys/x", {
        record: null,
        live: "2026-09-10T16:51:48.000Z",
      }),
    ).toBeNull();
  });

  test("both readings equal", () => {
    expect(
      staleRefusal({ channel: "qa", units: live }, "qa", live, "deploys/x", {
        record: "2026-09-10T16:51:48.000Z",
        live: "2026-09-10T16:51:48.000Z",
      }),
    ).toBeNull();
  });
});

describe("filedUnderRefusal, when a promote wrote one region", () => {
  const units = { shell: { unitId: "s1" }, hello: { unitId: "h1" } };
  const serving = { composedAt: "2026-09-10T16:51:48.000Z", ids: { shell: "s1", hello: "h1" } };

  // A --region run leaves the other region where it was, so the machine that
  // answers may be serving an older composedAt with identical ids. Naming only
  // "promoted again" sent an operator hunting a promote that never happened.
  test("a one-region record offers the other reading", () => {
    const refusal = filedUnderRefusal(
      { channel: "qa", composedAt: "2026-09-10T16:51:30.000Z", units, regions: ["eu"] },
      "qa",
      serving,
      "deploys/x",
    );
    expect(refusal).toContain("did not write");
    expect(refusal).toContain("eu");
  });

  test("a record of every region does not offer it", () => {
    const refusal = filedUnderRefusal(
      { channel: "qa", composedAt: "2026-09-10T16:51:30.000Z", units, regions: ["eu", "us"] },
      "qa",
      serving,
      "deploys/x",
    );
    expect(refusal).not.toContain("did not write");
  });

  test("a record with no regions field reads as before", () => {
    const refusal = filedUnderRefusal(
      { channel: "qa", composedAt: "2026-09-10T16:51:30.000Z", units },
      "qa",
      serving,
      "deploys/x",
    );
    expect(refusal).toContain("promoted again");
  });
});

// -- the archive, gathered ----------------------------------------------------
//
// `CHANGELOG.md` is generated from `deploys/` and never written by hand, so
// every reading below is the only thing standing between a record and a
// document that misreports it. scripts/changelog.test.ts renders the real
// archive; these put each reading in the state that breaks it.

const carried = (id: string) => ({ unitId: id, from: id, state: "carried" as const });

const promoteFile = (over: PromoteFile = {}): PromoteFile => ({
  schema: 1,
  kind: "promote",
  channel: "qa",
  argv: ["qa"],
  command: "bun run promote qa",
  startedAt: "2026-09-10T17:29:01.726Z",
  composedAt: "2026-09-10T17:29:02.358Z",
  writtenAt: "2026-09-10T17:29:03.026Z",
  regions: ["eu", "us"],
  source: { commit: "b8268f7626174754c18ca7365a90b10a403f22fb", dirty: false },
  contract: "9d1b0a3",
  units: { shell: carried("c260"), hello: carried("3bba") },
  warnings: [],
  manifests: { eu: "manifest.eu.json", us: "manifest.us.json" },
  ...over,
});

const shotsFile = (over: ShotsFile = {}): ShotsFile => ({
  schema: 2,
  takenAt: "2026-09-10T17:29:08.165Z",
  kind: "deploy",
  channel: "qa",
  region: "eu",
  contract: "9d1b0a3",
  composedAt: "2026-09-10T17:29:02.358Z",
  units: { shell: "c260", hello: "3bba" },
  manifests: { eu: "manifest.eu.json", us: "manifest.us.json" },
  shots: [shot("/"), shot("/service", "Service")],
  ...over,
});

const archived = (over: Partial<ArchiveRecord> = {}): ArchiveRecord => ({
  dir: "deploys/2026-09-10T17-29-02Z-qa",
  promote: promoteFile(),
  shots: shotsFile(),
  notes: "A no-op promote to qa.\n\nThe rest of the note.\n",
  ...over,
});

describe("noteHeadline", () => {
  test("the first line is the entry", () => {
    expect(noteHeadline("what it demonstrates\n\nthe rest\n")).toBe("what it demonstrates");
  });

  // A note that opens with a blank line still says what its deploy
  // demonstrates, and rendering the blank would drop the one sentence in the
  // record a person wrote.
  test("a leading blank line is not the first line", () => {
    expect(noteHeadline("\n\n  what it demonstrates\n")).toBe("what it demonstrates");
  });

  test("no notes.md at all", () => {
    expect(noteHeadline(null)).toBeNull();
  });

  test("a file with nothing in it", () => {
    expect(noteHeadline("")).toBeNull();
  });

  test("a file of whitespace", () => {
    expect(noteHeadline("   \n\t\n")).toBeNull();
  });
});

describe("cell", () => {
  // notes.md is hand-written and warnings are whatever a promote printed. A
  // pipe in either ends the cell and shifts every column after it.
  test("a pipe is escaped rather than ending the cell", () => {
    expect(cell("a | b")).toBe("a \\| b");
  });

  test("a newline is collapsed rather than ending the row", () => {
    expect(cell("one\ntwo")).toBe("one two");
  });

  test("a run of whitespace becomes one space", () => {
    expect(cell("  one   two  ")).toBe("one two");
  });
});

describe("channelOf", () => {
  test("the promote's channel", () => {
    expect(channelOf(archived())).toBe("qa");
  });

  // The oldest record has no promote.json, and its channel is in the shots.
  test("the shots' channel when there is no act", () => {
    expect(channelOf(archived({ promote: null, shots: shotsFile({ channel: "prod" }) }))).toBe("prod");
  });

  test("neither half names one", () => {
    expect(
      channelOf({ dir: "deploys/x", promote: null, shots: shotsFile({ channel: undefined }), notes: null }),
    ).toBe("unknown channel");
  });
});

describe("changeKind", () => {
  // The reading the changelog exists to get right: four of the five records in
  // deploys/ are promotes that moved nothing, and listing them as deploys
  // anybody asked for is a false reading of the archive.
  test("every unit carried is a no-op", () => {
    expect(changeKind(promoteFile())).toBe("no-op");
  });

  test("one unit moved is a deploy", () => {
    expect(
      changeKind(
        promoteFile({ units: { shell: carried("c260"), hello: { unitId: "9f2", from: "3bba", state: "moved" } } }),
      ),
    ).toBe("moved");
  });

  test("a first promote is a deploy", () => {
    expect(changeKind(promoteFile({ units: { hello: { unitId: "9f2", from: null, state: "new" } } }))).toBe(
      "moved",
    );
  });

  test("a dropped unit is a deploy", () => {
    expect(
      changeKind(promoteFile({ units: { hello: { unitId: null, from: "3bba", state: "dropped" } } })),
    ).toBe("moved");
  });

  test("no promote.json at all", () => {
    expect(changeKind(null)).toBe("unrecorded");
  });

  // Not "no-op": a promote naming no unit recorded no movement either way, and
  // saying nothing moved would be a claim the file does not make.
  test("a promote naming no unit is unrecorded, not a no-op", () => {
    expect(changeKind(promoteFile({ units: {} }))).toBe("unrecorded");
  });
});

describe("movedSummary", () => {
  test("every unit carried", () => {
    expect(movedSummary(promoteFile().units)).toBe("nothing");
  });

  test("a move names both sides", () => {
    expect(movedSummary({ hello: { unitId: "9f2", from: "3bba", state: "moved" } })).toBe(
      "hello 3bba → 9f2",
    );
  });

  test("a first promote says so rather than naming a side it has not got", () => {
    expect(movedSummary({ hello: { unitId: "9f2", from: null, state: "new" } })).toBe(
      "hello 9f2 (first promote)",
    );
  });

  test("a dropped unit names the id it was at", () => {
    expect(movedSummary({ hello: { unitId: null, from: "3bba", state: "dropped" } })).toBe(
      "hello dropped (was 3bba)",
    );
  });

  // Sorted, so two readings of one promote read the same however the JSON was
  // written.
  test("sorted by name", () => {
    expect(
      movedSummary({
        shell: { unitId: "s2", from: "s1", state: "moved" },
        hello: { unitId: "h2", from: "h1", state: "moved" },
      }),
    ).toBe("hello h1 → h2, shell s1 → s2");
  });

  test("no units recorded is not the same as nothing moved", () => {
    expect(movedSummary(undefined)).toBe("not recorded");
  });
});

describe("carriedSummary", () => {
  test("what the merge carried", () => {
    expect(carriedSummary(promoteFile().units)).toBe("hello 3bba, shell c260");
  });

  test("a promote that carried none", () => {
    expect(carriedSummary({ hello: { unitId: "9f2", from: "3bba", state: "moved" } })).toBe("nothing");
  });

  test("no units recorded", () => {
    expect(carriedSummary(undefined)).toBe("not recorded");
  });
});

describe("regionsCell", () => {
  test("a promote of every region", () => {
    expect(regionsCell(promoteFile(), shotsFile())).toBe("eu, us");
  });

  // The record written by `--region eu` holds manifest.us.as-served.json, which
  // is a different deploy's pointer under a name that says so. An entry reading
  // the manifests as the regions this promote wrote claims a deploy that did
  // not happen.
  test("a one-region promote names the region it did not write", () => {
    const line = regionsCell(
      promoteFile({ regions: ["eu"], manifests: { eu: "manifest.eu.json" } }),
      shotsFile({ manifests: { eu: "manifest.eu.json", us: "manifest.us.as-served.json" } }),
    );
    expect(line).toContain("eu only");
    expect(line).toContain("manifest.us.as-served.json");
    expect(line).toContain("not written by this promote");
  });

  test("no act, so which region an act wrote is not recorded", () => {
    const line = regionsCell(null, shotsFile());
    expect(line).toStartWith("not recorded");
    expect(line).toContain("eu, us");
  });

  test("no act and no manifests either", () => {
    expect(regionsCell(null, shotsFile({ manifests: {} }))).toBe("not recorded");
  });
});

describe("sourceCell", () => {
  test("a clean tree, at a short commit", () => {
    expect(sourceCell(promoteFile().source)).toBe("b8268f7, clean tree");
  });

  // dirty: true is a true reading and a misleading one on its own: the second
  // of two promotes made without committing is dirty because of the FIRST one's
  // record, which is not source at all.
  test("a dirty tree names what made it dirty", () => {
    expect(
      sourceCell({ commit: "21a3566f26f4bf", dirty: true, dirtyPaths: ["deploys/2026-09-10T16-51-30Z-qa/"] }),
    ).toBe("21a3566, dirty tree: deploys/2026-09-10T16-51-30Z-qa/");
  });

  test("a dirty tree that recorded no paths", () => {
    expect(sourceCell({ commit: "21a3566f26f4bf", dirty: true })).toBe("21a3566, dirty tree");
  });

  test("a promote that read no git at all", () => {
    expect(sourceCell(null)).toBe("not recorded");
  });

  test("no promote.json", () => {
    expect(sourceCell(undefined)).toBe("not recorded");
  });
});

describe("warnings", () => {
  // `[]` and "no such field" are two different states and the archive holds
  // both: every promote so far printed nothing, and the record that predates
  // promote.json has no field to be empty.
  test("an empty array is none, and a missing one is not recorded", () => {
    expect(warningsCell(promoteFile())).toBe("none");
    expect(warningsCell(promoteFile({ warnings: undefined }))).toBe("not recorded");
    expect(warningsCell(null)).toBe("not recorded");
  });

  test("none is no block at all", () => {
    expect(warningsBlock(promoteFile())).toEqual([]);
  });

  // Never seen in the archive, which is the reason to write it for the case
  // that is not the empty one.
  test("one warning is singular", () => {
    const block = warningsBlock(promoteFile({ warnings: ["COLD https://example/a.js"] })).join("\n");
    expect(block).toContain("1 warning");
    expect(block).toContain("let it through");
    expect(block).toContain("- COLD https://example/a.js");
  });

  test("several warnings are a list, one line each", () => {
    const block = warningsBlock(
      promoteFile({ warnings: ["COLD https://example/a.js", "hello carries no digests"] }),
    );
    expect(warningsCell(promoteFile({ warnings: ["a", "b"] }))).toBe("2, listed below");
    expect(block.filter((l) => l.startsWith("- "))).toHaveLength(2);
    expect(block.join("\n")).toContain("let them through");
  });

  test("a warning holding a pipe or a newline does not rewrite the document", () => {
    const block = warningsBlock(promoteFile({ warnings: ["a | b\nc"] })).join("\n");
    expect(block).toContain("- a \\| b c");
  });
});

describe("picturesCell", () => {
  test("every view, linked under the record", () => {
    const line = picturesCell(archived());
    expect(line).toContain("2 views");
    expect(line).toContain("[/](deploys/2026-09-10T17-29-02Z-qa/root.png)");
  });

  // A promote that wrote its record and was never shot is a deploy that
  // happened, and pr.ts's scan for shots.json walks straight past it.
  test("a promote nobody shot", () => {
    expect(picturesCell(archived({ shots: null }))).toContain("no `shots.json`");
  });

  test("a shots.json naming no view", () => {
    expect(picturesCell(archived({ shots: shotsFile({ shots: [] }) }))).toContain("names no view");
  });

  test("a panel that rendered its error state is named", () => {
    const withError = { ...shot("/service", "Service"), panelErrors: ["hello"] };
    const line = picturesCell(archived({ shots: shotsFile({ shots: [withError] }) }));
    expect(line).toContain("/service drew hello in an error state");
  });

  test("a shot from a schema that recorded no panel errors", () => {
    const old = { ...shot("/"), panelErrors: undefined as unknown as string[] };
    expect(picturesCell(archived({ shots: shotsFile({ shots: [old] }) }))).toContain("1 view");
  });
});

describe("entryInstant", () => {
  test("the composition the act wrote", () => {
    expect(entryInstant(archived())).toBe("2026-09-10T17:29:02.358Z");
  });

  // The oldest record predates promote.json: its directory is named for when it
  // was shot, and the composition it is a picture of was composed hours before.
  test("the pictures' composedAt where there is no act", () => {
    expect(
      entryInstant(archived({ promote: null, shots: shotsFile({ composedAt: "2026-09-10T11:18:12.659Z" }) })),
    ).toBe("2026-09-10T11:18:12.659Z");
  });

  test("a record whose shots carry no composedAt falls back to when they were taken", () => {
    expect(entryInstant(archived({ promote: null, shots: shotsFile({ composedAt: null }) }))).toBe(
      "2026-09-10T17:29:08.165Z",
    );
  });

  test("neither half names an instant", () => {
    expect(
      entryInstant({ dir: "deploys/x", promote: null, shots: { channel: "qa" }, notes: null }),
    ).toBeNull();
  });
});

describe("humanTime", () => {
  test("to the second, in UTC", () => {
    expect(humanTime("2026-09-10T17:29:02.358Z")).toBe("2026-09-10 17:29:02 UTC");
  });

  // Two promotes 18 seconds apart are two records. To the minute their headings
  // are one line twice, which is a duplicate anchor and two entries a reader
  // cannot tell apart.
  test("two promotes in one minute read as two instants", () => {
    expect(humanTime("2026-09-10T16:51:30.399Z")).not.toBe(humanTime("2026-09-10T16:51:48.488Z"));
  });

  test("an offset is normalised", () => {
    expect(humanTime("2026-09-10T19:29:02.358+02:00")).toBe("2026-09-10 17:29:02 UTC");
  });

  // Invalid Date in a generated document hides which record has the problem.
  test("a string that is not a time is shown as written", () => {
    expect(humanTime("whenever")).toBe("whenever");
  });
});

describe("entryTitle", () => {
  test("a no-op says so rather than listing a deploy", () => {
    expect(entryTitle(archived())).toBe("2026-09-10 17:29:02 UTC · qa · nothing moved");
  });

  test("a record with no act", () => {
    expect(entryTitle(archived({ promote: null }))).toContain("no act recorded");
  });

  test("a deploy names what moved", () => {
    const moved = promoteFile({ units: { hello: { unitId: "9f2", from: "3bba", state: "moved" } } });
    expect(entryTitle(archived({ promote: moved }))).toContain("hello 3bba → 9f2");
  });
});

describe("sortArchive", () => {
  test("newest first", () => {
    const a = archived({ dir: "deploys/2026-09-10T16-12-51Z-qa" });
    const b = archived({ dir: "deploys/2026-09-10T17-29-02Z-qa" });
    expect(sortArchive([a, b]).map((r) => r.dir)).toEqual([b.dir, a.dir]);
  });

  test("it does not reorder the array it was given", () => {
    const a = archived({ dir: "deploys/2026-09-10T16-12-51Z-qa" });
    const b = archived({ dir: "deploys/2026-09-10T17-29-02Z-qa" });
    const given = [a, b];
    sortArchive(given);
    expect(given[0]).toBe(a);
  });
});

describe("changelogSummary", () => {
  const moved = archived({
    dir: "deploys/2026-09-11T09-00-00Z-qa",
    promote: promoteFile({
      composedAt: "2026-09-11T09:00:00.000Z",
      units: { hello: { unitId: "9f2", from: "3bba", state: "moved" } },
    }),
  });

  test("an empty archive is a file that says so, not a crash", () => {
    expect(changelogSummary([]).join("\n")).toContain("holds no record");
  });

  test("the counts are counted", () => {
    const text = changelogSummary([archived(), moved, archived({ promote: null })]).join("\n");
    expect(text).toContain("3 records on qa");
    expect(text).toContain("1 moved at least one unit");
    expect(text).toContain("1 rewrote a pointer");
    expect(text).toContain("1 holds no act at all");
  });

  // The reading the archive's own contents force: every record in it so far is
  // a promote that moved nothing.
  test("an archive where nothing moved says so at the top", () => {
    expect(changelogSummary([archived(), archived({ dir: "deploys/2026-09-10T16-33-38Z-qa" })]).join("\n")).toContain(
      "No record in this archive moved a unit",
    );
  });

  test("one deploy is enough to drop that reading", () => {
    expect(changelogSummary([archived(), moved]).join("\n")).not.toContain(
      "No record in this archive moved a unit",
    );
  });

  test("an archive of nothing but unrecorded acts claims nothing about movement", () => {
    expect(changelogSummary([archived({ promote: null })]).join("\n")).not.toContain(
      "No record in this archive moved a unit",
    );
  });

  test("warnings are counted, both ways", () => {
    expect(changelogSummary([archived()]).join("\n")).toContain("No promote in this archive printed a warning");
    const warned = archived({ promote: promoteFile({ warnings: ["COLD https://example/a.js"] }) });
    expect(changelogSummary([warned]).join("\n")).toContain("1 promote printed a warning");
  });

  test("an archive of records with no act says nothing about warnings", () => {
    expect(changelogSummary([archived({ promote: null })]).join("\n")).not.toContain("warning");
  });
});

describe("changelogIndex", () => {
  test("one row per record, newest first", () => {
    const rows = changelogIndex([
      archived({ dir: "deploys/2026-09-10T16-12-51Z-qa" }),
      archived({ dir: "deploys/2026-09-10T17-29-02Z-qa" }),
    ]).filter((l) => l.startsWith("| deploys") || l.startsWith("| 2026"));
    expect(rows).toHaveLength(2);
    expect(rows[0]).toContain("2026-09-10T17-29-02Z-qa");
  });

  test("an empty archive gets no table at all", () => {
    expect(changelogIndex([])).toEqual([]);
  });
});

describe("changelogEntry", () => {
  test("the hand-written line is the entry's first sentence", () => {
    expect(changelogEntry(archived()).join("\n")).toContain("A no-op promote to qa.");
  });

  test("a record with no notes.md says nothing was written rather than nothing happened", () => {
    expect(changelogEntry(archived({ notes: null })).join("\n")).toContain("holds no line");
  });

  test("a no-op carries the reading, and a deploy does not", () => {
    expect(changelogEntry(archived()).join("\n")).toContain("Nothing moved.");
    const moved = promoteFile({ units: { hello: { unitId: "9f2", from: "3bba", state: "moved" } } });
    expect(changelogEntry(archived({ promote: moved })).join("\n")).not.toContain("Nothing moved.");
  });

  test("every row the task asks an entry to carry", () => {
    const text = changelogEntry(archived()).join("\n");
    for (const row of ["Composed at", "Contract", "Regions", "Moved", "Carried", "Command", "Source", "Warnings", "Pictures", "Record"]) {
      expect(text).toContain(`| ${row} |`);
    }
    expect(text).toContain("](deploys/2026-09-10T17-29-02Z-qa)");
  });

  test("a note holding a pipe does not rewrite the table", () => {
    const text = changelogEntry(archived({ notes: "a | b\n" })).join("\n");
    expect(text).toContain("a \\| b");
  });
});

describe("renderChangelog", () => {
  const text = renderChangelog([archived(), archived({ dir: "deploys/2026-09-10T16-12-51Z-qa", promote: null })]);

  // Not negotiable: the file says what it is in its own first lines, because a
  // generated file that does not is a file somebody edits by hand.
  test("the first lines say it is generated and not hand-edited", () => {
    const first = text.split("\n").slice(0, 4).join("\n");
    expect(first).toContain("bun run changelog");
    expect(first).toContain("Nothing in this file is written by hand");
  });

  test("newest first", () => {
    const entries = text.split("\n").filter((l) => l.startsWith("## "));
    expect(entries).toHaveLength(2);
    expect(entries[0]).toContain("17:29:02");
  });

  test("one trailing newline, and no run of blank lines", () => {
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text).not.toContain("\n\n\n");
  });

  // Rendered twice from one archive is the same bytes, which is what makes the
  // comparison against the file on disk a check rather than a coin toss.
  test("rendering is a function of the archive", () => {
    expect(renderChangelog([archived()])).toBe(renderChangelog([archived()]));
  });

  test("an empty archive still says what the file is", () => {
    expect(renderChangelog([])).toContain("bun run changelog");
  });
});
