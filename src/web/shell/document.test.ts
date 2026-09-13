// The planner as one document, `PLAN.md` step 3.
//
// These are the readings a browser scenario cannot take cheaply: every way a
// file can be wrong, and what the refusal says about it.
// `backing-up-the-planner.feature` drives the two doors through the real page
// and the real database; this is the rule stated where a mutation can be aimed
// at each branch of it.
//
// Every refusal is asserted on the FIELD it names rather than on the whole
// sentence. A person meeting one of these has to be sent somewhere in the file,
// and a test that matched the wording would go red on a rewording and stay
// green on a refusal that named the wrong field.

import { describe, expect, test } from "bun:test";
import { DOCUMENT_FORMAT, documentFrom, readDocument } from "./document.ts";
import { createStore } from "./api.ts";
import type { Column, Task } from "./api.ts";

/**
 * The columns this shell draws, read off a real store rather than written down.
 *
 * `PLAN.md` step 4 reads a document against them, so a test naming its own list
 * would go on passing after the shell's columns changed - and the rule is about
 * the two agreeing.
 */
const COLUMNS: readonly Column[] = createStore().columns();

const task = (over: Partial<Task> = {}): Task => ({
  id: "t1",
  title: "Book the ferry",
  column: "todo",
  due: null,
  tags: [],
  createdAt: "2026-09-11T09:00:00.000Z",
  ...over,
});

const file = (doc: unknown): string => JSON.stringify(doc);

const held = (text: string, version = 1, columns = COLUMNS): readonly Task[] => {
  const read = readDocument(text, version, columns);
  if (!read.ok) throw new Error(`expected a document, and it was refused: ${read.problem}`);
  return read.tasks;
};

const refusal = (text: string, version = 1, columns = COLUMNS): string => {
  const read = readDocument(text, version, columns);
  if (read.ok) throw new Error(`expected a refusal, and ${read.tasks.length} tasks came back`);
  return read.problem;
};

describe("writing a document", () => {
  test("it names the format and the schema version it was written at", () => {
    const doc = documentFrom([], 1);
    expect(doc.format).toBe(DOCUMENT_FORMAT);
    expect(doc.schemaVersion).toBe(1);
  });

  test("it carries every task on the list", () => {
    const doc = documentFrom([task({ id: "a", title: "one" }), task({ id: "b", title: "two" })], 1);
    expect(doc.tasks.map((t) => t.title)).toEqual(["one", "two"]);
  });

  test("it is stamped with an instant", () => {
    const doc = documentFrom([], 1);
    expect(Number.isNaN(Date.parse(doc.exportedAt))).toBe(false);
  });

  // A document handed out and then edited must not be editing the planner.
  test("the tags are copied rather than held", () => {
    const tags = ["travel"];
    const doc = documentFrom([task({ tags })], 1);
    tags.push("summer");
    expect(doc.tasks[0]!.tags).toEqual(["travel"]);
  });

  test("what it writes is what it reads back", () => {
    const tasks = [task({ id: "a", tags: ["travel"] }), task({ id: "b", due: "2026-09-20" })];
    expect(held(file(documentFrom(tasks, 1)))).toEqual(tasks);
  });
});

describe("reading a document", () => {
  test("an empty planner is a planner", () => {
    expect(held(file({ format: DOCUMENT_FORMAT, schemaVersion: 1, tasks: [] }))).toEqual([]);
  });

  test("a file that is not JSON is refused", () => {
    expect(refusal("this is not a planner")).toContain("not JSON");
  });

  test("a file that is not an object is refused", () => {
    expect(refusal("[]")).toContain("JSON object");
  });
});

