// The readings a deploy record is built from, with no store, no browser and no
// git in any of them.
//
// scripts/shoot.ts and scripts/pr.ts were 750 lines of decisions that could
// only be exercised by publishing to the production store and driving a
// browser, which is the shape `~/projects/CLAUDE.md` warns about: a check that
// can only run against the real thing is a check that does not run. Everything
// here is a function of its arguments, so scripts/record.test.ts can put each
// one in the state that breaks it.

import { REGIONS } from "../src/server/origins.ts";

/** What the served page says it is composed of. */
export type BuildBlock = {
  channel: string;
  region: string;
  contract?: string;
  publishedAt?: string;
  apiBase?: string;
  units?: Record<string, { unitId: string; commit: string; marker: string }>;
};

/** One shot, as a record names it. */
export type ShotEntry = {
  route: string;
  file: string;
  title: string;
  units: Record<string, string>;
  panelErrors: string[];
  waitedMs: number;
};

export type ShotRecord = {
  schema: number;
  takenAt: string;
  kind: "deploy" | "preview";
  channel: string;
  region: string;
  units: Record<string, string>;
  shots: ShotEntry[];
};

export const idsOf = (block: BuildBlock): Record<string, string> =>
  Object.fromEntries(Object.entries(block.units ?? {}).map(([n, u]) => [n, u.unitId]));

/**
 * Two id sets naming the same units at the same ids.
 *
 * The union of the names, not one side's: `{shell: a}` and `{shell: a, hello: b}`
 * are not the same composition, and comparing only the left side's keys would
 * call them equal.
 */
export const sameIds = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((n) => a[n] === b[n]);
};

export const describeIds = (ids: Record<string, string>): string =>
  Object.entries(ids)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, id]) => `${n}=${id}`)
    .join(" ");

/**
 * Whether the page this block came from is serving the composition asked for.
 *
 * The ids are not the whole reading, and the case that shows it is the one an
 * operator runs to check a channel: promoting the ids a channel already serves
 * moves `composedAt` and moves nothing else. MANIFEST_TTL_MS is 10 s and §6
 * captured an x-manifest-age of 27464 ms, so for that whole window the page is
 * the composition from BEFORE the promote - and on ids alone it is
 * indistinguishable from the one after it. That is the trap the shooter exists
 * to close, and until this it was closed only for a promote that moved an id.
 *
 * `publishedAt` in the block IS the pointer's `composedAt`: html.ts renders it
 * from the composed manifest and `compose` spreads the pointer's own, so an
 * --override page carries the channel's stamp exactly as an ordinary one does.
 *
 * A stamp nobody asked for is not compared. A pointer that carries none gives
 * its page none either, and the ids are then all that either side has.
 */
export function servesWanted(
  block: BuildBlock,
  want: Record<string, string>,
  composedAt: string | null,
): boolean {
  if (!sameIds(idsOf(block), want)) return false;
  return composedAt === null || block.publishedAt === composedAt;
}

/** The composition a manifest names, from the manifest's own shape. */
export function pointerIds(doc: unknown): Record<string, string> | null {
  if (!doc || typeof doc !== "object") return null;
  const m = doc as { shell?: { unitId?: string }; apps?: Record<string, { unitId?: string }> };
  const ids: Record<string, string> = {};
  if (typeof m.shell?.unitId === "string") ids.shell = m.shell.unitId;
  for (const [name, unit] of Object.entries(m.apps ?? {})) {
    if (typeof unit?.unitId === "string") ids[name] = unit.unitId;
  }
  return Object.keys(ids).length ? ids : null;
}

/**
 * Why an --override may not be asked for, or null if it may.
 *
 * The origin composes from the pointer and replaces only a unit the query
 * string NAMES, so a name the channel does not compose is ignored rather than
 * refused - and a run that let that through would shoot the channel's own
 * composition and file it as a preview.
 */
export function overrideRefusal(
  override: Record<string, string>,
  pointer: Record<string, string>,
  channel: string,
): string | null {
  const unknown = Object.keys(override).filter((n) => !(n in pointer));
  if (unknown.length === 0) return null;
  return (
    `--override names ${unknown.join(", ")}, and ${channel} composes ` +
    `${Object.keys(pointer).join(", ")}. The origin ignores a name it does not compose, ` +
    `so this would have shot the channel and filed it as a preview.`
  );
}

/**
 * Why this record may not be written where it was asked to go, or null.
 *
 * `deploys/` is the archive of what was SERVED and `previews/` is what a branch
 * would serve. The directory was the whole distinction, and a directory is not
 * a mechanism: `--override ... --out deploys/x` put a preview in the archive
 * and nothing said a word. It is a refusal now.
 */
export function outRefusal(out: string, kind: "deploy" | "preview"): string | null {
  const top = out.replace(/^\.\//, "").split("/")[0];
  if (kind === "preview" && top === "deploys") {
    return `${out} is in deploys/, which is the archive of what a channel SERVED. This run asks the origin for a composition nobody promoted, so it belongs in previews/.`;
  }
  if (kind === "deploy" && top === "previews") {
    return `${out} is in previews/, which is what a branch WOULD serve. This run shoots the channel's own pointer, so it belongs in deploys/.`;
  }
  return null;
}

/**
 * One row per route, over the union of both records.
 *
 * The production record's routes were the whole table, so a view this branch
 * ADDS had no row at all - and `PLAN.md` steps 0, 3, 4 and 5 each add one, which
 * is to say the table was blank for most of the work it was built for. A route
 * only production has is the other half: it reads as removed rather than as
 * unchanged, which was a false statement in a body nobody would check.
 */
export type RouteRow = {
  route: string;
  title: string;
  state: "both" | "added" | "removed";
  prod: ShotEntry | null;
  preview: ShotEntry | null;
};

export function routeRows(
  prod: readonly ShotEntry[],
  preview: readonly ShotEntry[] | null,
): RouteRow[] {
  const routes = [...new Set([...prod.map((s) => s.route), ...preview?.map((s) => s.route) ?? []])];
  routes.sort();
  return routes.map((route) => {
    const left = prod.find((s) => s.route === route) ?? null;
    const right = preview?.find((s) => s.route === route) ?? null;
    // With no preview at all, every route is a row that changed nothing. With
    // one, a missing side is a route that arrived or left.
    const state = preview === null || (left && right) ? "both" : left ? "removed" : "added";
    return { route, title: (right ?? left)!.title, state, prod: left, preview: right };
  });
}

/**
 * The body with `section` in place of its `<!--REVIEW` block, or null when the
 * block is gone.
 *
 * Null is the second run: the block was replaced the first time, and there is
 * no way to know where the section it wrote ended. The caller has to check this
 * BEFORE it publishes anything, which is the bug this shape exists to make
 * hard - the first version discovered it after a publish, a commit and a push.
 */
export function fillBody(body: string, section: string, marker = "<!--REVIEW"): string | null {
  const start = body.indexOf(marker);
  if (start === -1) return null;
  const end = body.indexOf("-->", start);
  if (end === -1) return null;
  return `${body.slice(0, start)}${section}${body.slice(end + 3)}`;
}

// -- the act, as opposed to its result ----------------------------------------
//
// `shoot` records what a channel SERVED and can say nothing about how it came to
// serve it: which command was run, what it carried rather than moved, and what
// it let through. `promote` writes that half, into the directory `shoot` will
// later fill with pictures. The two compose because the names below are the ones
// `shoot` chooses, and because `promote` writes no shots.json - the only file a
// second run into a directory refuses on.

/**
 * The instant part of a record directory's name.
 *
 * One definition for both halves. `shoot` names its directory after the moment
 * it started and `promote` after the composition it wrote, and a second
 * spelling of this would mean `promote` printing a `--out` that `shoot` would
 * not have chosen - which is the whole mechanism by which the two records are
 * one record.
 *
 * The time is normalised through Date.parse first, so an ISO string carrying an
 * offset names the same directory as the same instant in UTC. Without that, a
 * `+02:00` stamp would sort into the archive two hours from where it belongs
 * and every reading of the directory listing would be wrong about the order.
 */
export function stampOf(at: string): string {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) {
    throw new Error(
      `${JSON.stringify(at)} is not a time, so no record directory can be named after it.`,
    );
  }
  return new Date(ms).toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");
}

