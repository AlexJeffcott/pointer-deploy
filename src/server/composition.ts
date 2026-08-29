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

import type { VersionOption } from "@pointer/blocks";
import type { ComposedUnit, ManifestV3 } from "./manifest.ts";

// One declaration, in the file that holds the whole server-to-shell surface.
export type { VersionOption } from "@pointer/blocks";

/**
 * What a unit says about the type surface, beyond which contracts it holds.
 *
 * The contract set answers "were these built against the same surface". That
 * refuses a shell which dropped a member no sub-app in the composition ever
 * called, because a PUBLISHED app's set was fixed at its build time and cannot
 * name a contract minted after it. These two fields answer the question an
 * operator actually has - does this app need anything this shell does not have
 * - and they are both derived by the compiler at build time, never written.
 *
 * The halves are gated differently because they are not alike:
 *
 *   shell.d.ts   a sub-app consumes PART of it, so the gate is per member
 *   subapp.d.ts  the shell requires ALL of it, so the gate is one identity
 */
export type UnitSurface = {
  /** The shell: every removable member of `shell.d.ts`, path to digest. */
  provides?: Record<string, string>;
  /** A sub-app: the members whose removal stops it compiling, path to digest. */
  uses?: Record<string, string>;
  /**
   * The `subapp.d.ts` halves this unit compiles against.
   *
   * A set, like `contracts`, and coarser: contracts that differ only in
   * `shell.d.ts` collapse to one entry here, which is exactly the churn the
   * member gate exists to stop counting.
   */
  subapps?: string[];
  /**
   * The shell: which fields of the server's JSON blocks it reads, §11.
   *
   * Not part of `memberRefusal`. The other side of this one is the running
   * SERVER, which `promote` cannot see - so only a server compares it, in
   * `blockRefusal` below.
   */
  blocks?: Record<string, string>;
};

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
  /** Absent for a unit published before the member gate existed. */
  surface?: UnitSurface;
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

/**
 * Why this shell cannot serve these sub-apps, or null if it can.
 *
 * `undefined` means nothing here can decide: one side of the pair carries no
 * reading, which is every unit published before this existed. The caller falls
 * back to the contract sets for those, and rolling a channel back onto them
 * goes on working.
 *
 * A member is a fit when the shell provides that path with the SAME digest. A
 * digest that moved is a member that was re-declared - a narrowed parameter, a
 * changed return - and it refuses only the apps that named it, which is the
 * whole difference from one hash over the surface.
 */
export function memberRefusal(
  surfaces: Record<string, UnitSurface | undefined>,
): string | null | undefined {
  const provides = surfaces.shell?.provides;
  const shellHalves = surfaces.shell?.subapps;
  if (!provides || !shellHalves) return undefined;

  const problems: string[] = [];
  let decided = false;
  for (const [name, surface] of Object.entries(surfaces)) {
    // Stryker disable next-line ConditionalExpression,StringLiteral: unreachable.
    // The shell's own surface carries `provides`, never `uses`, so the next
    // line skips it whether this one does or not. Kept because it names the
    // party being judged, and a shell that ever recorded `uses` would be
    // judged against itself without it.
    if (name === "shell") continue;
    if (!surface?.uses || !surface.subapps) continue;
    decided = true;

    for (const [path, digest] of Object.entries(surface.uses)) {
      const held = provides[path];
      if (held === undefined) problems.push(`${name} uses ${path}, which this shell does not have`);
      else if (held !== digest) problems.push(`${name} uses ${path}, which this shell declares differently`);
    }
    // The other half, and it is all-or-nothing: the shell renders the component
    // a sub-app exports, so it requires the whole of `subapp.d.ts` rather than
    // some members of it.
    if (!surface.subapps.some((h) => shellHalves.includes(h))) {
      problems.push(`${name} was built against a different SubApp type`);
    }
  }
  if (!decided) return undefined;
  return problems.length ? problems.join("; ") : null;
}

/**
 * Why this SERVER cannot feed that shell, or null if it can. §11.
 *
 * The shell reads fields out of three JSON blocks this server writes, and the
 * two are separate deploys: the shell is a published unit a visitor can roll
 * back to, and the server is an image. So the comparison belongs here, at serve
 * time, and nowhere else - `promote` runs in a working tree and cannot see
 * which image is answering requests.
 *
 * `undefined` when the shell records nothing, which is every shell published
 * before §11. That is the case the append-only rule exists for, and it is why
 * `VersionOption.deployed` is still written: shell `606c1c3c` reads it and
 * cannot say so.
 */
export function blockRefusal(
  provided: Record<string, string>,
  shell: UnitSurface | undefined,
): string | null | undefined {
  const reads = shell?.blocks;
  if (!reads) return undefined;
  const problems: string[] = [];
  for (const [path, digest] of Object.entries(reads)) {
    const held = provided[path];
    if (held === undefined) problems.push(`that shell reads ${path}, which this server does not write`);
    else if (held !== digest) problems.push(`that shell reads ${path}, which this server writes differently`);
  }
  return problems.length ? problems.join("; ") : null;
}

/** Whether the pair carries enough for the member gate to answer at all. */
export function decidesMembers(shell?: UnitSurface, app?: UnitSurface): boolean {
  return Boolean(shell?.provides && shell.subapps && app?.uses && app.subapps);
}

