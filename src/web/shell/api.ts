import { signal } from "@preact/signals";

/**
 * One task in the planner.
 *
 * The document shape the whole application is built on, declared here because
 * the shell owns it and every sub-app is handed it. `column` and `due` carry no
 * mover yet - `board` arrives at `PLAN.md` step 4 and `week` at step 5 - and
 * they are declared now because they are what a task IS, not what this step
 * draws. Step 2 writes this record into IndexedDB and step 3 exports it.
 *
 * There is no "done" flag. A task is done when it sits in the `done` column, so
 * the board and the list cannot disagree about what done means.
 */
export type Task = {
  id: string;
  title: string;
  /** A column id. */
  column: string;
  /** YYYY-MM-DD, or null when the task has no date. */
  due: string | null;
  tags: readonly string[];
  createdAt: string;
};

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
 * Where the planner is kept, and whether it has been read yet, `PLAN.md` step 2.
 *
 * Read by `list`, which says on the page which of these it is. "unread" is a
 * real value and not a missing one, for the same reason it is on `ServiceReport`:
 * opening IndexedDB is asynchronous and the first paint is not, so a page that
 * drew "No tasks yet" before the read landed would have told the visitor
 * something false.
 *
 * "unstored" is a browser that refuses IndexedDB - a private window, a blocked
 * origin, a setting. The planner still works and still holds what this page put
 * in it; it is step 1's behaviour, and the page says so rather than failing.
 */
export type PlannerReport = {
  state: "unread" | "stored" | "unstored";
  /** The schema version this shell writes, or null while nothing is stored. */
  schemaVersion: number | null;
  /**
   * Whether a change made here has still to reach the database.
   *
   * Writing is asynchronous and a page can be closed part-way through one.
   * Measured on 2026-09-11: a task added and the page reloaded in the same
   * ten milliseconds was gone, because the transaction was still open when the
   * browser took the page away. Nothing makes that window zero - IndexedDB has
   * no synchronous commit - so the page is given the reading instead, and
   * anything that must know the planner is safe waits for this to be false.
   */
  pending: boolean;
  /** Why the planner is not being stored, or null when it is. */
  error: string | null;
  /** When the planner was read, ISO. Null while it has never been read. */
  readAt: string | null;
};

/**
 * What the page knows about the service it was told to call, §26.
 *
 * A sub-app reads this and never fetches: the shell owns the one read, the same
 * way it owns the tasks. `state` is the reading a panel acts on, and "unread"
 * is a real value rather than a missing one - a page whose service is slow has
 * not failed, and must not be drawn as though it had.
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

/**
 * What the shell provides and a sub-app consumes.
 *
 * Every member here is called by something. `PLAN.md` §15 puts shared state in
 * the shell, so the task store is the shell's and `list` writes through it -
 * which is also why there is no member for reading one task: a panel draws the
 * collection.
 *
 * The list is deliberately narrow. A member no unit calls is surface the member
 * gate cannot refuse anything for, and the greeting this store used to hold was
 * exactly that from `PLAN.md` step 0 onwards.
 */
export type ShellStore = {
  tasks(): readonly Task[];
  /** Adds a task at the end of the list. Blank titles are refused, silently. */
  addTask(title: string): void;
  /** Replaces the tags on one task. The rest keep theirs. */
  setTags(id: string, tags: readonly string[]): void;
  removeTask(id: string): void;
  /**
   * Replaces every task at once.
   *
   * The FRAME calls this and no unit does. It is on this surface for the same
   * reason `setService` is: the shell writes what it learned into the store the
   * panels read, so that what the panel draws and what the planner holds stay
   * one fact.
   *
   * Two callers, one member, `PLAN.md` step 3. Step 2 added it for what came
   * out of IndexedDB; `/backup` now hands it what came out of a file, and step
   * 7 will hand it what came out of a snapshot. Every one of them is a TOTAL
   * overwrite, which is why there is no member for adding some tasks to the
   * ones already held - and why one assignment here is one IndexedDB
   * transaction rather than one per task.
   */
  loadTasks(tasks: readonly Task[]): void;
  planner(): PlannerReport;
  setPlanner(report: PlannerReport): void;
  service(): ServiceReport;
  setService(report: ServiceReport): void;
  /** The sunset on one field path, or null when the service does not mark it. */
  goingAway(path: string): FieldSunset | null;
};

/**
 * Where a task lands when nothing says otherwise.
 *
 * Not exported, so it is not contract surface: no unit needs to name it until
 * `board` can move a task, and a member nothing calls is the surface this step
 * is removing rather than adding to.
 */
const DEFAULT_COLUMN = "todo";

/** A planner nothing has looked at yet. The value every page starts from. */
export const NO_PLANNER: PlannerReport = {
  state: "unread",
  schemaVersion: null,
  pending: false,
  error: null,
  readAt: null,
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

/**
 * A task id, unique within one page.
 *
 * A counter and the clock rather than a random value, because the counter is
 * what makes two tasks added in the same millisecond different and the clock is
 * what stops a reload colliding with what a later step reads back out of
 * IndexedDB.
 */
let minted = 0;
const newId = (): string => `t${(++minted).toString(36)}-${Date.now().toString(36)}`;

export function createStore(initial: readonly Task[] = []): ShellStore {
  const tasks = signal<readonly Task[]>(initial);
  const service = signal<ServiceReport>(NO_SERVICE);
  const planner = signal<PlannerReport>(NO_PLANNER);

  return {
    tasks: () => tasks.value,
    addTask: (title) => {
      const trimmed = title.trim();
      if (trimmed === "") return;
      const task: Task = {
        id: newId(),
        title: trimmed,
        column: DEFAULT_COLUMN,
        due: null,
        tags: [],
        createdAt: new Date().toISOString(),
      };
      tasks.value = [...tasks.value, task];
    },
    setTags: (id, tags) => {
      tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, tags: [...tags] } : t));
    },
    removeTask: (id) => {
      tasks.value = tasks.value.filter((t) => t.id !== id);
    },
    loadTasks: (loaded) => {
      tasks.value = [...loaded];
    },
    planner: () => planner.value,
    setPlanner: (report) => {
      planner.value = report;
    },
    service: () => service.value,
    setService: (report) => {
      service.value = report;
    },
    goingAway: (path) => service.value.fields.find((f) => f.path === path)?.going ?? null,
  };
}
