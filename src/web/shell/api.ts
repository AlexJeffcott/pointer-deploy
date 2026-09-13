import { signal } from "@preact/signals";
// No `.ts` extension, unlike every other import in this tree. `emitSurface`
// sets `allowImportingTsExtensions: false` against a root `tsconfig.json` that
// sets it true, so the extension here fails the surface emit with TS5097 while
// this specifier resolves under `moduleResolution: bundler`. Nothing of
// `document.ts` reaches the surface either way: this is a value read inside a
// function body, and a `.d.ts` carries declarations.
//
// The rule is written there because that is the module holding every other
// field-shaped refusal a task has. One rule, two callers - `setDue` below and
// `readTask` - because a second copy is a second reading that can disagree.
import { isDueDate } from "./document";

/**
 * One task in the planner.
 *
 * The document shape the whole application is built on, declared here because
 * the shell owns it and every sub-app is handed it. `column` has a mover from
 * `PLAN.md` step 4 - `board`, through `moveTask` - and `due` waits for `week`
 * at step 5, declared already because it is what a task IS rather than what a
 * step draws. Step 2 writes this record into IndexedDB and step 3 exports it.
 *
 * There is no "done" flag. A task is done when it sits in the `done` column, so
 * the board and the list cannot disagree about what done means.
 */
export type Task = {
  id: string;
  title: string;
  /** A column id. */
  column: string;
  /**
   * YYYY-MM-DD, or null when the task has no date.
   *
   * `week` at `PLAN.md` step 5 is what reads it, through `setDue`. Two doors
   * write one: `setDue` refuses anything else silently, and `readDocument`
   * refuses it by name. IndexedDB is a third and guards nothing - TODO §46.
   */
  due: string | null;
  tags: readonly string[];
  createdAt: string;
};

/**
 * One column of the board, `PLAN.md` step 4.
 *
 * The set is fixed and the shell owns it. A column is not a task's own string:
 * `board` draws one panel per column and a task moves between them, so the
 * columns have to be a list two units can agree on rather than whatever values
 * happen to be in the planner. `id` is what a task carries and `label` is what
 * a person reads, which is why this is a record and not a string.
 */
export type Column = { id: string; label: string };

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
  /**
   * The board's columns, in the order they are drawn. Fixed, `PLAN.md` step 4.
   *
   * `board` alone calls this, which is the design constraint `PLAN.md`'s
   * contract table states: a unit holding no member of its own leaves the
   * member gate with nothing to refuse for it. Step 10 drops `moveTask` and
   * reads the refusal naming `board` and nothing else.
   */
  columns(): readonly Column[];
  /** Adds a task at the end of the list. Blank titles are refused, silently. */
  addTask(title: string): void;
  /**
   * Moves one task to a column, `PLAN.md` step 4.
   *
   * A column id, not a Column: the task carries the id and the label is the
   * shell's to change. A column no `columns()` entry names is refused, because
   * a task in one is in the planner, drawn by `list`, and on no panel of the
   * board - which is a task a visitor can only reach by exporting the file.
   */
  moveTask(id: string, column: string): void;
  /**
   * Puts one task on a date, or takes it off one, `PLAN.md` step 5.
   *
   * `week` alone calls this, the way `board` alone calls `moveTask`: a unit
   * holding no member of its own leaves the member gate with nothing to refuse
   * for it, which is the design constraint `PLAN.md`'s contract table states.
   *
   * `null` is a value and not a missing argument. A task that had a date and
   * no longer has one is how it leaves the week, and there is no separate
   * member for clearing it.
   *
   * A string that is not `YYYY-MM-DD`, or names a day that does not exist, is
   * refused - because a task carrying one is in the planner, drawn by `list`,
   * and on no day of the week.
   */
  setDue(id: string, due: string | null): void;
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
 * The board's columns, and the order `board` draws them in.
 *
 * Three, and the last of them is what "done" means. There is no done flag on a
 * task: a task is done when it is in the `done` column, so the board and the
 * list cannot hold two readings of one fact.
 *
 * Not exported. `board` reads `store.columns()`, so the constant itself needs
 * no name on the contract - and a second way to reach the same list is a second
 * reading that can disagree with the first.
 */
const COLUMNS: readonly Column[] = [
  { id: "todo", label: "To do" },
  { id: "doing", label: "Doing" },
  { id: "done", label: "Done" },
];

/**
 * Where a task lands when nothing says otherwise: the first column.
 *
 * Derived rather than written down again. A slate that reorders `COLUMNS` moves
 * this with it, and a new task can never land in a column the board does not
 * draw first.
 */
const DEFAULT_COLUMN = COLUMNS[0]!.id;

/** Whether the columns name this one. What `moveTask` refuses on. */
const isColumn = (id: string): boolean => COLUMNS.some((c) => c.id === id);

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
    columns: () => COLUMNS,
    moveTask: (id, column) => {
      // Refused silently, the way a blank title is. There is no visitor input
      // that produces one - `board` draws its buttons from `columns()` - so a
      // sentence here would be a sentence nothing can reach, and writing the
      // column anyway would take the task off every panel of the board.
      if (!isColumn(column)) return;
      tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, column } : t));
    },
    setDue: (id, due) => {
      // Refused silently, for the reason above it. `week` draws its control
      // from the seven days it computed, so no control on the page produces
      // another value - and writing one would take the task off every day of
      // the week while leaving it in the planner and on the list.
      //
      // `null` passes, and is the only value here that is not a date: it is
      // how a task leaves the week.
      if (due !== null && !isDueDate(due)) return;
      tasks.value = tasks.value.map((t) => (t.id === id ? { ...t, due } : t));
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