describe("the format field", () => {
  test("a file naming no format is refused, and the field is named", () => {
    expect(refusal(file({ schemaVersion: 1, tasks: [] }))).toContain("format is missing");
  });

  test("a file naming another format is refused, and both names are given", () => {
    const problem = refusal(file({ format: "todo-list", schemaVersion: 1, tasks: [] }));
    expect(problem).toContain("format");
    expect(problem).toContain("todo-list");
    expect(problem).toContain(DOCUMENT_FORMAT);
  });

  // Read BEFORE the version. A file from another application that happens to
  // carry a number is not a planner at an unreadable version; it is not a
  // planner, and the sentence has to send a person to the right field.
  test("a file from another application is refused for its format and not its version", () => {
    expect(refusal(file({ format: "todo-list", schemaVersion: 9, tasks: [] }))).toContain("format");
  });
});

describe("the schema version", () => {
  test("a version this shell reads is accepted", () => {
    expect(held(file({ format: DOCUMENT_FORMAT, schemaVersion: 1, tasks: [] }), 1)).toEqual([]);
  });

  test("a file with no version is refused, and the field is named", () => {
    expect(refusal(file({ format: DOCUMENT_FORMAT, tasks: [] }))).toContain("schemaVersion");
  });

  test("a version that is not a whole number is refused", () => {
    expect(refusal(file({ format: DOCUMENT_FORMAT, schemaVersion: "1", tasks: [] }))).toContain(
      "whole number",
    );
  });

  // What a rollback produces: the code moves back and the file does not.
  test("a file a newer shell wrote is refused, and both versions are named", () => {
    const problem = refusal(file({ format: DOCUMENT_FORMAT, schemaVersion: 9, tasks: [] }), 1);
    expect(problem).toContain("9");
    expect(problem).toContain("1");
    expect(problem).toContain("newer shell");
  });

  // `PLAN.md` says a lower version is migrated forward. There is nothing to
  // migrate from until step 14 mints schema 2, so the only honest thing this
  // shell can do is refuse it and say so. Accepting it would write a document
  // written against rules this shell does not have.
  test("a file an older shell wrote is refused while nothing migrates it", () => {
    const problem = refusal(file({ format: DOCUMENT_FORMAT, schemaVersion: 1, tasks: [] }), 2);
    expect(problem).toContain("1");
    expect(problem).toContain("2");
    expect(problem).toContain("migrate");
  });
});

