import type { Column, Task } from "./api.ts";

/**
 * The planner as one document, `PLAN.md` step 3.
 *
 * Export, import, push and pull all move THIS, which is why it is a module of
 * its own rather than four shapes agreed by four call sites. Two of the four
 * doors are built here; push and pull arrive at steps 6 and 7 and read the same
 * bytes back through `readDocument`.
 *
 * Shell machinery and not contract surface, for the same reason `planner.ts`
 * is: no sub-app reads a file, and the frame draws `/backup` itself. Step 3
 * therefore mints NO contract - a whole view arrived and the surface every unit
 * is built against did not move.
 *
 * The reason it is not surface is the SCHEMA VERSION, and not the compiler
 * error met first. `emitSurface` sets `allowImportingTsExtensions: false`, so
 * `import { readDocument } from "./document.ts"` inside `api.ts` fails the emit
 * with TS5097 - which is one line in `scripts/contract.ts` and not a property
 * of this module, and an extensionless import resolves under `moduleResolution:
 * bundler` anyway. What stands is that a member reading a document has to know
 * which schema version this shell reads, and putting `SCHEMA_VERSION` on the
 * surface means step 14's bump to 2 mints a contract for a number no sub-app
 * can see. `PLAN.md` step 3 carries the whole reading.
 *
 * The frame writes what it read through `ShellStore.loadTasks`, which step 2
 * already put on the surface for the database's own read. One member, two
 * callers, one transaction.
 *
 * The columns arrive as an ARGUMENT from step 4 rather than being imported.
 * `api.ts` is the contract surface, so a constant exported from it for this to
 * read would be a member no sub-app calls - surface the member gate can refuse
 * nothing for, which is what `greeting` was. The frame already holds a store,
 * so it hands over `store.columns()` and the rule reads against the columns
 * this shell actually draws.
 */

/**
 * The planner as one file, `PLAN.md` step 3.
 *
 * One shape through four doors: written to disk, read back, and from step 6
 * pushed to the service and pulled from it. `format` and `schemaVersion` are
 * what make the last three refusable - a door that let in whatever it was
 * handed would put data this shell cannot read into the planner, and the
 * browser enforces a version on the database alone.
 *
 * `schemaVersion` is the DATABASE's version and not a second number: a file is
 * written at the schema the planner is kept at, so step 14's migration is one
 * rule rather than two.
 */
export type PlannerDocument = {
  format: "pointer-planner";
  schemaVersion: number;
  exportedAt: string;
  tasks: readonly Task[];
};

/**
 * What came of reading a document, `PLAN.md` step 3.
 *
 * A refusal carries the sentence rather than a code, because there is exactly
 * one reader of it - the page - and what it has to do is name the field to a
 * person. `ok: false` leaves the planner untouched, which is the half of the
 * rule a scenario measures.
 */
export type ImportOutcome =
  | { ok: true; tasks: readonly Task[] }
  | { ok: false; problem: string };

/**
 * The name on every planner document, and the first field read out of one.
 *
 * A document with no name on it is a document nothing can refuse. `format` is
 * checked before `schemaVersion` deliberately: a file from another application
 * that happens to carry a number is not a planner at an unreadable version, it
 * is not a planner.
 */
export const DOCUMENT_FORMAT = "pointer-planner";

/**
 * Whether a string is a date a task may carry, `PLAN.md` step 5.
 *
 * `YYYY-MM-DD` and a day that exists: `2026-02-30` matches the pattern and is
 * not a date, so the pattern alone is not the rule. Written once and called
 * from two places - here, where a document is read, and `ShellStore.setDue`,
 * where the page writes one. A second copy of this rule is a second reading
 * that can disagree with the first, which is the argument `PLAN.md` makes for
 * the columns arriving as an argument rather than as a constant.
 *
 * `api.ts` imports it WITHOUT the `.ts` extension every other import here
 * carries, and the rule is VALUE against TYPE rather than the extension by
 * itself. Measured on 2026-09-13 in an isolated program with
 * `allowImportingTsExtensions: false`: a value import carrying the extension
 * is TS5097, and a type-only import carrying it is not - the extension is
 * simply emitted into the `.d.ts`. So `api.ts` needs the extension gone and
 * line 1 of this file does not, which is why the emit still passes now that
 * `api.ts` has pulled this module into the emit program for the first time.
 *
 * Nothing of this module reaches the surface either way: a `.d.ts` carries
 * declarations, and this is a value read inside a function.
 */
export function isDueDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const at = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(at) && new Date(at).toISOString().slice(0, 10) === value;
}

