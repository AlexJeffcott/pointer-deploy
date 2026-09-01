import { computed, signal } from "@preact/signals";

export type Theme = { colour: string; dark: boolean };

export type User = { name: string; colour: string; initials: string; theme: Theme };

/**
 * What a panel is allowed to do to a counter, as the service advises it.
 *
 * Advice and not a rule: the service accepts a write outside these, because a
 * panel published before a limit existed would otherwise start being refused
 * for something it has always been allowed to do. What a limit decides is how
 * the page DRAWS - which buttons there are, and which are disabled.
 */
export type Limits = { step: number; max: number; allowNegative: boolean };

/** How one namespace is drawn. The service holds none for a namespace it has never seen. */
export type Label = { title: string; emoji: string };
export type Labels = Record<string, Label>;

/** Which optional parts of a panel are drawn at all. */
export type Flags = { showShares: boolean; showTotals: boolean; compact: boolean };

/** Counted by the service, from the counters the service holds. */
export type Stats = { total: number; busiest: string | null; updatedAt: string };

/** A message for the frame. Null is a value: it means there is no message. */
export type Motd = { text: string; level: "info" | "warn"; until: string } | null;

/** Everything the service holds that is not the user and not the counters. */
export type Settings = {
  limits: Limits;
  labels: Labels;
  flags: Flags;
  stats: Stats;
  motd: Motd;
};

export type Counts = ReadonlyArray<readonly [string, number]>;

/** One route the service publishes, as it publishes it. */
export type ServiceRoute = { method: string; path: string };

/**
 * A service field that is going away, §26.
 *
 * Read from the service at runtime and never declared here. Two dates, because
 * "deprecated" and "gone" are different days and the gap between them is the
 * notice an operator has.
 */
export type FieldSunset = {
  since: string;
  sunset: string;
  reason: string;
  /** The field to move to, or null when the service names none. */
  instead: string | null;
};

export type ServiceField = { path: string; type: string; going: FieldSunset | null };

/**
 * What the page knows about the service it was told to call, §26.
 *
 * A sub-app reads this and never fetches: the shell owns the one read, the
 * same way it owns the counters. `state` is the reading a panel acts on, and
 * "unread" is a real value rather than a missing one - a page whose service is
 * slow has not failed, and must not be drawn as though it had.
 */
export type ServiceReport = {
  /** Where the service is, or "" when the server named none. */
  base: string;
  state: "unread" | "ok" | "failed";
  /** Versions the service says it answers. */
  serves: readonly string[];
  /** The version this shell calls. One string, because this shell calls one. */
  calling: string;
  routes: readonly ServiceRoute[];
  fields: readonly ServiceField[];
  /**
   * The `Sunset` header a data response carried, RFC 8594.
   *
   * Kept apart from the fields on purpose. The document is what the service
   * says about itself; this is what one response said, and a proxy or a
   * different deploy can make them disagree.
   */
  headerSunset: string | null;
  error: string | null;
  /** When the document was read, ISO. Null while it has never been read. */
  readAt: string | null;
};

export type ShellStore = {
  user(): User;
  setUser(next: User): void;
  setName(name: string): void;
  setColour(colour: string): void;
  register(ns: string): void;
  increment(ns: string, by?: number): void;
  countOf(ns: string): number;
  reset(ns: string): void;
  snapshot(): Counts;
  limits(): Limits;
  /** The service's label for a namespace, or one made from the namespace itself. */
  labelFor(ns: string): Label;
  flags(): Flags;
  stats(): Stats;
  motd(): Motd;
  setSettings(next: Partial<Settings>): void;
  service(): ServiceReport;
  setService(report: ServiceReport): void;
  /** The sunset on one field path, or null when the service does not mark it. */
  goingAway(path: string): FieldSunset | null;
};

/**
 * What the page draws before the service has answered, and keeps if it never
 * does. Every one of these is a value a panel can render, so a slow service
 * costs a DIFFERENT page and never a blank one.
 */
export const DEFAULTS: Settings = {
  limits: { step: 5, max: 100, allowNegative: true },
  labels: {},
  flags: { showShares: true, showTotals: true, compact: false },
  stats: { total: 0, busiest: null, updatedAt: "" },
  motd: null,
};

export const NO_SERVICE: ServiceReport = {
  base: "",
  state: "unread",
  serves: [],
  calling: "",
  routes: [],
  fields: [],
  headerSunset: null,
  error: null,
  readAt: null,
};

export function createStore(initial?: Partial<User>): ShellStore {
  const user = signal<User>({
    name: initial?.name ?? "Alex",
    colour: initial?.colour ?? "#1f5fd0",
    initials: initial?.initials ?? "AJ",
    theme: initial?.theme ?? { colour: "#1f5fd0", dark: false },
  });

  const counters = signal<Record<string, number>>({});
  const settings = signal<Settings>(DEFAULTS);
  const service = signal<ServiceReport>(NO_SERVICE);

  const snapshot = computed<Counts>(() =>
    Object.entries(counters.value).sort(([a], [b]) => a.localeCompare(b)),
  );

  return {
    user: () => user.value,
    setUser: (next) => {
      user.value = next;
    },
    setName: (name) => {
      user.value = { ...user.value, name };
    },
    setColour: (colour) => {
      user.value = { ...user.value, colour };
    },
    register: (ns) => {
      if (ns in counters.value) return;
      counters.value = { ...counters.value, [ns]: 0 };
    },
    increment: (ns, by = 1) => {
      counters.value = { ...counters.value, [ns]: (counters.value[ns] ?? 0) + by };
    },
    countOf: (ns) => counters.value[ns] ?? 0,
    reset: (ns) => {
      counters.value = { ...counters.value, [ns]: 0 };
    },
    snapshot: () => snapshot.value,
    limits: () => settings.value.limits,
    labelFor: (ns) => settings.value.labels[ns] ?? { title: ns, emoji: "" },
    flags: () => settings.value.flags,
    stats: () => settings.value.stats,
    motd: () => settings.value.motd,
    setSettings: (next) => {
      settings.value = { ...settings.value, ...next };
    },
    service: () => service.value,
    setService: (report) => {
      service.value = report;
    },
    goingAway: (path) => service.value.fields.find((f) => f.path === path)?.going ?? null,
  };
}