/** Where a record of this kind, taken at this instant, on this channel, goes. */
export function recordDir(kind: "deploy" | "preview", at: string, channel: string): string {
  return `${kind === "preview" ? "previews" : "deploys"}/${stampOf(at)}-${channel}`;
}

/**
 * The channels whose promotes are archived.
 *
 * Real channels only. `test-qa` and `test-prod` belong to the live suite, which
 * promotes several times per run and would fill `deploys/` with its own traffic
 * - and every one of those records would be a record of a composition no
 * visitor was ever served.
 */
export const RECORDED_CHANNELS = ["qa", "prod"] as const;

export function keepsRecord(channel: string): boolean {
  return (RECORDED_CHANNELS as readonly string[]).includes(channel);
}

/** What one unit did in a promote. */
export type UnitMove = {
  /** The id the channel serves after this promote, or null for a unit it dropped. */
  unitId: string | null;
  /** The id it served before, or null for a unit this promote is the first of. */
  from: string | null;
  state: "moved" | "carried" | "new" | "dropped";
};

/**
 * Which units a promote MOVED and which it carried.
 *
 * The distinction the record exists for: `promote qa --app hello=<id>` writes a
 * whole composition, so the pointer bytes say nothing about which part of it the
 * operator asked for. A unit at the same id on both sides was carried by the
 * merge, and reading the manifest alone cannot tell that from a unit that was
 * deliberately re-deployed at the id it already had.
 *
 * A name on one side only is not an error here. `new` is a first promote, and
 * `dropped` is a unit that left the composition. That was impossible while
 * UNITS only ever grew; `PLAN.md` step 0 removed `hello`, so the first real
 * `dropped` entry is in the archive and a silent union would have lost it.
 */
export function unitMoves(
  before: Record<string, string> | null,
  after: Record<string, string>,
): Record<string, UnitMove> {
  const names = [...new Set([...Object.keys(before ?? {}), ...Object.keys(after)])].sort();
  const moves: Record<string, UnitMove> = {};
  for (const name of names) {
    const was = before?.[name] ?? null;
    const now = after[name] ?? null;
    const state =
      now === null ? "dropped" : was === null ? "new" : was === now ? "carried" : "moved";
    moves[name] = { unitId: now, from: was, state };
  }
  return moves;
}

/**
 * Every unit id a pointer names, read off the pointer and not off `UNITS`.
 *
 * The distinction cost this repository a reading. `promote` used to build this
 * by filtering the pointer's `apps` through `APPS` - the units THIS TREE builds
 * - which is right until the two differ. `PLAN.md` step 0 made them differ:
 * `hello` left the tree, the promote that removed it read a `before` with no
 * `hello` in it, and the record for the first deploy that ever dropped a unit
 * does not say a unit was dropped. `unitMoves` was ready for it and was handed
 * the wrong argument.
 *
 * The same filter sat under the region drift check, where it is worse: two
 * regions differing only in a unit this tree no longer builds read as agreeing,
 * and the promote flattens one of them.
 *
 * So this reads what the pointer says. A pointer naming a unit nothing here
 * builds is a fact about the channel, and every reader of it wants that fact.
 */
export function idsInPointer(
  pointer: { shell: { unitId: string }; apps: Record<string, { unitId: string }> } | null,
): Record<string, string> | null {
  if (pointer === null) return null;
  return {
    shell: pointer.shell.unitId,
    ...Object.fromEntries(Object.entries(pointer.apps).map(([name, u]) => [name, u.unitId])),
  };
}

/** The ids a promote record names, for comparing against a pointer. */
export function recordedIds(units: Record<string, { unitId: string | null }>): Record<string, string> {
  return Object.fromEntries(
    Object.entries(units)
      .filter(([, u]) => typeof u.unitId === "string")
      .map(([name, u]) => [name, u.unitId as string]),
  );
}

/**
 * A shell rendering of the argv, for a person reading the record.
 *
 * `argv` beside it is the exact reading; this one is what gets pasted back into
 * a terminal, so an argument that would not survive that - a space, a quote, an
 * empty string - is quoted rather than printed as it came.
 */
export function commandOf(argv: readonly string[]): string {
  const quote = (arg: string) => (/^[\w.,:=@/+-]+$/.test(arg) ? arg : JSON.stringify(arg));
  return ["bun", "run", "promote", ...argv.map(quote)].join(" ");
}

/** The line that fills this record's pictures in. */
export const BROWSER_REACHABLE = ["qa"] as const;

/**
 * The line that fills this record's pictures in, or why there is not one.
 *
 * `prod` is reached by a Host header and no browser sends one, so `shoot`
 * refuses it outright - and printing `--channel prod` regardless meant every
 * prod deploy ended with an instruction that cannot work, on the one channel
 * where the promote record is the whole record. §2 is the domain that changes
 * this, and until then the honest line says so.
 */
