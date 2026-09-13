// Which regions a promote writes, and when it must refuse to, §3.
//
// A channel names one composition, and a machine reads the manifest for its own
// region alone. So a promote that wrote one region would leave every other
// region serving what it served before - silently, because nothing compares
// them and each machine is answering correctly from what it can see.
//
// The default is therefore every region, and the two readings here are what
// make that safe:
//
//   the region flag   `--region us` writes one, for a deliberate difference
//   the drift check   two regions already serving different compositions is a
//                     state a promote must not flatten by accident
//   the split report  the same state read at the START of a suite run, with the
//                     one command that fixes it. TODO §42
//
// Pure. The store reads are in promote.ts.

import { REGIONS, type Region } from "../src/server/origins.ts";

export { REGIONS, type Region };

/** What a pointer names, or null for a region that has no pointer yet. */
export type RegionComposition = {
  region: Region;
  /** Unit name to unit id. Null when nothing is published there. */
  ids: Record<string, string> | null;
};

/**
 * The regions this invocation writes.
 *
 * An unknown region is refused rather than ignored: `--region eu1` writing
 * every region because the flag did not match anything is the accident this
 * exists to prevent.
 */
export function regionsFor(argv: string[]): { regions: Region[] } | { error: string } {
  const i = argv.indexOf("--region");
  if (i === -1) return { regions: [...REGIONS] };
  const named = argv[i + 1];
  if (!named) return { error: `--region takes a region: ${REGIONS.join(", ")}` };
  if (!(REGIONS as readonly string[]).includes(named)) {
    return { error: `unknown region ${JSON.stringify(named)}. Expected one of ${REGIONS.join(", ")}.` };
  }
  return { regions: [named as Region] };
}

/**
 * Why these regions cannot be written together, or null.
 *
 * A region with no pointer is not a disagreement - it is the state a first
 * promote is there to fix, and refusing it would make a new region
 * unreachable except by hand. Two regions that BOTH name a composition, and
 * name different ones, is the state that has to stop a promote: whichever one
 * an operator merged onto, the other would be overwritten with a composition
 * nobody chose for it.
 */
export function regionDrift(compositions: RegionComposition[]): string | null {
  const known = compositions.filter((c) => c.ids !== null) as Array<
    RegionComposition & { ids: Record<string, string> }
  >;
  if (known.length < 2) return null;

  const first = known[0]!;
  for (const other of known.slice(1)) {
    const differing = unitsThatDiffer(first.ids, other.ids);
    if (differing.length === 0) continue;
    return (
      `${first.region} and ${other.region} serve different compositions: ` +
      differing
        .map((u) => `${u} ${first.ids[u] ?? "none"} != ${other.ids[u] ?? "none"}`)
        .join(", ") +
      `. Writing both would replace one with a composition nobody chose for it. ` +
      `Name one with --region <${REGIONS.join("|")}>.`
    );
  }
  return null;
}

/**
 * Why a channel cannot be promoted at all, and the one command that fixes it.
 *
 * A DIFFERENT reading from `regionDrift`, which is what a promote prints when
 * it refuses. This is what a person needs at the START of a run: `regionDrift`
 * says two regions disagree, and a person meeting it 41 times reads it as a
 * code failure. This says which channel, what an earlier run left behind, and
 * the promote that puts it back.
 *
 * TODO §42. Measured on 2026-09-11: `bun run verify:live` was killed at
 * scenario 9 of 46, its `After` hook never put the moved region back, and the
 * next run failed 41 of 46 - every one of them in its Background, on
 * `regionDrift`'s message. The refusal is correct and the reading it does not
 * give is why.
 *
 * `base` is the region whose composition the recovery names, because that is
 * the one the suite reads and the one every other region is put back TO.
 * Returns null when there is nothing to say.
 */
export function splitChannelReport(
  channel: string,
  compositions: RegionComposition[],
  base: Region,
): string | null {
  const known = compositions.filter((c) => c.ids !== null) as Array<
    RegionComposition & { ids: Record<string, string> }
  >;

  // No `known.length < 2` guard, and its absence is measured. `regionDrift`
  // above has one and needs it; here it is unreachable, because one known
  // region either IS the base - and then nothing differs from it - or is not,
  // and then the base names nothing and the branch below says so. A mutation
  // aimed at such a guard stays green, which is the shape TODO §44 is about.
  const baseComposition = known.find((c) => c.region === base);
  // Every other region differs from the base, or there is no base to name. Both
  // are worth separate sentences: the second cannot offer a command, and
  // pretending it can would send a person to a promote that names nothing.
  if (!baseComposition) {
    const drift = regionDrift(compositions);
    if (!drift) return null;
    return (
      `${channel} is split across regions and ${base} has no pointer to put them back to.\n` +
      `  ${drift}\n` +
      `  Nothing here can name the recovery, because the region the suite reads names nothing.`
    );
  }

  const split = known
    .filter((c) => c.region !== base)
    .map((c) => ({ region: c.region, differing: unitsThatDiffer(baseComposition.ids, c.ids), ids: c.ids }))
    .filter((c) => c.differing.length > 0);
  if (split.length === 0) return null;

  // The shell first and the apps in name order, which is how `promote` prints a
  // composition and how every other command in the documents is written. The
  // flags are order-free to the promoter; a person reading two of them side by
  // side is not.
  const flags = Object.entries(baseComposition.ids)
    .sort(([a], [b]) => (a === "shell" ? -1 : b === "shell" ? 1 : a < b ? -1 : a > b ? 1 : 0))
    .map(([unit, id]) => (unit === "shell" ? `--shell ${id}` : `--app ${unit}=${id}`))
    .join(" ");

  const lines = split.map(
    (c) =>
      `  ${c.region} serves ` +
      c.differing.map((u) => `${u} ${c.ids[u] ?? "none"}`).join(", ") +
      ` where ${base} serves ` +
      c.differing.map((u) => `${u} ${baseComposition.ids[u] ?? "none"}`).join(", "),
  );

  const commands = split.map(
    (c) => `  bun run promote ${channel} --region ${c.region} ${flags}`,
  );

  return (
    `${channel} is split across regions, and every promote to it is refused until it is not.\n` +
    `${lines.join("\n")}\n` +
    `  Nothing in this run caused it. A run that was killed before its After hook ran ` +
    `leaves a region where a scenario moved it.\n` +
    `  Put it back, naming what ${base} already serves:\n` +
    `${commands.join("\n")}`
  );
}

/** One pointer and one history, per region per channel. */
export type ManifestKeys = {
  region: Region;
  channel: string;
  pointer: string;
  history: string;
};

/**
 * Every manifest key a reader has to look at to see the whole deploy.
 *
 * The sweep is why this exists. A sweep that read one region would see the
 * other region's pointers and histories as naming nothing at all, and would
 * delete the units a machine there is serving - a reading that is wrong in the
 * one direction that cannot be undone.
 */
export function manifestKeys(channels: readonly string[]): ManifestKeys[] {
  return REGIONS.flatMap((region) =>
    channels.map((channel) => ({
      region,
      channel,
      pointer: `manifests/${region}/${channel}.json`,
      history: `manifests/${region}/${channel}.history.json`,
    })),
  );
}

/** Unit names the two compositions disagree about, including one-sided ones. */
export function unitsThatDiffer(
  a: Record<string, string>,
  b: Record<string, string>,
): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((u) => a[u] !== b[u]).sort();
}
