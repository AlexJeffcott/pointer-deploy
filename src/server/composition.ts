// What a channel has served, and which of those units can be composed together.
//
// The direction of the import matters and is forced by the image: the runtime
// stage of the Dockerfile copies `src/server` and nothing else, so the server
// cannot reach `scripts/`. Anything the server and a script both need lives
// here, and `scripts/promote.ts` imports it from here. Never the reverse.
//
// The rule itself is the one `promote` has always applied: a composition works
// when at least one contract is in EVERY unit's set. `tsc` at HEAD proves the
// HEAD combination, and choosing an older unit is precisely how a combination
// nothing has ever typechecked comes to be served.

import type { ComposedUnit, ManifestV3 } from "./manifest.ts";

/**
 * One id a channel has served, with everything needed to serve it again.
 *
 * The whole unit travels, not just its id. The alternative is a fetch of
 * `units/<unit>/<id>/unit.json` per option, which would need a second cache and
 * a second failure mode for a document that changes only when someone promotes.
 * `contracts` travels for the same reason: without it the server cannot say
 * which options are impossible, and the switcher would offer a composition that
 * `promote` would have refused.
 */
export type HistoryEntry = {
  unit: ComposedUnit;
  contracts: string[];
};

/**
 * Every unit a channel has served, newest first.
 *
 * Written by `promote`, which is the pointer's only writer, so this has one
 * writer too and cannot race a `publish`. The id a channel serves NOW is always
 * the head of its list, which is what makes the depth cap safe: pruning takes
 * from the tail and can never take what is being served.
 */
export type ChannelHistory = {
  schema: 1;
  updatedAt: string;
  units: Record<string, HistoryEntry[]>;
};

/** Beside the pointer, and named after it, so one region holds both. */
export function historyUrl(base: string, region: string, channel: string): string {
  return `${base.replace(/\/$/, "")}/${region}/${channel}.history.json`;
}

/** How many ids a channel keeps per unit. The head is never pruned. */
export const HISTORY_DEPTH = 20;

/**
 * The contracts every unit in a composition supports, in the shell's order.
 *
 * Empty means the composition cannot be served: nothing has ever typechecked
 * it. The shell's list seeds the result because the shell is the party the
 * contract is written from; the answer is the same whichever order the units
 * are visited, and this one is stable to report.
 */
export function sharedContracts(byUnit: Record<string, string[]>): string[] {
  // A composition naming no shell shares nothing. The seed is filtered by every
  // set below, so an absent shell would otherwise leave whatever seeded it.
  let shared = [...(byUnit.shell ?? [])];
  for (const set of Object.values(byUnit)) {
    const held = new Set(set);
    shared = shared.filter((h) => held.has(h));
  }
  return shared;
}

/**
 * The contract a composition resolves at, or null if there is none.
 *
 * The LAST shared hash, matching what `promote` writes into a composition: the
 * registry keeps contracts oldest first, so the last one they all support is
 * the newest they all support.
 */
export function chooseContract(byUnit: Record<string, string[]>): string | null {
  const shared = sharedContracts(byUnit);
  return shared.length ? shared[shared.length - 1]! : null;
}

const str = (name: string, value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`history field ${name} is missing or not a string`);
  }
  return value;
};

/**
 * Throws if the document is not a history this server understands.
 *
 * Deliberately does NOT validate the composed units it carries. They are
 * checked when one is chosen, by the same parser the manifest goes through, so
 * a single malformed entry costs that one option rather than the whole
 * switcher.
 */
export function parseHistory(input: unknown): ChannelHistory {
  const h = input as Record<string, unknown> | null;
  if (!h || typeof h !== "object") throw new Error("history is not an object");
  if (h.schema !== 1) throw new Error(`unsupported history schema ${String(h.schema)}`);

  const rawUnits = h.units;
  if (!rawUnits || typeof rawUnits !== "object") {
    throw new Error("history field units is missing or not an object");
  }

  const units: Record<string, HistoryEntry[]> = {};
  for (const [name, value] of Object.entries(rawUnits as Record<string, unknown>)) {
    if (!Array.isArray(value)) throw new Error(`history field units.${name} is not an array`);
    units[name] = value.map((entry, i) => {
      const e = entry as Record<string, unknown> | null;
      if (!e || typeof e !== "object") {
        throw new Error(`history field units.${name}[${i}] is not an object`);
      }
      const unit = e.unit as Record<string, unknown> | null;
      if (!unit || typeof unit !== "object") {
        throw new Error(`history field units.${name}[${i}].unit is not an object`);
      }
      str(`units.${name}[${i}].unit.unitId`, unit.unitId);
      if (!Array.isArray(e.contracts)) {
        throw new Error(`history field units.${name}[${i}].contracts is not an array`);
      }
      return { unit: unit as unknown as ComposedUnit, contracts: e.contracts as string[] };
    });
  }

  return { schema: 1, updatedAt: str("updatedAt", h.updatedAt), units };
}