export function shootCommand(channel: string, dir: string): string {
  if (!(BROWSER_REACHABLE as readonly string[]).includes(channel)) {
    return `no browser can reach ${channel}, so ${dir} keeps its manifest bytes and no pictures. TODO §2 is the domain that would change that.`;
  }
  // `shoot` defaults to qa, so naming it would be noise on the common path and
  // is required on every other channel.
  return `bun run shoot${channel === "qa" ? "" : ` --channel ${channel}`} --out ${dir}`;
}

/**
 * A directory nothing has written a promote record into yet.
 *
 * `stampOf` truncates to the second, so two promotes inside one second name one
 * directory - and the record write had no existence check, so the first record
 * went with no trace. It cannot refuse: the pointer has already moved, and a
 * throw here would report a deploy that happened as one that did not. So it
 * takes the next free name instead.
 */
export function freeDir(base: string, taken: (dir: string) => boolean): string {
  if (!taken(base)) return base;
  for (let n = 2; n < 100; n++) {
    if (!taken(`${base}-${n}`)) return `${base}-${n}`;
  }
  throw new Error(`${base} and 98 names after it all hold a record.`);
}

/** What a promote did, written beside the bytes it put in the store. */
export type PromoteRecord = {
  schema: 1;
  kind: "promote";
  channel: string;
  argv: string[];
  command: string;
  startedAt: string;
  composedAt: string;
  writtenAt: string;
  regions: string[];
  /**
   * The tree the command was run from.
   *
   * Not the tree that built the units: each unit carries its own commit inside
   * the manifest beside this file. On a real channel the two agree anyway,
   * because `--from-build` refuses a build this tree did not make - and the
   * override that lifts that refusal is in `argv` and in `warnings`.
   */
  source: { commit: string; dirty: boolean; dirtyPaths?: string[] } | null;
  contract: string;
  units: Record<string, UnitMove>;
  /** Every WARNING line the promote printed: what it let through, in order. */
  warnings: string[];
  /** Region to the file holding the bytes that region's pointer was given. */
  manifests: Record<string, string>;
};

export function promoteRecord(act: {
  channel: string;
  argv: readonly string[];
  regions: readonly string[];
  source: { commit: string; dirty: boolean; dirtyPaths?: string[] } | null;
  contract: string;
  before: Record<string, string> | null;
  after: Record<string, string>;
  startedAt: string;
  composedAt: string;
  writtenAt: string;
  warnings: readonly string[];
}): PromoteRecord {
  return {
    schema: 1,
    kind: "promote",
    channel: act.channel,
    argv: [...act.argv],
    command: commandOf(act.argv),
    startedAt: act.startedAt,
    composedAt: act.composedAt,
    writtenAt: act.writtenAt,
    regions: [...act.regions],
    source: act.source,
    contract: act.contract,
    units: unitMoves(act.before, act.after),
    warnings: [...act.warnings],
    manifests: Object.fromEntries(act.regions.map((r) => [r, `manifest.${r}.json`])),
  };
}

/**
 * Why these shots do not belong in the directory a promote wrote, or null.
 *
 * `shoot --out <dir>` into a promote's record is how the two halves become one,
 * and the shot is checked against the POINTER rather than against the promote
 * that wrote the directory. So a second promote between the two would be shot
 * correctly and filed under the first one's record - and `shoot` would then
 * overwrite that record's manifest bytes with the newer pointer's, which is the
 * one file in it that nothing else can restate.
 *
 * The ids are not enough on their own. Promoting the same composition twice
 * moves `composedAt` and leaves every id where it was, which is exactly the
 * no-op promote an operator runs to check a channel - so the stamp is compared
 * as well as the ids.
 */
export function filedUnderRefusal(
  promote: {
    channel: string;
    composedAt: string;
    units: Record<string, { unitId: string | null }>;
    /** The regions this promote actually wrote. A `--region` run wrote one. */
    regions?: readonly string[];
  } | null,
  channel: string,
  serving: { composedAt: string | null; ids: Record<string, string> },
  dir: string,
): string | null {
  if (!promote) return null;
  if (promote.channel !== channel) {
    return `${dir} records a promote of ${promote.channel}, and this run shoots ${channel}. A record holds one channel.`;
  }
  const promoted = recordedIds(promote.units);
  if (!sameIds(promoted, serving.ids)) {
    return (
      `${dir} records a promote of ${describeIds(promoted)} and ${channel} now serves ` +
      `${describeIds(serving.ids)}. A later promote landed, so these shots are a picture of ` +
      `something else. Shoot into a new directory.`
    );
  }
  if (serving.composedAt !== null && promote.composedAt !== serving.composedAt) {
    // Two states produce this, and naming only the first sent an operator
    // hunting a promote that never happened. A record whose `regions` does not
    // hold every region is the second: the machine answering may be one this
    // promote deliberately left where it was, §3's supported exception.
    const partial = promote.regions !== undefined && promote.regions.length < 2;
    return (
      `${dir} records the promote composed at ${promote.composedAt}, and ${channel} serves the ` +
      `composition composed at ${serving.composedAt}. The ids match, so either the same units ` +
      `were promoted again after it` +
      (partial
        ? `, or the machine that answered is in a region this promote did not write - it names ` +
          `${promote.regions!.join(", ")}. Read the other region with REGION=<r>, or shoot into a new directory.`
        : `; these shots belong under that promote's record and not this one.`)
    );
  }
  return null;
}

/**
 * Why this record is not a picture of what the channel serves now, or null.
 *
 * Equal ids is the whole test and it is not enough on its own: a record of
 * another channel names ids that will never match, and the message for that has
 * to say which channel rather than list two compositions that were never
 * comparable.
 */
/**
 * The paths a porcelain status names, so a record can say what the dirt WAS.
 *
 * `dirty: true` is a true reading and a misleading one on its own: the second
 * of two promotes made without committing is dirty because of the FIRST one's
 * record, which is not source at all. A reader seeing `deploys/2026-...` in
 * this list knows that; a reader seeing only the flag does not.
 */
export const DIRTY_PATH_CAP = 20;

export function dirtyPaths(porcelain: string, cap = DIRTY_PATH_CAP): string[] {
  const paths = porcelain
    .split("\n")
    .map((line) => line.slice(3).trim())
    // A rename reads `old -> new`, and the path that matters is where the
    // content is now.
    .map((path) => (path.includes(" -> ") ? path.slice(path.indexOf(" -> ") + 4) : path))
    .filter(Boolean);
  // Capped because this is committed to a public repository and `git status`
  // lists untracked files: without a bound, a record publishes the whole of
  // whatever an operator happened to have lying in their checkout.
  if (paths.length <= cap) return paths;
  return [...paths.slice(0, cap), `and ${paths.length - cap} more`];
}

/** One directory under deploys/, and which of the two files it holds. */
export type PendingDir = {
  dir: string;
  channel: string;
  hasPromote: boolean;
  hasShots: boolean;
};

