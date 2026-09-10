// The readings a deploy record is built from, with no store, no browser and no
// git in any of them.
//
// scripts/shoot.ts and scripts/pr.ts were 750 lines of decisions that could
// only be exercised by publishing to the production store and driving a
// browser, which is the shape `~/projects/CLAUDE.md` warns about: a check that
// can only run against the real thing is a check that does not run. Everything
// here is a function of its arguments, so scripts/record.test.ts can put each
// one in the state that breaks it.

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
 * `dropped` is a unit that left the composition - which UNITS makes impossible
 * today and which a silent union would lose the day it stops being.
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
export function shootCommand(channel: string, dir: string): string {
  // `shoot` defaults to qa, so naming it would be noise on the common path and
  // is required on every other channel.
  return `bun run shoot${channel === "qa" ? "" : ` --channel ${channel}`} --out ${dir}`;
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
  source: { commit: string; dirty: boolean } | null;
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
  source: { commit: string; dirty: boolean } | null;
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
  promote: { channel: string; composedAt: string; units: Record<string, { unitId: string | null }> } | null,
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
    return (
      `${dir} records the promote composed at ${promote.composedAt}, and ${channel} serves the ` +
      `composition composed at ${serving.composedAt}. The ids match, so the same units were ` +
      `promoted again after it; these shots belong under that promote's record and not this one.`
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
export function staleRefusal(
  record: { channel: string; units: Record<string, string> } | null,
  channel: string,
  live: Record<string, string>,
  dir: string,
): string | null {
  if (!record) {
    return `deploys/ holds no record for ${channel}, so there is no picture of what it serves. Run \`bun run shoot\`.`;
  }
  if (record.channel !== channel) {
    return `${dir} is a record of ${record.channel}, and this run is about ${channel}.`;
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