/**
 * What one id in one unit compiles against, or nothing.
 *
 * The one lookup the three readers below share. An id this channel has not
 * served supports no contract, so it can be composed with nothing - which is
 * the answer `refuseComposition` and `optionsFor` both want.
 */
function contractsOf(history: ChannelHistory, unit: string, id: string): string[] {
  // Stryker disable next-line ArrayDeclaration: the empty array cannot be seen.
  // Whatever seeds this is filtered by every other unit's set in
  // sharedContracts, so a value no real unit lists cannot survive - and a value
  // that is not a contract hash is never listed. The `?? []` is here so the
  // caller's Object.fromEntries holds arrays and not undefined.
  return history.units[unit]?.find((e) => e.unit.unitId === id)?.contracts ?? [];
}

/** What every chosen id compiles against, by unit. */
function contractsChosen(
  history: ChannelHistory,
  chosen: Record<string, string>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(chosen).map(([unit, id]) => [unit, contractsOf(history, unit, id)]),
  );
}

/** The unit ids a manifest currently names, by unit. */
export function currentIds(m: ManifestV3): Record<string, string> {
  return {
    shell: m.shell.unitId,
    ...Object.fromEntries(Object.entries(m.apps).map(([n, a]) => [n, a.unitId])),
  };
}

/** One choice a visitor can make, and whether it can be made. */
export type VersionOption = {
  unitId: string;
  marker: string;
  current: boolean;
  /**
   * True when this is what the channel's own pointer names.
   *
   * Distinct from `current`, which is what the visitor is looking at. The shell
   * needs both: choosing the deployed id must CLEAR the override rather than
   * pin it, or a link shared from this page would freeze at today's build and
   * stop following the channel.
   */
  deployed: boolean;
  /**
   * True when choosing it would make a composition no contract covers.
   *
   * Disabled rather than absent, because "this build exists and cannot be run
   * beside the others" is the reading an operator wants. Hiding it would say
   * the build was never deployed.
   */
  disabled: boolean;
};

/**
 * Every unit's options, given what is chosen for the other units.
 *
 * A unit with one entry still gets its list. An empty list means the channel
 * was last promoted before it kept a history, and the shell renders no control.
 */
export function optionsFor(
  history: ChannelHistory,
  chosen: Record<string, string>,
  deployed: Record<string, string>,
): Record<string, VersionOption[]> {
  const chosenContracts = contractsChosen(history, chosen);

  return Object.fromEntries(
    Object.entries(history.units).map(([unit, entries]) => [
      unit,
      entries.map((e) => ({
        unitId: e.unit.unitId,
        marker: e.unit.marker ?? "",
        current: chosen[unit] === e.unit.unitId,
        deployed: deployed[unit] === e.unit.unitId,
        disabled:
          chooseContract({ ...chosenContracts, [unit]: e.contracts }) === null,
      })),
    ]),
  );
}

/** Why this composition cannot be served, or null if it can. */
export function refuseComposition(
  history: ChannelHistory,
  chosen: Record<string, string>,
): string | null {
  for (const [unit, id] of Object.entries(chosen)) {
    const known = history.units[unit]?.some((e) => e.unit.unitId === id);
    // Fails closed, and this is the refusal that matters: without it the query
    // string is a way to make this origin serve any object in the store.
    if (!known) return `the ${unit} unit ${id} is not one this channel has served`;
  }
  if (chooseContract(contractsChosen(history, chosen)) === null) {
    return "no contract is supported by every unit in that composition";
  }
  return null;
}

/**
 * The manifest with the chosen units substituted in.
 *
 * The composition keeps its own shape, so everything derived from a manifest -
 * the policy, the digests, each unit's base - is derived from THIS one with no
 * further code. That is schema 3 paying for itself.
 */
export function compose(
  base: ManifestV3,
  history: ChannelHistory,
  chosen: Record<string, string>,
): ManifestV3 {
  const unitOf = (name: string, id: string): ComposedUnit | null =>
    history.units[name]?.find((e) => e.unit.unitId === id)?.unit ?? null;

  const shellId = chosen.shell;
  const shell = shellId ? unitOf("shell", shellId) : null;

  const apps: Record<string, ComposedUnit> = { ...base.apps };
  for (const [name, id] of Object.entries(chosen)) {
    if (name === "shell") continue;
    const picked = unitOf(name, id);
    if (picked) apps[name] = picked;
  }

  return {
    ...base,
    contract: chooseContract(contractsChosen(history, chosen)) ?? base.contract,
    shell: shell ?? base.shell,
    apps,
  };
}