/**
 * Why a promote is recorded and not yet pictured, or null.
 *
 * `pr` reads the newest record by looking for a `shots.json`, so a promote that
 * wrote its own directory and was never shot is INVISIBLE to it - and what it
 * then finds is the previous deploy, whose ids no longer match, so the operator
 * is told the archive is stale without being told a newer directory is already
 * sitting there waiting for its pictures. Naming it is the difference between
 * one command to run and a hunt.
 */
export function pendingRefusal(dirs: readonly PendingDir[], channel: string): string | null {
  const records = dirs
    .filter((d) => d.channel === channel && d.hasPromote)
    .sort((a, b) => a.dir.localeCompare(b.dir));
  const newest = records.at(-1);
  // ONLY the newest, and that is the whole correction. `shoot` refuses to file
  // a picture under a promote the pointer has moved past, so an older unshot
  // record can never be filled - and the first version of this refused on
  // every one of them, told the operator to run a command that would be
  // refused, and left `bun run pr` deadlocked after two ordinary promotes. The
  // only way out was deleting a record from an archive whose premise is that
  // records are not falsified after the fact. Two promotes reach that state,
  // and the second of them is the rollback this repository exists for.
  if (!newest || newest.hasShots) return null;
  return (
    `${newest.dir} holds a promote and no pictures, so ${channel} was deployed and never shot. ` +
    `Run \`${shootCommand(channel, newest.dir)}\` and commit the record.`
  );
}

/**
 * The promotes whose pictures can no longer be taken, or null.
 *
 * A note and never a refusal. The pointer has moved past them, so `shoot`
 * refuses to file anything under them and nothing an operator does will change
 * that. The gap is real and belongs in the reading; blocking on it blocks
 * forever.
 */
export function unshotNote(dirs: readonly PendingDir[], channel: string): string | null {
  const records = dirs
    .filter((d) => d.channel === channel && d.hasPromote)
    .sort((a, b) => a.dir.localeCompare(b.dir));
  const stranded = records.slice(0, -1).filter((d) => !d.hasShots);
  if (stranded.length === 0) return null;
  return (
    `${stranded.length} ${stranded.length === 1 ? "promote has" : "promotes have"} no pictures and ` +
    `can no longer be shot: ${stranded.map((d) => d.dir).join(", ")}. The pointer moved past them. ` +
    `Their manifest bytes are complete; only the images are missing.`
  );
}

/**
 * Every unit a promote's composition holds.
 *
 * `built` is what this working tree can emit, `served` is what the channel's
 * pointer already names, and `drop` is what the operator asked to remove. The
 * union of the first two is the point: they differ the moment a sub-app is
 * taken out of the source, and composing from `built` alone removed such a unit
 * from every channel at the next promote of anything - silently, because a unit
 * nobody builds is a unit nothing iterates. That is the pointer that took a
 * region down on 2026-09-10.
 *
 * The shell is never removable: a channel with no shell serves no page.
 */
export function composedFrom(
  built: readonly string[],
  served: Record<string, unknown>,
  drop: readonly string[],
): string[] {
  const remove = new Set(drop.filter((u) => u !== "shell"));
  return [...new Set([...built, ...Object.keys(served)])].filter((u) => !remove.has(u));
}

export function staleRefusal(
  record: { channel: string; units: Record<string, string> } | null,
  channel: string,
  live: Record<string, string>,
  dir: string,
  composedAt: { record: string | null; live: string | null } = { record: null, live: null },
): string | null {
  if (!record) {
    return `deploys/ holds no record for ${channel}, so there is no picture of what it serves. Run \`bun run shoot\`.`;
  }
  if (record.channel !== channel) {
    return `${dir} is a record of ${record.channel}, and this run is about ${channel}.`;
  }
  if (composedAt.record !== null && composedAt.live !== null && composedAt.record !== composedAt.live) {
    // Ids alone cannot see a promote of the ids a channel already serves, and
    // that promote is exactly what this branch used to verify itself. The
    // reviewer's gate has to read what the shooter's gate reads.
    return (
      `${dir} is a picture of the composition composed at ${composedAt.record}, and ${channel} ` +
      `serves the one composed at ${composedAt.live}. The ids did not move, so a promote of the ` +
      `same units landed after this record. Shoot the newer promote's record and commit it.`
    );
  }
  if (!sameIds(record.units, live)) {
    return (
      `${dir} holds ${describeIds(record.units)} and ${channel} now serves ${describeIds(live)}. ` +
      `The newest deploy record is not a picture of production, so this run would put a stale ` +
      `image beside a live one. Run the \`bun run shoot --out <dir>\` line that promote printed - ` +
      `a bare \`bun run shoot\` would open a second directory for one deploy - and commit the record.`
    );
  }
  return null;
}

// -- the archive, gathered ----------------------------------------------------
//
// `deploys/` is one directory per deploy and nothing reads it, so the archive is
// a directory listing and the hand-written line in each `notes.md` is gathered
// nowhere. `CHANGELOG.md` is that archive as a document: one entry per record,
// newest first, written by `bun run changelog` and never by hand.
//
// Everything below is a function of what a record HOLDS. The filesystem half -
// which directories exist and what is in them - is scripts/changelog.ts, so
// scripts/record.test.ts can put each reading in the state that breaks it, and
// scripts/changelog.test.ts renders the real archive and fails when the file on
// disk differs.

/** A record's `shots.json`, as far as the changelog reads it. */
export type ShotsFile = {
  schema?: number;
  takenAt?: string;
  kind?: "deploy" | "preview";
  channel?: string;
  region?: string;
  contract?: string;
  composedAt?: string | null;
  units?: Record<string, string>;
  manifests?: Record<string, string>;
  shots?: ShotEntry[];
};

/**
 * A record's `promote.json`.
 *
 * Every field optional, because schema 1 is not the last schema and the oldest
 * record in the archive has no such file at all. A reading that assumed the
 * shape would render `undefined` into a document whose whole claim is that it
 * restates the archive.
 */
export type PromoteFile = Partial<PromoteRecord>;

/** One directory under `deploys/`, read. */
export type ArchiveRecord = {
  dir: string;
  promote: PromoteFile | null;
  shots: ShotsFile | null;
  /** The whole of `notes.md`, or null where there is no such file. */
  notes: string | null;
  /**
   * The `manifest.*.json` files the directory holds.
   *
   * Read from the directory rather than from either JSON, because a record can
   * hold the pointer bytes and neither of them: `writeRecord` in
   * scripts/promote.ts writes the manifests before `promote.json` and awaits
   * neither, so a promote that moved a real pointer can leave its bytes behind
   * with no act beside them. Skipping such a directory would drop from the
   * document exactly the record the archive exists for.
   */
  manifestFiles: readonly string[];
};

