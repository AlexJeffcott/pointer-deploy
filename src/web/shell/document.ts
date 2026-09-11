import type { Task } from "./api.ts";

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
 * It also cannot be contract surface. `scripts/contract.ts` emits `shell.d.ts`
 * with `allowImportingTsExtensions` off, so `api.ts` is a LEAF: a sibling
 * import from it fails the emit with TS5097. Putting these rules on
 * `ShellStore` would mean inlining them into `api.ts` and carrying the
 * DATABASE's schema version on the surface, where a bump at step 14 would mint
 * a contract for a number no sub-app can see.
 *
 * The frame writes what it read through `ShellStore.loadTasks`, which step 2
 * already put on the surface for the database's own read. One member, two
 * callers, one transaction.
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
function readTask(value: unknown, at: string): Task | string {
  if (!isRecord(value)) return `${at} is ${show(value)}, and a task was expected`;

  for (const field of ["id", "title", "column", "createdAt"] as const) {
    const held = value[field];
    if (typeof held !== "string" || held === "") {
      return `${at}.${field} is ${show(held)}, and a string was expected`;
    }
  }
  if (value.due !== null && typeof value.due !== "string") {
    return `${at}.due is ${show(value.due)}, and a date or null was expected`;
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
export function readDocument(text: string, schemaVersion: number): ImportOutcome {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (e) {
    return refuse(`the file is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!isRecord(value)) return refuse(`the file is ${show(value)}, and a JSON object was expected`);

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

  if (!Array.isArray(value.tasks)) {
    return refuse(`tasks is ${show(value.tasks)}, and a list was expected`);
  }

  const tasks: Task[] = [];
  for (const [index, held] of value.tasks.entries()) {
    const read = readTask(held, `tasks[${index}]`);
    if (typeof read === "string") return refuse(read);
    tasks.push(read);
  }

  return { ok: true, tasks };
}
