export type ServedComposition = {
  channel: string;
  region: string;
  buildId: string;
  units: Record<string, string>;
  contract: string | null;
  responses: number;
  overrides: number;
  firstAt: string;
  lastAt: string;
};

export type ServedEntry = {
  channel: string;
  region: string;
  buildId: string;
  units: Record<string, string>;
  contract: string | null;
  overridden: boolean;
};

export type ServedReading = {
  schema: 1;
  since: string;
  readAt: string;
  responses: number;
  compositions: ServedComposition[];
  evicted: number;
  capacity: number;
  answers: string;
  blindTo: string[];
};

const ANSWERS = "the shells this process has handed out since `since`";

const BLIND_TO = [
  "a tab opened before a promote: it keeps its composition and never asks again, so what is still running is not counted here",
  "every other machine, and this one before it was last replaced: the count is in memory and starts again at zero",
  "compositions dropped once `capacity` was reached, counted in `evicted` and no longer named",
];

export type ServedOptions = {
  capacity?: number;
  now?: () => number;
};

export type ServedLog = {
  record(entry: ServedEntry): void;
  read(): ServedReading;
};

export const SERVED_CAPACITY = 200;

export function createServedLog(options: ServedOptions = {}): ServedLog {
  const capacity = options.capacity ?? SERVED_CAPACITY;
  const now = options.now ?? Date.now;
  const at = () => new Date(now()).toISOString();
  const since = at();

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
        // Stryker disable next-line StringLiteral: unreachable.
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
        compositions: [...rows.values()].reverse().map((r) => ({ ...r, units: { ...r.units } })),
        evicted,
        capacity,
        answers: ANSWERS,
        blindTo: BLIND_TO,
      };
    },
  };
}

function keyOf(e: ServedEntry): string {
  const units = Object.keys(e.units)
    .sort()
    .map((name) => [name, e.units[name]]);
  return JSON.stringify([e.channel, e.region, e.buildId, e.contract, units]);
}