/**
 * The line `shoot` writes into `notes.md` when nobody passed `--note`.
 *
 * One definition, imported by scripts/shoot.ts, because the changelog has to
 * recognise it. A record whose note is still this has a first line and says
 * nothing, and a check that only refused an ABSENT line would pass over every
 * one of them - which is the reachable state, `shoot` writing it being the
 * default path.
 */
export const NOTE_PLACEHOLDER = "TODO: one line saying what this deploy demonstrates.";

/**
 * The hand-written line, or null when there is not one.
 *
 * The first NON-EMPTY line: a note that opens with a blank line still says what
 * its deploy demonstrates, and rendering the blank would drop the one sentence
 * in the record a person wrote.
 */
export function noteHeadline(notes: string | null): string | null {
  if (notes === null) return null;
  for (const line of notes.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) return trimmed;
  }
  return null;
}

/**
 * Free text, safe inside a markdown table cell.
 *
 * A `|` in a note, a warning or an argv ends the cell and shifts every column
 * after it, so a record holding one would silently rewrite the table it appears
 * in. A newline does the same to the row. Both come from files this does not
 * control: `notes.md` is hand-written and `warnings` is whatever a promote
 * printed.
 */
export function cell(text: string): string {
  return text.replace(/\s+/g, " ").trim().replace(/\|/g, "\\|");
}

/**
 * The channel a record directory names, or null.
 *
 * `recordDir` puts it there, so a record holding neither JSON still says which
 * channel it belongs to - and `unknown channel` in its place is worse than a
 * reading, because `picturesCell` then tells the reader no browser can reach a
 * channel that does not exist.
 */
export function channelFromDir(dir: string): string | null {
  const base = dir.split("/").at(-1) ?? "";
  const found = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}Z-(.+?)(?:-\d+)?$/.exec(base);
  return found ? found[1]! : null;
}

/** What a record says its channel is, from whichever part of it survives. */
export function channelOf(record: ArchiveRecord): string {
  return (
    record.promote?.channel ?? record.shots?.channel ?? channelFromDir(record.dir) ?? "unknown channel"
  );
}

/**
 * What a record's act amounts to.
 *
 * `no-op` is the reading this exists for. A promote every one of whose units was
 * CARRIED rewrote a pointer to the composition it already named: a real write to
 * a real channel, and not a deploy anybody asked for. Four of the five records
 * in the archive are that, made to exercise the recorder, and a changelog that
 * listed them as deploys would be a false reading of its own source.
 *
 * `unrecorded` is the oldest record, which predates `promote.json`: pictures and
 * pointer bytes, and no act to report.
 */
export type ChangeKind = "moved" | "no-op" | "unrecorded";

/**
 * What one unit did, read from its ids rather than from the word beside them.
 *
 * `state` is a stored label and `from`/`unitId` are what it was derived from.
 * The argument for this whole document is that a reading comes off
 * `promote.json` and not off prose, and a stored label is prose with a schema -
 * so it is recomputed, and `labelDisagreements` names a record whose label and
 * ids do not agree instead of letting the two quietly differ.
 */
export function stateOf(u: { unitId: string | null; from: string | null }): UnitMove["state"] {
  if (u.unitId === null) return "dropped";
  if (u.from === null) return "new";
  return u.from === u.unitId ? "carried" : "moved";
}

/** Where a record's own label disagrees with its own ids. */
export function labelDisagreements(units: Record<string, UnitMove> | undefined): string[] {
  if (!units) return [];
  return Object.entries(units)
    .sort(byName)
    .filter(([, u]) => u.state !== undefined && u.state !== stateOf(u))
    .map(([name, u]) => `${name} is labelled ${u.state} and its ids read ${stateOf(u)}`);
}

export function changeKind(promote: PromoteFile | null): ChangeKind {
  const units = promote?.units;
  if (!units || Object.keys(units).length === 0) return "unrecorded";
  return Object.values(units).every((u) => stateOf(u) === "carried") ? "no-op" : "moved";
}

const byName = ([a]: [string, unknown], [b]: [string, unknown]): number => a.localeCompare(b);

/** Which units this promote moved, in one line, or why there is no answer. */
export function movedSummary(units: Record<string, UnitMove> | undefined): string {
  if (!units || Object.keys(units).length === 0) return "not recorded";
  const parts = Object.entries(units)
    .sort(byName)
    .filter(([, u]) => stateOf(u) !== "carried")
    .map(([name, u]) => {
      if (stateOf(u) === "dropped") return `${name} dropped (was ${u.from ?? "an id it did not record"})`;
      // "added", not "first promote". `new` says the composition this promote
      // replaced held no id for this unit - which is also true of a unit that
      // was dropped and put back, and `deploys/2026-09-10T21-15-37Z-qa` is one:
      // `hello 3bba892b` had been served for weeks before the promote eight
      // minutes earlier removed it. The record cannot see a unit's history and
      // must not imply it has.
      if (stateOf(u) === "new") return `${name} ${u.unitId} (added)`;
      return `${name} ${u.from} → ${u.unitId}`;
    });
  return parts.length ? parts.join(", ") : "nothing";
}

/**
 * Which units the merge carried.
 *
 * The half no later reading can recover: the pointer holds the whole
 * composition however few units the operator named, so `promote.json` is the
 * only place a carried unit is distinguishable from a re-deployed one.
 */
export function carriedSummary(units: Record<string, UnitMove> | undefined): string {
  if (!units || Object.keys(units).length === 0) return "not recorded";
  const parts = Object.entries(units)
    .sort(byName)
    .filter(([, u]) => stateOf(u) === "carried")
    .map(([name, u]) => `${name} ${u.unitId}`);
  return parts.length ? parts.join(", ") : "nothing";
}

/**
 * Which regions this act wrote, and which the record only KEPT.
 *
 * `--region eu` writes one region and leaves the other where it was, §3's
 * supported exception - and the record then holds `manifest.us.as-served.json`
 * beside `manifest.eu.json`, which is a different deploy's pointer under a name
 * that says so. An entry reading the manifests as the regions this promote
 * wrote would claim a deploy that did not happen.
 */
export function manifestRegions(files: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of [...files].sort()) {
    const m = /^manifest\.([^.]+)\.(?:as-served\.)?json$/.exec(f);
    if (!m) continue;
    const region = m[1]!;
    // The bytes a promote PUT beat the bytes a shoot filed for a region it did
    // not write, where a record holds both under one region.
    const served = f.includes(".as-served.");
    if (!(region in out) || (out[region]!.includes(".as-served.") && !served)) out[region] = f;
  }
  return out;
}