/**
 * Why this composition cannot be served, or null if it can. The one rule.
 *
 * Each sub-app is judged by whichever gate can answer for it. A pair that both
 * carry readings is judged on members, and the contract sets are not consulted
 * for it - that is the point, because a published app's set cannot name a
 * contract minted after it was built. A pair where either side predates the
 * readings falls back to the contract intersection, which is what keeps a
 * rollback onto an old unit working.
 */
export function compositionRefusal(
  contractsByUnit: Record<string, string[]>,
  surfaces: Record<string, UnitSurface | undefined>,
): string | null {
  const shell = surfaces.shell;
  const byMembers: Record<string, UnitSurface | undefined> = { shell };
  // Stryker disable next-line ArrayDeclaration: unreachable. This list is only
  // ever intersected with the other units' lists, so a value invented here
  // shares with nothing and the outcome is the same as the empty set's.
  const byContract: Record<string, string[]> = { shell: contractsByUnit.shell ?? [] };

  for (const name of Object.keys(contractsByUnit)) {
    // Stryker disable next-line ConditionalExpression,StringLiteral: unreachable.
    // The shell is already in byContract with this same value, so falling into
    // the branch below would write it again unchanged.
    if (name === "shell") continue;
    if (decidesMembers(shell, surfaces[name])) byMembers[name] = surfaces[name];
    else {
      // Stryker disable next-line ArrayDeclaration: unreachable. `name` came
      // from Object.keys of this record, so the lookup cannot miss. The `??` is
      // here for the index signature and for nothing else.
      byContract[name] = contractsByUnit[name] ?? [];
    }
  }

  const members = memberRefusal(byMembers);
  if (typeof members === "string") return members;

  // Only the shell is left when every app was judged on members. sharedContracts
  // then returns the shell's own set, which is empty for a shell that compiles
  // against no retained contract - and that is a state `build` already refuses.
  if (Object.keys(byContract).length > 1 && chooseContract(byContract) === null) {
    return "no contract is supported by every unit in that composition";
  }
  return null;
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
      return {
        unit: unit as unknown as ComposedUnit,
        contracts: e.contracts as string[],
        // Not validated here, for the reason above: a malformed reading costs
        // that one option rather than the whole switcher. An absent one is the
        // ordinary case for a unit published before the gate existed.
        ...(e.surface && typeof e.surface === "object" ? { surface: e.surface as UnitSurface } : {}),
      };
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

/** What one id in one unit recorded about the surface, or nothing. */
export function surfaceOf(history: ChannelHistory, unit: string, id: string): UnitSurface | undefined {
  return history.units[unit]?.find((e) => e.unit.unitId === id)?.surface;
}

/** What every chosen id recorded about the surface, by unit. */
function surfacesChosen(
  history: ChannelHistory,
  chosen: Record<string, string>,
): Record<string, UnitSurface | undefined> {
  return Object.fromEntries(
    Object.entries(chosen).map(([unit, id]) => [unit, surfaceOf(history, unit, id)]),
  );
}

/** The unit ids a manifest currently names, by unit. */
export function currentIds(m: ManifestV3): Record<string, string> {
  return {
    shell: m.shell.unitId,
    ...Object.fromEntries(Object.entries(m.apps).map(([n, a]) => [n, a.unitId])),
  };
}

/**
 * Every unit's options, given what is chosen for the other units.
 *
 * A unit with one entry still gets its list. An empty list means the channel
 * was last promoted before it kept a history, and the shell renders no control.
 */
export function optionsFor(
  history: ChannelHistory,
  chosen: Record<string, string>,
  live: Record<string, string>,
  /** What THIS server writes into its blocks. Absent means the shell half is not judged. */
  provided: Record<string, string> = {},
): Record<string, VersionOption[]> {
  const chosenContracts = contractsChosen(history, chosen);
  const chosenSurfaces = surfacesChosen(history, chosen);

  return Object.fromEntries(
    Object.entries(history.units).map(([unit, entries]) => [
      unit,
      entries.map((e) => {
        // §11, and only for the shell: choosing a shell this server cannot feed
        // renders a page whose controls quietly do the wrong thing.
        const blocks = unit === "shell" ? blockRefusal(provided, e.surface) : null;
        return {
        unitId: e.unit.unitId,
        marker: e.unit.marker ?? "",
        current: chosen[unit] === e.unit.unitId,
        live: live[unit] === e.unit.unitId,
        deployed: live[unit] === e.unit.unitId,
        // The same rule `promote` applies, from the same function. An option the
        // switcher greys out that a promote would allow is the switcher lying.
        disabled:
          typeof blocks === "string" ||
          compositionRefusal(
            { ...chosenContracts, [unit]: e.contracts },
            { ...chosenSurfaces, [unit]: e.surface },
          ) !== null,
        };
      }),
    ]),
  );
}

/** Why this composition cannot be served, or null if it can. */
export function refuseComposition(
  history: ChannelHistory,
  chosen: Record<string, string>,
  /** What THIS server writes into its blocks. Absent means the shell half is not judged. */
  provided: Record<string, string> = {},
): string | null {
  for (const [unit, id] of Object.entries(chosen)) {
    const known = history.units[unit]?.some((e) => e.unit.unitId === id);
    // Fails closed, and this is the refusal that matters: without it the query
    // string is a way to make this origin serve any object in the store.
    if (!known) return `the ${unit} unit ${id} is not one this channel has served`;
  }
  const surfaces = surfacesChosen(history, chosen);
  const blocks = blockRefusal(provided, surfaces.shell);
  if (typeof blocks === "string") return blocks;
  return compositionRefusal(contractsChosen(history, chosen), surfaces);
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
