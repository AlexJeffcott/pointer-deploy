// Which compositions this origin has handed out, §12.
//
// The free half of the reading, and the only half that is free. Every shell
// response already names the units it was assembled from, and the shell is
// `no-store`, so every navigation reaches this origin - the composition is
// decided here on every request and counting it costs one map write.
//
// The other half is what a sunset actually needs and this cannot see: a tab
// opened before a promote keeps its composition and never asks again, so the
// population still RUNNING an old unit is not in these counts. Only the page
// could report that, and a beacon needs a route that accepts a write plus a
// bucket write key on the production origin - the same key §4 refuses to give
// CI. So this counts what is handed out and says so inside its own answer,
// which is the difference between a partial reading and a wrong one.

/** One composition, and how often this process has handed it out. */
export type ServedComposition = {
  channel: string;
  region: string;
  /** What the page identifies itself as: the shell's unit id at schema 3. */
  buildId: string;
  /**
   * Unit name to unit id, exactly what the page was assembled from.
   *
   * Empty below schema 3, which has no composition to name: one bundle is the
   * whole page, and `buildId` is everything there is to say about it.
   */
  units: Record<string, string>;
  /** Null below schema 3, which carries no contract. */
  contract: string | null;
  /** Responses that handed this composition out. */
  responses: number;
  /**
   * How many of those came from a query override rather than the pointer.
   *
   * A sunset reads `responses`, and one operator working through the version
   * switcher would otherwise look exactly like visitors still being served an
   * old unit. That is the reading it would be wrong on, so the two are counted
   * apart rather than summed.
   */
  overrides: number;
  firstAt: string;
  lastAt: string;
};

/** One response, as the server already knows it by the time it answers. */
export type ServedEntry = {
  channel: string;
  region: string;
  buildId: string;
  units: Record<string, string>;
  contract: string | null;
  /** True when the query string named a unit other than the pointer's. */
  overridden: boolean;
};

export type ServedReading = {
  schema: 1;
  /** When this process started counting. Its own zero. */
  since: string;
  readAt: string;
  /** Every response counted, the evicted rows included. */
  responses: number;
  /** Most recently served first, which is eviction order reversed. */
  compositions: ServedComposition[];
  /** Rows dropped to stay inside `capacity`. Non-zero means this is partial. */
  evicted: number;
  capacity: number;
  answers: string;
  /** What this reading does not answer, carried with it rather than beside it. */
  blindTo: string[];
};

const ANSWERS = "the shells this process has handed out since `since`";

// Prose, and load-bearing: a count of served compositions read as a count of
// RUNNING ones is how a unit gets removed out from under the tabs still using
// it. Whoever curls this route gets the limits in the same document.
const BLIND_TO = [
  "a tab opened before a promote: it keeps its composition and never asks again, so what is still running is not counted here",
  "every other machine, and this one before it was last replaced: the count is in memory and starts again at zero",
  "compositions dropped once `capacity` was reached, counted in `evicted` and no longer named",
];

export type ServedOptions = {
  /** How many distinct compositions are named at once. */
  capacity?: number;
  now?: () => number;
};

export type ServedLog = {
  record(entry: ServedEntry): void;
  read(): ServedReading;
};

/**
 * How many distinct compositions are held.
 *
 * A bound is needed rather than tidy. The switcher refuses an id the channel
 * has not served, so the reachable set is bounded by the history depth per
 * unit - but that is 20 to the power of the unit count, which anyone holding a
 * link can walk. The cap is what stops a crafted query string growing this
 * map for the life of the machine.
 */
export const SERVED_CAPACITY = 200;

export function createServedLog(options: ServedOptions = {}): ServedLog {
  const capacity = options.capacity ?? SERVED_CAPACITY;
  const now = options.now ?? Date.now;
  const at = () => new Date(now()).toISOString();
  const since = at();

  // Insertion-ordered, and re-inserted on every hit, so the first key is always
  // the least recently served one. That is what makes the cap safe to have: the
  // composition a promote just started handing out is the newest row in the
  // map, so it can never be the one dropped - which would be the exact reading
  // an operator came for.
  const rows = new Map<string, ServedComposition>();
  let responses = 0;
  let evicted = 0;

  return {
    record(entry) {
      responses++;
      const key = keyOf(entry);
      const row = rows.get(key);
      if (row) {
        rows.delete(key);
        row.responses++;
        if (entry.overridden) row.overrides++;
        row.lastAt = at();
        rows.set(key, row);
        return;
      }

      const stamp = at();
      rows.set(key, {
        channel: entry.channel,
        region: entry.region,
        buildId: entry.buildId,
        units: { ...entry.units },
        contract: entry.contract,
        responses: 1,
        overrides: entry.overridden ? 1 : 0,
        firstAt: stamp,
        lastAt: stamp,
      });

      while (rows.size > capacity) {
        // Stryker disable next-line StringLiteral: unreachable. The map is over
        // capacity, so it holds at least one key and the iterator cannot be
        // done. The `??` is here for the type and for nothing else.
        rows.delete(rows.keys().next().value ?? "");
        evicted++;
      }
    },

    read() {
      return {
        schema: 1,
        since,
        readAt: at(),
        responses,
        // Copied, not handed out. `record` mutates these rows in place, so a
        // caller holding a reading would otherwise watch it change under them.
        compositions: [...rows.values()].reverse().map((r) => ({ ...r, units: { ...r.units } })),
        evicted,
        capacity,
        answers: ANSWERS,
        blindTo: BLIND_TO,
      };
    },
  };
}

/**
 * One string per distinct composition.
 *
 * JSON rather than a joined string: a unit name carrying the separator would
 * collide with a different composition, and what the manifest may call an app
 * is not this module's to constrain. Sorted by name, because `Object.entries`
 * follows insertion order and two manifests naming the same units in a
 * different order are the same composition served twice, not two compositions.
 */
function keyOf(e: ServedEntry): string {
  const units = Object.keys(e.units)
    .sort()
    .map((name) => [name, e.units[name]]);
  return JSON.stringify([e.channel, e.region, e.buildId, e.contract, units]);
}