/**
 * The regions a channel has, for the reading a record cannot take from itself.
 *
 * Imported rather than restated: `src/server/origins.ts` is where a region is
 * defined, and a second list here is how a record comes to claim a region that
 * does not exist or miss one that does.
 */
const ALL_REGIONS: readonly string[] = REGIONS;

export function regionsCell(
  promote: PromoteFile | null,
  shots: ShotsFile | null,
  manifestFiles: readonly string[] = [],
): string {
  const declared = shots?.manifests ?? promote?.manifests;
  const kept = declared ?? manifestRegions(manifestFiles);
  const written = promote?.regions;
  if (!written) {
    const names = Object.keys(kept).sort();
    return names.length
      ? `not recorded. The record keeps pointer bytes for ${names.join(", ")}, and with no promote.json nothing says which of them an act wrote`
      : "not recorded";
  }
  // Every region the store has, not only the ones this record kept bytes for.
  // `promoteRecord` builds `manifests` from the regions it WROTE, so for a
  // record with no shots.json the two are identical by construction and the §3
  // reading vanished - on `prod`, which can never be shot, and where the
  // promote record is the whole record.
  const others = [...new Set([...Object.keys(kept), ...ALL_REGIONS])]
    .filter((r) => !written.includes(r))
    .sort();
  if (others.length === 0) return written.join(", ");
  const named = others
    .map((r) => (kept[r] ? `${r} (\`${cell(kept[r]!)}\`)` : `${r} (no bytes kept)`))
    .join(", ");
  return `${written.join(", ")} only. ${named} ${others.length === 1 ? "was" : "were"} not written by this promote, so ${others.length === 1 ? "that region serves" : "those regions serve"} whatever an earlier promote put there`;
}

/** The tree the command was run from, and what made it dirty. */
export function sourceCell(source: PromoteFile["source"] | undefined): string {
  if (!source) return "not recorded";
  const commit = source.commit ? source.commit.slice(0, 7) : "an unread commit";
  if (!source.dirty) return `${commit}, clean tree`;
  const paths = source.dirtyPaths?.length ? `: ${source.dirtyPaths.map(cell).join(", ")}` : "";
  return `${commit}, dirty tree${paths}`;
}

/**
 * How many warnings this promote let through, or that nothing recorded any.
 *
 * `none` and `not recorded` are two different states and the archive holds
 * both: every promote so far printed nothing, and the record that predates
 * `promote.json` has no such field to be empty.
 */
export function warningsCell(promote: PromoteFile | null): string {
  const warnings = promote?.warnings;
  if (!warnings) return "not recorded";
  if (warnings.length === 0) return "none";
  return `${warnings.length}, listed below`;
}

/**
 * The warnings, as a block under the table.
 *
 * Not a cell: a promote can print several, each of them a sentence, and a table
 * cell holding four sentences joined by semicolons is a cell nobody reads. The
 * empty case is the only one the archive has so far, which is exactly why this
 * is written for the other one.
 */
export function warningsBlock(promote: PromoteFile | null): string[] {
  const warnings = promote?.warnings ?? [];
  if (warnings.length === 0) return [];
  return [
    "",
    `This promote printed ${warnings.length} ${warnings.length === 1 ? "warning" : "warnings"} and let ${warnings.length === 1 ? "it" : "them"} through:`,
    "",
    ...warnings.map((w) => `- ${cell(w)}`),
  ];
}

/** The pictures, linked, and any panel that rendered its error state. */
export function picturesCell(record: ArchiveRecord): string {
  if (!record.shots) {
    // A channel no browser can reach has no pictures and never will, and an
    // entry reading `none` alone is indistinguishable from a deploy somebody
    // forgot to shoot. `prod` is the case, and it is the channel where the
    // promote record is the whole record.
    const channel = channelOf(record);
    return (BROWSER_REACHABLE as readonly string[]).includes(channel)
      ? "none. This record holds no `shots.json`, so the promote was never shot"
      : `none, and none are possible: no browser can reach ${cell(channel)}. TODO §2 is what changes that`;
  }
  const shots = record.shots.shots ?? [];
  if (shots.length === 0) return "none. `shots.json` names no view";
  const name = (s: ShotEntry) => cell(s.route ?? "an unnamed route");
  const links = shots
    .map((s) => (s.file ? `[${name(s)}](${encodeURI(`${record.dir}/${s.file}`)})` : `${name(s)} (no file recorded)`))
    .join(", ");
  const failed = shots.filter((s) => (s.panelErrors ?? []).length > 0);
  if (failed.length === 0) return `${shots.length} ${shots.length === 1 ? "view" : "views"}: ${links}`;
  const drew = failed
    .map((s) => `${name(s)} drew ${s.panelErrors.map(cell).join(", ")} in an error state`)
    .join("; ");
  return `${shots.length} ${shots.length === 1 ? "view" : "views"}: ${links}. ${drew}`;
}

/**
 * The instant this entry is about.
 *
 * The composition's own `composedAt` where an act recorded one, because that is
 * the moment the channel was pointed at it. A record with no act falls back to
 * the pictures, which is a reading of the same pointer taken later - and the
 * oldest record shows the gap: named for 16:12, when it was shot, of a
 * composition composed at 11:18.
 */
export function composedAtOf(record: ArchiveRecord): string | null {
  return record.promote?.composedAt ?? record.shots?.composedAt ?? null;
}

export function entryInstant(record: ArchiveRecord): string | null {
  // The row is `composedAtOf` and this is not: a record whose pointer carried
  // no stamp - the state `servesWanted` supports - would otherwise put the
  // moment somebody took a screenshot under a heading that says composed.
  return composedAtOf(record) ?? record.shots?.takenAt ?? null;
}

/**
 * An instant a person reads, or the string as written when it is not one.
 *
 * A record naming a time nothing can parse is a record with a problem, and
 * `Invalid Date` in a generated document hides which record it was.
 *
 * To the second, which is what the directory names are to. Two promotes 18
 * seconds apart are two records, and to the minute their headings are the same
 * line twice - which is a duplicate anchor in the document and, worse, two
 * entries a reader cannot tell apart.
 */
export function humanTime(at: string): string {
  const ms = Date.parse(at);
  if (Number.isNaN(ms)) return at;
  const iso = new Date(ms).toISOString();
  return `${iso.slice(0, 10)} ${iso.slice(11, 19)} UTC`;
}

