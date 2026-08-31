import type { VersionOption } from "@pointer/blocks";
import type { ComposedUnit, ManifestV3 } from "./manifest.ts";

export type { VersionOption } from "@pointer/blocks";

export type UnitSurface = {
  provides?: Record<string, string>;
  uses?: Record<string, string>;
  subapps?: string[];
  api?: string[];
  blocks?: Record<string, string>;
};

export type HistoryEntry = {
  unit: ComposedUnit;
  contracts: string[];
  surface?: UnitSurface;
  supersededAt?: string;
  /**
   * When the unit was published. A catalogue entry carries it; a history entry
   * does not, because a history records promotes and a promote is not a
   * publish.
   */
  publishedAt?: string;
  /** Whether the tree that built it had uncommitted changes. Catalogue only. */
  dirty?: boolean;
  /**
   * When the unit's own `unit.json` was last written, as the store reports it.
   *
   * Not the same as `publishedAt`, which is the FIRST publish of these bytes
   * and never moves. `publish` rewrites a `unit.json` in place when the claims
   * beside a bundle change, and this is what lets a rebuild skip re-reading the
   * ones that did not. Catalogue only.
   */
  recordedAt?: string;
};

export type ChannelHistory = {
  schema: 1;
  updatedAt: string;
  units: Record<string, HistoryEntry[]>;
};

/**
 * Every published unit, in one object.
 *
 * It is a `ChannelHistory` on purpose, and not a shape of its own: a catalogue
 * is a history whose scope is the store rather than one channel. That identity
 * is what lets `refuseComposition`, `compose` and `optionsFor` read it without
 * knowing which of the two they were handed, so the switcher gained every
 * published build without one new rule about how a composition is judged.
 *
 * The catalogue is DERIVED. `publish` rebuilds it from a LIST of `units/`
 * rather than appending to it, so a write lost to a crash or to two publishers
 * at once heals on the next publish. Nothing here may be the only record of
 * anything: every entry restates what one `units/<name>/<id>/unit.json`
 * already says.
 */
export type Catalogue = ChannelHistory;

export function historyUrl(base: string, region: string, channel: string): string {
  return `${base.replace(/\/$/, "")}/${region}/${channel}.history.json`;
}

/** Where the catalogue lives in the bucket. */
export const CATALOGUE_KEY = "units/catalogue.json";

/**
 * The catalogue sits beside `units/`, and the server is told where `manifests/`
 * is. Both are one prefix under the same bucket, so the second is read off the
 * first rather than carried as a second setting that can disagree with it.
 */
export function catalogueUrl(manifestBase: string): string {
  return new URL(`../${CATALOGUE_KEY}`, `${manifestBase.replace(/\/$/, "")}/`).toString();
}

/**
 * What a channel may compose: what it has served, plus every published build.
 *
 * The channel's own entries come FIRST and win on a repeated id, because they
 * carry `supersededAt` and the order the promotes happened in. The catalogue
 * only adds ids this channel has never served - which is the point, because
 * that is how an operator looks at a build before deploying it.
 *
 * A build the harness made is added only on a `test-*` channel. The catalogue
 * lists every published unit, marker and all, because a record that leaves out
 * 112 of 129 units is not the record of what has been published. Which of them
 * a channel may serve is a different question, and it is answered here, where
 * the channel is known - the same rule `promote` applies, applied where a
 * visitor chooses. A marked unit already IN a channel's history stays: that
 * channel really served it.
 */
export function mergeKnown(
  history: ChannelHistory,
  catalogue: Catalogue | null,
  allowMarked = false,
): ChannelHistory {
  if (catalogue === null) return history;
  const names = new Set([...Object.keys(history.units), ...Object.keys(catalogue.units)]);
  const units: Record<string, HistoryEntry[]> = {};
  for (const name of names) {
    // Stryker disable next-line ArrayDeclaration: the empty array cannot be seen.
    const served = history.units[name] ?? [];
    const already = new Set(served.map((e) => e.unit.unitId));
    units[name] = [
      ...served,
      // Stryker disable next-line ArrayDeclaration: the empty array cannot be seen.
      ...(catalogue.units[name] ?? []).filter(
        (e) => !already.has(e.unit.unitId) && (allowMarked || (e.unit.marker ?? "") === ""),
      ),
    ];
  }
  return { schema: 1, updatedAt: history.updatedAt, units };
}

export const HISTORY_DEPTH = 20;

export function sharedContracts(byUnit: Record<string, string[]>): string[] {
  let shared = [...(byUnit.shell ?? [])];
  for (const set of Object.values(byUnit)) {
    const held = new Set(set);
    shared = shared.filter((h) => held.has(h));
  }
  return shared;
}

export function chooseContract(byUnit: Record<string, string[]>): string | null {
  const shared = sharedContracts(byUnit);
  return shared.length ? shared[shared.length - 1]! : null;
}

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
    if (name === "shell") continue;
    if (!surface?.uses || !surface.subapps) continue;
    decided = true;

    for (const [path, digest] of Object.entries(surface.uses)) {
      const held = provides[path];
      if (held === undefined) problems.push(`${name} uses ${path}, which this shell does not have`);
      else if (held !== digest) problems.push(`${name} uses ${path}, which this shell declares differently`);
    }
    if (!surface.subapps.some((h) => shellHalves.includes(h))) {
      problems.push(`${name} was built against a different SubApp type`);
    }
  }
  if (!decided) return undefined;
  return problems.length ? problems.join("; ") : null;
}

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

