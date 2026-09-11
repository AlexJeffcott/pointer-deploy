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
import type { Task } from "./api.ts";

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

const held = (text: string, version = 1): readonly Task[] => {
  const read = readDocument(text, version);
  if (!read.ok) throw new Error(`expected a document, and it was refused: ${read.problem}`);
  return read.tasks;
};

const refusal = (text: string, version = 1): string => {
  const read = readDocument(text, version);
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

  test("a task whose due date is neither a date nor null is refused", () => {
    expect(refusal(asFile([{ ...task(), due: 20260920 }]))).toContain("tasks[0].due");
  });

  test("a task with a due date is accepted", () => {
    expect(held(asFile([task({ due: "2026-09-20" })]))[0]!.due).toBe("2026-09-20");
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