/**
 * Why this record's note is not an entry, or null.
 *
 * Only a record `shoot` wrote can have one: `promote` writes no `notes.md`, and
 * `shoot` refuses a channel no browser can reach. So a promote with no pictures
 * is not a record missing its note - there was never a run that could write
 * one, and demanding it would make the first `prod` deploy a permanently red
 * suite over a record the design says is correct.
 *
 * The placeholder is the reachable failure and the absent line is not:
 * `shoot` writes `NOTE_PLACEHOLDER` whenever nobody passed `--note`, so a check
 * that only refused an empty file would pass over every unwritten note there
 * has ever been.
 */
export function noteRefusal(record: ArchiveRecord): string | null {
  if (!record.shots) return null;
  const head = noteHeadline(record.notes);
  if (head === null) {
    return `${record.dir} was shot and holds no notes.md line, so its entry says nothing about what the deploy demonstrates.`;
  }
  if (head === NOTE_PLACEHOLDER) {
    return `${record.dir}/notes.md still holds the line shoot writes when nobody passed --note. Replace it with what this deploy demonstrates.`;
  }
  return null;
}

/**
 * The `-N` a second record in one second is given, or null.
 *
 * `stampOf` truncates to the second and `freeDir` takes the next free name, so
 * two promotes inside one second are two directories and ONE heading - a
 * duplicate anchor, and two entries a reader can tell apart only by following
 * the link. The suffix is the thing that already distinguishes them.
 */
export function recordSuffix(dir: string): string | null {
  const found = /-(\d+)$/.exec(dir.split("/").at(-1) ?? "");
  return found ? found[1]! : null;
}

/** When an entry is about, for a heading and for the index. */
export function entryWhen(record: ArchiveRecord): string {
  const at = entryInstant(record);
  return at ? humanTime(at) : (record.dir.split("/").at(-1) ?? record.dir);
}

export function entryTitle(record: ArchiveRecord): string {
  const kind = changeKind(record.promote);
  const what =
    kind === "unrecorded"
      ? "no act recorded"
      : kind === "no-op"
        ? "nothing moved"
        : movedSummary(record.promote?.units);
  const suffix = recordSuffix(record.dir);
  return `${cell(entryWhen(record))} · ${cell(channelOf(record))} · ${cell(what)}${suffix ? ` (record ${cell(suffix)})` : ""}`;
}

/** Newest first, by the directory name, which is the order the archive itself has. */
export function sortArchive(records: readonly ArchiveRecord[]): ArchiveRecord[] {
  return [...records].sort((a, b) => b.dir.localeCompare(a.dir));
}

const NO_OP_READING =
  "**Nothing moved.** Every unit was carried, so the pointer was rewritten to the composition it already named. That is a real write to a real channel and it is not a deploy anybody asked for.";

const NO_PROMOTE_READING =
  "**No act recorded.** This record holds no `promote.json`, so what was run, what it carried and what it let through are not in the archive. What it does hold is in the rows below.";

// A different state from the one above, and the prose has to be different with
// it: `PromoteFile` is a Partial because schema 1 is not the last schema, so a
// promote can record no unit while recording its command, its source and its
// contract - and telling a reader the file is absent, above a table quoting it,
// is the document contradicting itself.
const NO_UNITS_READING =
  "**No composition recorded.** This record's `promote.json` names no unit, so which units moved and which the merge carried cannot be read from it. The rest of the act is in the rows below.";

// `deploys/` is what was SERVED and `previews/` is what a branch WOULD serve.
// `outRefusal` guards the shooter, and nothing guards a copy, a `git mv` or a
// record older than that refusal.
const PREVIEW_IN_ARCHIVE =
  "**This record declares itself a preview.** Its `shots.json` says `kind: preview`, which is a composition nobody promoted and no channel ever pointed at. `deploys/` is the archive of what was served, so this directory is in the wrong place and the entry below is not a deploy.";

const table = (rows: ReadonlyArray<readonly [string, string]>): string[] => [
  "| | |",
  "| --- | --- |",
  ...rows.map(([name, value]) => `| ${name} | ${value} |`),
];

/**
 * The entry's first sentence: the note, or why there is not one.
 *
 * A record `shoot` never wrote has no note and was never going to - `promote`
 * writes none, and no browser reaches `prod` - so telling its reader that
 * nothing says what the deploy demonstrates reads as a reproach for a file the
 * tooling cannot produce. `noteRefusal` already holds which records owe one.
 */
export function noteSentence(record: ArchiveRecord): string {
  const head = noteHeadline(record.notes);
  if (head !== null && head !== NOTE_PLACEHOLDER) return cell(head);
  if (noteRefusal(record) === null) {
    // Three states, and the first version called all three "No `notes.md`" -
    // a false sentence about a file sitting in the directory. A `prod` record
    // is exactly this shape, and exactly where somebody would place one by hand.
    if (record.notes === null) {
      return "No `notes.md`. `promote` writes none and only a `shoot` run writes one, and this record has no pictures.";
    }
    return head === NOTE_PLACEHOLDER
      ? "`notes.md` holds the line `shoot` writes when nobody passed `--note`, so nothing in this record says what the deploy demonstrates. This record has no pictures, so no run was ever going to replace it."
      : "`notes.md` holds no line, so nothing in this record says what the deploy demonstrates. This record has no pictures, so no run was ever going to write one.";
  }
  return head === NOTE_PLACEHOLDER
    ? "`notes.md` still holds the line `shoot` writes when nobody passed `--note`, so nothing in this record says what the deploy demonstrates."
    : "`notes.md` holds no line, so nothing in this record says what the deploy demonstrates.";
}

/** One record, as an entry. */
export function changelogEntry(record: ArchiveRecord): string[] {
  const promote = record.promote;
  const kind = changeKind(promote);
  const shots = record.shots;
  const contract = promote?.contract ?? shots?.contract ?? null;

  const lines = [`## ${entryTitle(record)}`, ""];
  lines.push(noteSentence(record), "");
  if (record.shots?.kind === "preview") lines.push(PREVIEW_IN_ARCHIVE, "");
  if (kind === "no-op") lines.push(NO_OP_READING, "");
  if (kind === "unrecorded") lines.push(promote ? NO_UNITS_READING : NO_PROMOTE_READING, "");
  // A record whose stored label disagrees with its own ids is reported on the
  // ids, and the disagreement is named rather than resolved in silence.
  for (const line of labelDisagreements(promote?.units)) {
    lines.push(`**The record disagrees with itself.** ${cell(line)}. The ids are what this entry reads.`, "");
  }

  lines.push(
    ...table([
      ["Composed at", cell(composedAtOf(record) ?? "not recorded")],
      ["Contract", contract ? `\`${cell(contract)}\`` : "not recorded"],
      ["Regions", regionsCell(promote, shots, record.manifestFiles)],
      ["Moved", cell(movedSummary(promote?.units))],
      ["Carried", cell(carriedSummary(promote?.units))],
      ["Command", promote?.command ? `\`${cell(promote.command)}\`` : "not recorded"],
      ["Source", sourceCell(promote?.source)],
      ["Warnings", warningsCell(promote)],
      ["Pictures", picturesCell(record)],
      [
        "Shot at",
        shots?.takenAt
          ? `${cell(shots.takenAt)}${shots.region ? `, from ${cell(shots.region)}` : ""}`
          : "not shot",
      ],
      ["Record", `[\`${cell(record.dir)}\`](${encodeURI(record.dir)})`],
    ]),
  );
  lines.push(...warningsBlock(promote));
  lines.push("");
  return lines;
}