/**
 * Whether a string is a moment, TODO §45, `PLAN.md` step 6.
 *
 * Two fields carry one, and until this step neither was read. `createdAt` is
 * what `planner.ts` SORTS the restored list by - lexicographically, because
 * `getAll` returns key order and insertion order is what the list draws - so a
 * hand-edited `"createdAt": "yesterday"` was accepted and reordered the list on
 * the next reload. `exportedAt` was declared required and looked at by nothing.
 *
 * `Date.parse` and not a pattern, because a document is written by an exporter
 * and by hand and both are entitled to their own format. What it does NOT catch
 * is a stamp that parses and is wrong: `"2026"` is a moment and so is any year.
 * The rule is that the field is a time, not that it is the right one.
 *
 * Kept apart from `isDueDate` above rather than folded into it. A due date is a
 * DAY the week draws a panel for, and `2026-02-30` parses in some readings and
 * is not a day; these two fields are instants nothing draws a panel for.
 */
export const isMoment = (value: string): boolean => Number.isFinite(Date.parse(value));

/** What the planner is at this moment, ready to be written to disk or pushed. */
export function documentFrom(tasks: readonly Task[], schemaVersion: number): PlannerDocument {
  return {
    format: DOCUMENT_FORMAT,
    schemaVersion,
    exportedAt: new Date().toISOString(),
    tasks: tasks.map((t) => ({ ...t, tags: [...t.tags] })),
  };
}

/** A value, short enough to put in a sentence a person reads. */
const show = (value: unknown): string => {
  if (value === undefined) return "missing";
  const text = JSON.stringify(value) ?? String(value);
  return text.length > 60 ? `${text.slice(0, 59)}…` : text;
};

const refuse = (problem: string): ImportOutcome => ({ ok: false, problem });

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/**
 * One task out of a document, rebuilt field by field rather than spread.
 *
 * The rebuild is the point. A document at this schema version may carry fields
 * this shell has never heard of - hand-edited, or written by a tool - and
 * spreading them would put them in IndexedDB, where the next export would hand
 * them back and no version anywhere would say they existed. What is stored is
 * what this schema says a task is.
 *
 * Returns the task, or the sentence naming the field that stopped it.
 */
function readTask(value: unknown, at: string, columns: readonly Column[]): Task | string {
  if (!isRecord(value)) return `${at} is ${show(value)}, and a task was expected`;

  for (const field of ["id", "title", "column", "createdAt"] as const) {
    const held = value[field];
    if (typeof held !== "string" || held === "") {
      return `${at}.${field} is ${show(held)}, and a string was expected`;
    }
  }
  // TODO §45, and the door it matters at is this one. `planner.ts` sorts the
  // restored list by `createdAt` as a STRING, so a task carrying "yesterday" is
  // accepted, drawn where the file put it, and somewhere else after the next
  // reload - a change to the planner nobody asked for and nothing reports.
  if (!isMoment(value.createdAt as string)) {
    return `${at}.createdAt is ${show(value.createdAt)}, and a moment was expected`;
  }
  // `PLAN.md` step 4. Before the board existed, `column` was a string nothing
  // read and any value was as good as another. Now one panel per column draws
  // the tasks in it, so a task in a column no column names is in the planner,
  // drawn by `list`, and on no panel of the board - reachable only by exporting
  // the file again. The rebuild below is what makes this refusable rather than
  // silently corrected: a shell that wrote such a task into the first column
  // would change a document it was asked to read.
  if (!columns.some((c) => c.id === value.column)) {
    return (
      `${at}.column is ${show(value.column)}, and this shell draws ` +
      columns.map((c) => JSON.stringify(c.id)).join(", ")
    );
  }
  // `PLAN.md` step 5. Before the week existed, `due` was a string nothing read
  // and any value was as good as another. Now one panel per day draws the tasks
  // due on it, so a task carrying `"yesterday"` is in the planner, drawn by
  // `list`, and on no day of the week. This is the door that is REACHABLE - a
  // hand-edited file, or a planner written by a tool - and it names the field
  // and the shape, the way the column refusal names the columns.
  if (value.due !== null && (typeof value.due !== "string" || !isDueDate(value.due))) {
    return `${at}.due is ${show(value.due)}, and YYYY-MM-DD or null was expected`;
  }
  if (!Array.isArray(value.tags) || value.tags.some((tag) => typeof tag !== "string")) {
    return `${at}.tags is ${show(value.tags)}, and a list of strings was expected`;
  }

  return {
    id: value.id as string,
    title: value.title as string,
    column: value.column as string,
    due: value.due as string | null,
    tags: [...(value.tags as string[])],
    createdAt: value.createdAt as string,
  };
}

