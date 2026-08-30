// How long a superseded build is kept, §5.
//
// The sweep's rule on its own is "no channel can serve it", and that is a
// reading about the STORE rather than about the browsers. A tab opened before a
// promote keeps its composition and fetches a sub-app's files the moment
// somebody opens that view - minutes or days later, from a page nothing can
// reach to tell it otherwise. Deleting a unit the moment it stops being served
// breaks exactly that tab, and nothing anywhere reports it.
//
// So a floor: 90 days from the LATER of two readings, and both are needed.
//
//   the object's own age      a unit published yesterday and superseded today
//                             is a day old, whatever the histories say
//   when it stopped being     a unit published a year ago and served until
//   served                    yesterday is a day out of use
//
// The second is the one the naive floor gets wrong. An age-since-publish rule
// would delete a year-old unit that was serving traffic yesterday, and the
// state where that happens is not exotic: un-retaining a contract drops every
// history entry that named it, and the units behind them become deletable in
// the same sweep.
//
// This module decides. `sweep-superseded.ts` reads the store, hands the
// readings here, and carries out what comes back.

/** The floor, in days. The item's number, and the reason is a tab, not tidiness. */
export const FLOOR_DAYS = 90;

export type StoredObject = { key: string; lastModified: string };

/** One channel's history, flattened to what a retention decision needs. */
export type HistoryReading = {
  channel: string;
  /** When the history was last written. The last promote on that channel. */
  updatedAt: string;
  /** Unit name to its entries, newest first, exactly as the switcher offers them. */
  units: Record<string, Array<{ unitId: string; contracts: string[]; supersededAt?: string }>>;
};

export type PlanInput = {
  now: number;
  floorDays: number;
  objects: StoredObject[];
  /** "units/<name>/<id>" for every unit a channel pointer names. */
  pointed: Set<string>;
  histories: HistoryReading[];
  /** Contract hashes the registry still retains. */
  retained: Set<string>;
};

export type HeldReason = "served" | "offered" | "young" | "recently served";

export type Held = {
  /** "units/<name>/<id>", or the key itself for the layouts that have no unit. */
  group: string;
  reason: HeldReason;
  /** The reading that held it, where there is a date to give. */
  at?: string;
};

export type HistoryDrop = { channel: string; unit: string; unitId: string };

export type RetentionPlan = {
  /** Keys to delete. Everything else in `objects` is held, and says why. */
  deleteKeys: string[];
  /** One row per group that stays. */
  held: Held[];
  /** Entries to drop, and ONLY for units this plan actually deletes. */
  historyDrops: HistoryDrop[];
  /** The cutoff the plan was made at, for the report. */
  cutoff: string;
};

/**
 * The group a key belongs to.
 *
 * A unit is deleted whole or not at all: its files share a directory and a
 * visitor's tab holds the id, so keeping half of one keeps nothing. Everything
 * outside `units/` - the pre-schema-3 `builds/` layout, the one-off `probe/` -
 * has no unit to belong to and is judged on its own age.
 */
export function groupOf(key: string): string {
  const parts = key.split("/");
  return parts[0] === "units" && parts.length >= 3 ? parts.slice(0, 3).join("/") : key;
}

/**
 * What may be deleted, what stays, and why.
 *
 * Pure, so the policy can be read against a clock the test owns rather than
 * against the store's.
 */
export function retentionPlan(input: PlanInput): RetentionPlan {
  const { now, floorDays, objects, pointed, histories, retained } = input;
  const cutoff = now - floorDays * 24 * 60 * 60 * 1000;

  // The newest object in each group. A unit republished into the same directory
  // is as young as its newest file.
  const newest = new Map<string, number>();
  for (const o of objects) {
    const group = groupOf(o.key);
    const at = Date.parse(o.lastModified);
    // An unparseable date is treated as NOW rather than as zero. The reading is
    // missing, and the safe direction for a missing reading is to keep.
    const ms = Number.isNaN(at) ? now : at;
    newest.set(group, Math.max(newest.get(group) ?? 0, ms));
  }

  // What a channel still offers through the switcher, and when a channel last
  // stopped serving something.
  const offered = new Set<string>();
  const stopped = new Map<string, number>();
  for (const history of histories) {
    const written = Date.parse(history.updatedAt);
    for (const [unit, entries] of Object.entries(history.units)) {
      for (const entry of entries) {
        const group = `units/${unit}/${entry.unitId}`;
        if (entry.contracts.some((c) => retained.has(c))) offered.add(group);
        // An entry with no stamp was written before promote recorded one. The
        // latest moment it could have stopped being served is the last time
        // this history was written, so that is what it counts as - the
        // conservative direction, and it corrects itself at the next promote.
        const at = Date.parse(entry.supersededAt ?? history.updatedAt);
        const ms = Number.isNaN(at) ? (Number.isNaN(written) ? now : written) : at;
        stopped.set(group, Math.max(stopped.get(group) ?? 0, ms));
      }
    }
  }

  const held: Held[] = [];
  const doomed = new Set<string>();
  const iso = (ms: number) => new Date(ms).toISOString();

  for (const group of new Set(objects.map((o) => groupOf(o.key)))) {
    if (pointed.has(group)) {
      held.push({ group, reason: "served" });
      continue;
    }
    if (offered.has(group)) {
      held.push({ group, reason: "offered" });
      continue;
    }
    const written = newest.get(group) ?? now;
    if (written > cutoff) {
      held.push({ group, reason: "young", at: iso(written) });
      continue;
    }
    const last = stopped.get(group);
    if (last !== undefined && last > cutoff) {
      held.push({ group, reason: "recently served", at: iso(last) });
      continue;
    }
    doomed.add(group);
  }

  // A history entry is dropped only for a unit whose files this plan removes.
  // The drop exists so the switcher cannot offer a build whose files are gone;
  // dropping one whose files STAY would retire a build the floor is deliberately
  // keeping, which is the opposite of what the floor is for.
  const historyDrops: HistoryDrop[] = [];
  for (const history of histories) {
    for (const [unit, entries] of Object.entries(history.units)) {
      for (const entry of entries) {
        if (doomed.has(`units/${unit}/${entry.unitId}`)) {
          historyDrops.push({ channel: history.channel, unit, unitId: entry.unitId });
        }
      }
    }
  }

  return {
    deleteKeys: objects.filter((o) => doomed.has(groupOf(o.key))).map((o) => o.key),
    held,
    historyDrops,
    cutoff: iso(cutoff),
  };
}

/** The held rows, counted by reason, for a report a person reads. */
export function heldByReason(held: Held[]): Record<HeldReason, number> {
  const counts: Record<HeldReason, number> = {
    served: 0,
    offered: 0,
    young: 0,
    "recently served": 0,
  };
  for (const h of held) counts[h.reason]++;
  return counts;
}