/** What the archive as a whole says, counted rather than asserted. */
export function changelogSummary(records: readonly ArchiveRecord[]): string[] {
  if (records.length === 0) {
    return ["`deploys/` holds no record, so there is nothing to gather yet.", ""];
  }
  const sorted = sortArchive(records);
  const channels = [...new Set(sorted.map(channelOf))].sort();
  const kinds = sorted.map((r) => changeKind(r.promote));
  const moved = kinds.filter((k) => k === "moved").length;
  const noop = kinds.filter((k) => k === "no-op").length;
  const unrecorded = kinds.filter((k) => k === "unrecorded").length;
  const warned = sorted.filter((r) => (r.promote?.warnings?.length ?? 0) > 0).length;
  const promotes = sorted.filter((r) => r.promote !== null).length;
  // A promote.json with no `warnings` field at all is a Partial<PromoteRecord>,
  // and it is the state NO_UNITS_READING exists for. Counting it as a promote
  // that printed nothing is the entries' `none` / `not recorded` distinction
  // flattened one level up, where a skim-reader meets it first.
  const silentOnWarnings = sorted.filter(
    (r) => r.promote !== null && !Array.isArray(r.promote.warnings),
  ).length;

  // Ordered by directory and DATED by the composition, and the archive already
  // holds one record where the two disagree by five hours - so the range is
  // taken from the instants themselves rather than from the ends of the sort.
  const dated = sorted
    .map((r) => ({ at: entryInstant(r) }))
    .filter((d): d is { at: string } => d.at !== null && !Number.isNaN(Date.parse(d.at)))
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  const span =
    dated.length === 0
      ? "None of them names an instant this can read."
      : dated.length === 1
        ? `The one composition they name was composed at ${cell(humanTime(dated[0]!.at))}.`
        : `The compositions they name run from ${cell(humanTime(dated[0]!.at))} to ${cell(humanTime(dated.at(-1)!.at))}.`;

  const lines = [
    `${records.length} ${records.length === 1 ? "record" : "records"} on ${channels.map(cell).join(", ")}, ` +
      `newest first by record directory. ${span}`,
    "",
    `${moved} moved at least one unit, ${noop} rewrote a pointer to the composition it already ` +
      `named, and ${unrecorded} ${unrecorded === 1 ? "holds" : "hold"} no act at all.`,
    "",
  ];
  // A universal claim may only be made over the records this can read. A record
  // with no act - the archive's oldest is one, and it is the composition every
  // other record carries forward - was silently folded into "no record moved a
  // unit", which was false in the committed file and is the exact failure this
  // whole document exists to prevent: a sentence the generator cannot support.
  if (moved === 0 && noop > 0) {
    lines.push(
      unrecorded === 0
        ? "**No record in this archive moved a unit.** Every promote here rewrote a pointer to the " +
            "composition it already named, which is a write to a real channel and not a deploy " +
            "anybody asked for. `TODO.md` §34 carries the reading."
        : `**No promote this archive can read moved a unit.** Every one of them rewrote a pointer ` +
            `to the composition it already named, which is a write to a real channel and not a ` +
            `deploy anybody asked for. ${unrecorded} ${unrecorded === 1 ? "record holds" : "records hold"} ` +
            `no act, so what ${unrecorded === 1 ? "it" : "they"} moved is not recorded here and this ` +
            `sentence does not speak for ${unrecorded === 1 ? "it" : "them"}. \`TODO.md\` §34 carries the reading.`,
      "",
    );
  }
  if (promotes > 0) {
    const readable = promotes - silentOnWarnings;
    const caveat =
      silentOnWarnings === 0
        ? ""
        : ` ${silentOnWarnings} ${silentOnWarnings === 1 ? "promote records" : "promotes record"} no ` +
          `warnings field at all, so nothing here says what ${silentOnWarnings === 1 ? "it" : "they"} printed.`;
    if (readable > 0 || silentOnWarnings === 0) {
      lines.push(
        (warned === 0
          ? `No promote this archive can read printed a warning, so no entry below lists one.`
          : warned === 1
            ? "1 promote printed a warning, and its entry lists what it let through."
            : `${warned} promotes printed warnings, and each of those entries lists what it let through.`) +
          caveat,
        "",
      );
    } else {
      lines.push(caveat.trim(), "");
    }
  }
  return lines;
}

/** The index, so the archive can be read without reading every entry. */
export function changelogIndex(records: readonly ArchiveRecord[]): string[] {
  if (records.length === 0) return [];
  return [
    "| When | Channel | What moved | Record |",
    "| --- | --- | --- | --- |",
    ...sortArchive(records).map(
      (r) =>
        `| ${entryWhen(r)} | ${cell(channelOf(r))} | ${cell(movedSummary(r.promote?.units))} | ` +
        `[\`${r.dir}\`](${r.dir}) |`,
    ),
    "",
  ];
}

export const CHANGELOG_HEADER = [
  "# Deploy changelog",
  "",
  "**Generated by `bun run changelog` from the records in `deploys/`. Nothing in this file is written by hand.**",
  "",
  "Every line below is derived from the files in `deploys/`. **This file is not committed** - it is in `.gitignore`, because every fact in it is already in `deploys/`, which is. So there is nothing here to go stale, no check needed to catch that, and no two branches conflicting over its counts. Delete it and nothing is lost; run `bun run changelog` and it is back. An edit made here is gone at the next run: to change what an entry says, change the record - `notes.md` is the one file in it a person writes - and run the command again.",
  "",
];

/** The whole file. */
export function renderChangelog(records: readonly ArchiveRecord[]): string {
  const sorted = sortArchive(records);
  const lines = [
    ...CHANGELOG_HEADER,
    ...changelogSummary(sorted),
    ...changelogIndex(sorted),
    ...sorted.flatMap((r) => changelogEntry(r)),
  ];
  // One trailing newline, and no run of blank lines: every section here ends
  // with one already, so joining them without this leaves the file's shape
  // depending on how many sections happened to be empty.
  return `${lines.join("\n").replace(/\n{3,}/g, "\n\n").trimEnd()}\n`;
}