/**
 * A document, read the way `PLAN.md`'s table says to read one.
 *
 * `format`, then `schemaVersion`, then the tasks, and a refusal NAMES the field
 * that stopped it. "The file is wrong" sends a person to a text editor with
 * nothing to look for.
 *
 * Nothing here writes. A caller gets the tasks or the sentence, and the planner
 * is untouched until it is handed the first of those - which is what makes
 * "refused, and nothing changed" a rule rather than an ordering.
 */
export function readDocument(
  text: string,
  schemaVersion: number,
  columns: readonly Column[],
): ImportOutcome {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return refuse(`the file is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  return readPlanner(value, schemaVersion, columns);
}

/**
 * The same rule, on a document that is already parsed, `PLAN.md` step 6.
 *
 * The pull door does not hold bytes. `GET /v1/snapshots/:digest` answers with
 * JSON the service has already parsed, and the shell rebuilds the document from
 * the fields of that response - so re-serialising it to hand back to
 * `readDocument` would be a round trip made only to satisfy a signature.
 *
 * One rule, three doors. `PLAN.md`'s four-doors table says the browser enforces
 * the version on the database and NOTHING enforces it on a file or a snapshot,
 * so both of those go through this function and neither carries a rule of its
 * own. A second copy for the pull door is a second reading that can disagree
 * with the first, which is this repository's standing argument against one.
 */
export function readPlanner(
  value: unknown,
  schemaVersion: number,
  columns: readonly Column[],
): ImportOutcome {
  if (!isRecord(value)) {
    return refuse(`the document is ${show(value)}, and a JSON object was expected`);
  }

  if (value.format !== DOCUMENT_FORMAT) {
    return refuse(
      `format is ${show(value.format)}, and this shell reads ${JSON.stringify(DOCUMENT_FORMAT)}`,
    );
  }

  const version = value.schemaVersion;
  if (typeof version !== "number" || !Number.isInteger(version)) {
    return refuse(`schemaVersion is ${show(version)}, and a whole number was expected`);
  }
  if (version > schemaVersion) {
    return refuse(
      `schemaVersion is ${version}, and this shell reads ${schemaVersion}. ` +
        `A newer shell wrote this file`,
    );
  }
  // `PLAN.md` says a lower version is migrated forward and then accepted. There
  // is no lower version to migrate FROM until step 14 adds schema 2, so the
  // only honest thing this shell can do with one is refuse it and say why. An
  // `else` that fell through to accept would write a document written against
  // rules this shell does not have.
  if (version < schemaVersion) {
    return refuse(
      `schemaVersion is ${version}, and this shell reads ${schemaVersion}. ` +
        `Nothing here migrates a planner forward yet`,
    );
  }

  // TODO §45, the other half. The field was declared required from step 3 and
  // read by nothing, which made it a field a writer could omit with no
  // consequence - and this shell's own type says a planner document carries
  // one. Checked AFTER the version and before the tasks, so that a document
  // which is wrong about both its version and its stamp still names the version
  // first: that is the refusal a rollback produces and the one a person can act
  // on.
  //
  // The pull door always has a value for it. `POST /v1/snapshots` records when
  // it kept the bytes, so a pulled document is stamped by the service rather
  // than by whoever wrote the planner.
  if (typeof value.exportedAt !== "string" || !isMoment(value.exportedAt)) {
    return refuse(`exportedAt is ${show(value.exportedAt)}, and a moment was expected`);
  }

  if (!Array.isArray(value.tasks)) {
    return refuse(`tasks is ${show(value.tasks)}, and a list was expected`);
  }

  // The ids are read as a SET, not one at a time. `tasks` is keyed on `id` in
  // IndexedDB, so two tasks carrying one id become one row: the page would draw
  // both, say every task was replaced, and hold one fewer than it claimed - and
  // the disagreement would only show on the next visit. Refusing is the only
  // outcome that keeps the page and the database saying one thing.
  const tasks: Task[] = [];
  const firstAt = new Map<string, number>();
  for (const [index, held] of value.tasks.entries()) {
    const read = readTask(held, `tasks[${index}]`, columns);
    if (typeof read === "string") return refuse(read);

    const first = firstAt.get(read.id);
    if (first !== undefined) {
      return refuse(
        `tasks[${index}].id is ${JSON.stringify(read.id)}, and tasks[${first}] already carries it`,
      );
    }
    firstAt.set(read.id, index);
    tasks.push(read);
  }

  return { ok: true, tasks };
}