export function apiRefusal(
  serves: string[] | undefined,
  shell: UnitSurface | undefined,
): string | null | undefined {
  const needs = shell?.api;
  if (!needs || !serves) return undefined;
  const missing = needs.filter((v) => !serves.includes(v));
  if (missing.length === 0) return null;
  return `that shell calls API ${missing.join(", ")}, which the service does not answer`;
}

export function decidesMembers(shell?: UnitSurface, app?: UnitSurface): boolean {
  return Boolean(shell?.provides && shell.subapps && app?.uses && app.subapps);
}

export function compositionRefusal(
  contractsByUnit: Record<string, string[]>,
  surfaces: Record<string, UnitSurface | undefined>,
): string | null {
  const shell = surfaces.shell;
  const byMembers: Record<string, UnitSurface | undefined> = { shell };
  // Stryker disable next-line ArrayDeclaration: unreachable.
  const byContract: Record<string, string[]> = { shell: contractsByUnit.shell ?? [] };

  for (const name of Object.keys(contractsByUnit)) {
    // Stryker disable next-line ConditionalExpression,StringLiteral: unreachable.
    if (name === "shell") continue;
    if (decidesMembers(shell, surfaces[name])) byMembers[name] = surfaces[name];
    else {
      // Stryker disable next-line ArrayDeclaration: unreachable.
      byContract[name] = contractsByUnit[name] ?? [];
    }
  }

  const members = memberRefusal(byMembers);
  if (typeof members === "string") return members;

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
        ...(e.surface && typeof e.surface === "object" ? { surface: e.surface as UnitSurface } : {}),
        ...(typeof e.supersededAt === "string" ? { supersededAt: e.supersededAt } : {}),
        ...(typeof e.publishedAt === "string" ? { publishedAt: e.publishedAt } : {}),
        ...(typeof e.dirty === "boolean" ? { dirty: e.dirty } : {}),
        ...(typeof e.recordedAt === "string" ? { recordedAt: e.recordedAt } : {}),
      };
    });
  }

  return { schema: 1, updatedAt: str("updatedAt", h.updatedAt), units };
}

function contractsOf(history: ChannelHistory, unit: string, id: string): string[] {
  // Stryker disable next-line ArrayDeclaration: the empty array cannot be seen.
  return history.units[unit]?.find((e) => e.unit.unitId === id)?.contracts ?? [];
}

function contractsChosen(
  history: ChannelHistory,
  chosen: Record<string, string>,
): Record<string, string[]> {
  return Object.fromEntries(
    Object.entries(chosen).map(([unit, id]) => [unit, contractsOf(history, unit, id)]),
  );
}

export function surfaceOf(history: ChannelHistory, unit: string, id: string): UnitSurface | undefined {
  return history.units[unit]?.find((e) => e.unit.unitId === id)?.surface;
}

function surfacesChosen(
  history: ChannelHistory,
  chosen: Record<string, string>,
): Record<string, UnitSurface | undefined> {
  return Object.fromEntries(
    Object.entries(chosen).map(([unit, id]) => [unit, surfaceOf(history, unit, id)]),
  );
}

export function currentIds(m: ManifestV3): Record<string, string> {
  return {
    shell: m.shell.unitId,
    ...Object.fromEntries(Object.entries(m.apps).map(([n, a]) => [n, a.unitId])),
  };
}

export function optionsFor(
  history: ChannelHistory,
  chosen: Record<string, string>,
  live: Record<string, string>,
  provided: Record<string, string> = {},
  serves?: string[],
): Record<string, VersionOption[]> {
  const chosenContracts = contractsChosen(history, chosen);
  const chosenSurfaces = surfacesChosen(history, chosen);

  return Object.fromEntries(
    Object.entries(history.units).map(([unit, entries]) => [
      unit,
      entries.map((e, i) => {
        const blocks = unit === "shell" ? blockRefusal(provided, e.surface) : null;
        const api = unit === "shell" ? apiRefusal(serves, e.surface) : null;
        // The entry below this one stopped being served at the promote that put
        // this one at the head, so its stamp IS this one's start. Nothing else
        // records that moment - a publish is not a promote, and the manifest
        // holds only what is served now.
        const since = entries[i + 1]?.supersededAt;
        return {
          unitId: e.unit.unitId,
          marker: e.unit.marker ?? "",
          current: chosen[unit] === e.unit.unitId,
          live: live[unit] === e.unit.unitId,
          deployed: live[unit] === e.unit.unitId,
          ...(since ? { since } : {}),
          disabled:
            typeof blocks === "string" ||
            typeof api === "string" ||
            compositionRefusal(
              { ...chosenContracts, [unit]: e.contracts },
              { ...chosenSurfaces, [unit]: e.surface },
            ) !== null,
        };
      }),
    ]),
  );
}

export function refuseComposition(
  history: ChannelHistory,
  chosen: Record<string, string>,
  provided: Record<string, string> = {},
  serves?: string[],
): string | null {
  // Served by this channel, or published and allowed here - `mergeKnown` has
  // already settled which. The message says what the rule is rather than which
  // half of it the id failed, because a harness build IS in the catalogue and
  // still cannot be served on a real channel.
  for (const [unit, id] of Object.entries(chosen)) {
    const known = history.units[unit]?.some((e) => e.unit.unitId === id);
    if (!known) return `the ${unit} unit ${id} is not one this channel can serve`;
  }
  const surfaces = surfacesChosen(history, chosen);
  const blocks = blockRefusal(provided, surfaces.shell);
  if (typeof blocks === "string") return blocks;
  const api = apiRefusal(serves, surfaces.shell);
  if (typeof api === "string") return api;
  return compositionRefusal(contractsChosen(history, chosen), surfaces);
}

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
