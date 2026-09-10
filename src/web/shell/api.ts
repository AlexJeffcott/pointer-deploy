import { signal } from "@preact/signals";

/**
 * The one thing the shell owns and a panel draws.
 *
 * Two fields rather than one, and that is deliberate: a single field cannot be
 * retired in favour of anything, so the service could publish a deprecation
 * nothing could act on. `audience` exists so `text` has somewhere to go.
 */
export type Greeting = { text: string; audience: string };

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
 * same way it owns the greeting. `state` is the reading a panel acts on, and
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
  greeting(): Greeting;
  /** Names the fields to change. The rest stay as they are. */
  setGreeting(patch: Partial<Greeting>): void;
  service(): ServiceReport;
  setService(report: ServiceReport): void;
  /** The sunset on one field path, or null when the service does not mark it. */
  goingAway(path: string): FieldSunset | null;
};

/**
 * What the page draws before the service has answered, and keeps if it never
 * does. Both fields are values a panel can render, so a slow service costs a
 * DIFFERENT page and never a blank one.
 */
export const DEFAULT_GREETING: Greeting = { text: "Hello", audience: "world" };

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

export function createStore(initial?: Partial<Greeting>): ShellStore {
  const greeting = signal<Greeting>({ ...DEFAULT_GREETING, ...initial });
  const service = signal<ServiceReport>(NO_SERVICE);

  return {
    greeting: () => greeting.value,
    setGreeting: (patch) => {
      greeting.value = { ...greeting.value, ...patch };
    },
    service: () => service.value,
    setService: (report) => {
      service.value = report;
    },
    goingAway: (path) => service.value.fields.find((f) => f.path === path)?.going ?? null,
  };
}