describe("the tasks", () => {
  const asFile = (tasks: unknown): string =>
    file({ format: DOCUMENT_FORMAT, schemaVersion: 1, tasks });

  test("a file with no task list is refused, and the field is named", () => {
    expect(refusal(file({ format: DOCUMENT_FORMAT, schemaVersion: 1 }))).toContain("tasks");
  });

  test("a task list that is not a list is refused", () => {
    expect(refusal(asFile({ "0": task() }))).toContain("tasks");
  });

  test("a task that is not an object is refused, and its place is named", () => {
    expect(refusal(asFile(["Book the ferry"]))).toContain("tasks[0]");
  });

  test("a task with no title is refused, and the field is named", () => {
    const { id, column, due, tags, createdAt } = task();
    expect(refusal(asFile([{ id, column, due, tags, createdAt }]))).toContain("tasks[0].title");
  });

  // The id rule has a test of its own because the `tx.abort()` guard in
  // `planner.ts` rests on it: nothing reachable makes `IDBObjectStore.put`
  // throw precisely because every task that reaches the database carries a
  // non-empty string id. A rule an argument rests on is a rule to check.
  test("a task with no id is refused, and the field is named", () => {
    const { title, column, due, tags, createdAt } = task();
    expect(refusal(asFile([{ title, column, due, tags, createdAt }]))).toContain("tasks[0].id");
  });

  test("a task whose id is blank is refused", () => {
    expect(refusal(asFile([task({ id: "" })]))).toContain("tasks[0].id");
  });

  // `tasks` is keyed on `id`, so two tasks carrying one id become one row. The
  // page would draw both and say every task was replaced, the database would
  // hold one, and the disagreement would only show on the next visit.
  test("two tasks carrying one id are refused, and both places are named", () => {
    const problem = refusal(asFile([task({ id: "a" }), task({ id: "a", title: "two" })]));
    expect(problem).toContain("tasks[1].id");
    expect(problem).toContain("tasks[0]");
  });

  test("two tasks carrying different ids are accepted", () => {
    expect(held(asFile([task({ id: "a" }), task({ id: "b", title: "two" })]))).toHaveLength(2);
  });

  test("a task with a blank title is refused", () => {
    expect(refusal(asFile([task({ title: "" })]))).toContain("tasks[0].title");
  });

  // The index is the reading. A file with forty tasks in it and a refusal
  // saying only "a task is wrong" sends a person through forty of them.
  test("the refusal names the task that stopped it and not the first one", () => {
    expect(refusal(asFile([task({ id: "a" }), { ...task({ id: "b" }), column: 7 }]))).toContain(
      "tasks[1].column",
    );
  });

  // `PLAN.md` step 4. A column no column names puts the task in the planner,
  // on the list, and on no panel of the board - and the only way back to it is
  // to export the file again.
  test("a task in a column this shell does not draw is refused", () => {
    expect(refusal(asFile([task({ column: "someday" })]))).toContain("tasks[0].column");
  });

  test("the refusal names the columns this shell draws", () => {
    const problem = refusal(asFile([task({ column: "someday" })]));
    for (const column of COLUMNS) expect(problem).toContain(JSON.stringify(column.id));
  });

  test("every column the shell draws is accepted", () => {
    for (const column of COLUMNS) {
      expect(held(asFile([task({ column: column.id })]))[0]!.column).toBe(column.id);
    }
  });

  test("a task whose due date is neither a date nor null is refused", () => {
    expect(refusal(asFile([{ ...task(), due: 20260920 }]))).toContain("tasks[0].due");
  });

  test("a task with a due date is accepted", () => {
    expect(held(asFile([task({ due: "2026-09-20" })]))[0]!.due).toBe("2026-09-20");
  });

  // `PLAN.md` step 5, and the door on `due` that a person can actually reach.
  // Until the week existed `due` was a string nothing read and any value was as
  // good as another; now one panel per day draws the tasks due on it, so a task
  // carrying "yesterday" is in the planner, on the list, and on no day of the
  // week. `setDue` is the other door and refuses silently, because the control
  // on the page is a list of dates; this one is a hand-edited file and names
  // the field and the shape.
  test.each(["yesterday", "", "2026-9-20", "20-09-2026", "2026-02-30", "2026-13-01"])(
    "a task whose due date reads %p is refused",
    (bad) => {
      const problem = refusal(asFile([task({ due: bad })]));
      expect(problem).toContain("tasks[0].due");
      expect(problem).toContain("YYYY-MM-DD");
    },
  );

  test.each(["2026-09-20", "2024-02-29", "2026-01-01", "2026-12-31"])(
    "a task whose due date reads %p is accepted",
    (good) => {
      expect(held(asFile([task({ due: good })]))[0]!.due).toBe(good);
    },
  );

  test("a task with no due date at all is accepted", () => {
    expect(held(asFile([task({ due: null })]))[0]!.due).toBeNull();
  });

  test("a task whose tags are not a list is refused", () => {
    expect(refusal(asFile([{ ...task(), tags: "travel" }]))).toContain("tasks[0].tags");
  });

  test("a task carrying something that is not a tag is refused", () => {
    expect(refusal(asFile([{ ...task(), tags: ["travel", 7] }]))).toContain("tasks[0].tags");
  });

  // The whole reason a task is rebuilt field by field rather than spread. A
  // field this schema does not have would otherwise reach IndexedDB, come back
  // out of the next export, and be carried by a planner no version describes.
  test("a field this schema does not have is dropped rather than stored", () => {
    const read = held(asFile([{ ...task(), done: true, colour: "red" }]))[0]!;
    expect(Object.keys(read).sort()).toEqual([
      "column",
      "createdAt",
      "due",
      "id",
      "tags",
      "title",
    ]);
  });

  test("the tags in the file are copied rather than held", () => {
    const tags = ["travel"];
    const read = held(asFile([task({ tags })]))[0]!;
    expect(read.tags).toEqual(["travel"]);
    expect(read.tags).not.toBe(tags);
  });
});
