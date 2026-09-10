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
      `image beside a live one. Run \`bun run shoot\` and commit the record.`
    );
  }
  return null;
}
