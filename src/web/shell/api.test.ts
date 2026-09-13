// The store the shell owns and every sub-app is handed, §15.
//
// These are the readings a browser scenario cannot take cheaply: what happens
// to the OTHER tasks when one of them is written. `keeping-a-list-of-tasks.feature`
// drives the same store through the panel and the real bundles; this is the
// same rules stated where a mutation can be aimed at them.

import { describe, expect, test } from "bun:test";
import { createStore, NO_PLANNER, NO_SERVICE, type Task } from "./api.ts";

const titles = (tasks: readonly Task[]): string[] => tasks.map((t) => t.title);

describe("the task store", () => {
  test("a fresh store holds no tasks and has read no service", () => {
    const store = createStore();
    expect(store.tasks()).toEqual([]);
    expect(store.service()).toEqual(NO_SERVICE);
  });

  test("a store built from tasks holds them", () => {
    const store = createStore([
      { id: "a", title: "Book the ferry", column: "todo", due: null, tags: [], createdAt: "x" },
    ]);
    expect(titles(store.tasks())).toEqual(["Book the ferry"]);
  });

  // The one `falsify` aims at. Appending and replacing look identical with one
  // task, which is every scenario's first step.
  test("a second task joins the first rather than replacing it", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.addTask("Renew the passport");
    expect(titles(store.tasks())).toEqual(["Book the ferry", "Renew the passport"]);
  });

  test("two tasks added in one go still have different ids", () => {
    const store = createStore();
    store.addTask("one");
    store.addTask("two");
    const [a, b] = store.tasks();
    expect(a!.id).not.toBe(b!.id);
  });

  test("a task is added where nothing has moved it yet, and with no date", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    // The FIRST column, read off `columns()` rather than written down: a slate
    // that reorders them moves this with it, and a new task can never land in a
    // column the board does not draw first.
    expect(store.tasks()[0]!.column).toBe(store.columns()[0]!.id);
    expect(store.tasks()[0]!.due).toBeNull();
    expect(store.tasks()[0]!.tags).toEqual([]);
  });

  test("a title that is blank or only spaces adds nothing", () => {
    const store = createStore();
    store.addTask("");
    store.addTask("   ");
    expect(store.tasks()).toEqual([]);
  });

  test("a title keeps its words and loses its surrounding space", () => {
    const store = createStore();
    store.addTask("  Book the ferry  ");
    expect(titles(store.tasks())).toEqual(["Book the ferry"]);
  });

  test("tags land on the task they name, and on no other", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.addTask("Renew the passport");
    const first = store.tasks()[0]!.id;
    store.setTags(first, ["travel", "summer"]);
    expect(store.tasks()[0]!.tags).toEqual(["travel", "summer"]);
    expect(store.tasks()[1]!.tags).toEqual([]);
  });

  test("setting tags replaces them rather than adding to them", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    const id = store.tasks()[0]!.id;
    store.setTags(id, ["travel"]);
    store.setTags(id, ["summer"]);
    expect(store.tasks()[0]!.tags).toEqual(["summer"]);
  });

  // The store keeps its own copy: a caller that goes on editing the array it
  // handed in must not be editing the planner.
  test("the tags handed in are copied, not held", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    const given = ["travel"];
    store.setTags(store.tasks()[0]!.id, given);
    given.push("summer");
    expect(store.tasks()[0]!.tags).toEqual(["travel"]);
  });

  test("naming a task nothing holds changes nothing", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.setTags("nobody", ["travel"]);
    store.removeTask("nobody");
    expect(titles(store.tasks())).toEqual(["Book the ferry"]);
    expect(store.tasks()[0]!.tags).toEqual([]);
  });

  test("removing a task takes that task and leaves the rest", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.addTask("Renew the passport");
    store.removeTask(store.tasks()[0]!.id);
    expect(titles(store.tasks())).toEqual(["Renew the passport"]);
  });

  test("a field the service does not mark is not going away", () => {
    const store = createStore();
    expect(store.goingAway("snapshot.tasks")).toBeNull();
  });

  test("a field the service marks is reported with the day it goes", () => {
    const store = createStore();
    const going = {
      since: "2026-09-11",
      sunset: "2026-12-11",
      reason: "a planner stores more than tasks",
      instead: "snapshot.document",
    };
    store.setService({
      ...NO_SERVICE,
      state: "ok",
      fields: [{ path: "snapshot.tasks", type: "array", going }],
    });
    expect(store.goingAway("snapshot.tasks")).toEqual(going);
    expect(store.goingAway("snapshot.document")).toBeNull();
  });
});

// `PLAN.md` step 2. The database itself is browser-only and is measured by
// `keeping-the-planner-in-the-browser.feature`; these are the store's half of
// it, which is what the shell writes into after the read and what `list` reads
// to decide which sentence to put on the page.
// `PLAN.md` step 4. `board`'s two members, and the reading a browser scenario
// cannot take cheaply: what a move does to the OTHER tasks, and what the store
// does with a column no column names.
describe("the board's columns", () => {
  test("every column carries an id and a label a person reads", () => {
    const columns = createStore().columns();
    expect(columns.length).toBeGreaterThan(1);
    for (const column of columns) {
      expect(column.id).not.toBe("");
      expect(column.label).not.toBe("");
    }
  });

  test("no two columns carry one id", () => {
    const ids = createStore().columns().map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  // A board with one column has nowhere to move a task to, and a done column is
  // what "done" means on this slate - there is no flag on a task for it.
  test("the columns end in the one that means done", () => {
    const columns = createStore().columns();
    expect(columns[columns.length - 1]!.id).toBe("done");
  });

  test("two stores report the same columns", () => {
    expect(createStore().columns()).toEqual(createStore().columns());
  });
});

describe("moving a task between columns", () => {
  const moved = (to: string): ReturnType<typeof createStore> => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.moveTask(store.tasks()[0]!.id, to);
    return store;
  };

  test("a task moved to a column is in it", () => {
    expect(moved("done").tasks()[0]!.column).toBe("done");
  });

  // The one `falsify` aims at. A move that rewrote every task looks correct
  // with one task on the board, which is every scenario's first step.
  test("moving one task leaves every other task where it was", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.addTask("Renew the passport");
    const [first] = store.tasks();
    store.moveTask(first!.id, "doing");
    expect(store.tasks().map((t) => `${t.title} ${t.column}`)).toEqual([
      "Book the ferry doing",
      "Renew the passport todo",
    ]);
  });

  test("a move keeps the task's place in the planner, its title and its tags", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.addTask("Renew the passport");
    const [, second] = store.tasks();
    store.setTags(second!.id, ["travel"]);
    store.moveTask(second!.id, "done");
    expect(titles(store.tasks())).toEqual(["Book the ferry", "Renew the passport"]);
    expect(store.tasks()[1]!.tags).toEqual(["travel"]);
  });

  // Silently, the way a blank title is refused. No control on the board can
  // produce one - the buttons are drawn from `columns()` - so a sentence here
  // would be a sentence nothing reaches; what a write WOULD produce is a task
  // in the planner, on the list, and on no panel of the board.
  test("a column no column names moves nothing", () => {
    expect(moved("someday").tasks()[0]!.column).toBe("todo");
  });

  test("a task id nothing holds moves nothing", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.moveTask("no-such-task", "done");
    expect(store.tasks()[0]!.column).toBe("todo");
    expect(store.tasks().length).toBe(1);
  });
});

// `PLAN.md` step 5. `week`'s one member, and the reading a browser scenario
// cannot take cheaply: which values a date may be, and what a write does to
// the other tasks. The seven days themselves are the UNIT's, computed from the
// clock, so nothing here knows what a week is.
describe("putting a task on a date", () => {
  const dated = (due: string | null): ReturnType<typeof createStore> => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.setDue(store.tasks()[0]!.id, due);
    return store;
  };

  test("a new task starts with no date", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    expect(store.tasks()[0]!.due).toBeNull();
  });

  test("a task put on a date carries it", () => {
    expect(dated("2026-09-14").tasks()[0]!.due).toBe("2026-09-14");
  });

  // `null` is a value here and not a missing argument: it is how a task leaves
  // the week, and there is no second member for clearing a date.
  test("a date can be taken off again", () => {
    const store = dated("2026-09-14");
    store.setDue(store.tasks()[0]!.id, null);
    expect(store.tasks()[0]!.due).toBeNull();
  });

  // The one `falsify` aims at. A write that dated every task looks correct with
  // one task on the page, which is every scenario's first step.
  test("dating one task leaves every other task where it was", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.addTask("Renew the passport");
    const [first] = store.tasks();
    store.setDue(first!.id, "2026-09-14");
    expect(store.tasks().map((t) => `${t.title} ${t.due}`)).toEqual([
      "Book the ferry 2026-09-14",
      "Renew the passport null",
    ]);
  });

  test("a date keeps the task's place in the planner, its column and its tags", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.addTask("Renew the passport");
    const [, second] = store.tasks();
    store.setTags(second!.id, ["travel"]);
    store.moveTask(second!.id, "doing");
    store.setDue(second!.id, "2026-09-16");
    expect(titles(store.tasks())).toEqual(["Book the ferry", "Renew the passport"]);
    expect(store.tasks()[1]!.tags).toEqual(["travel"]);
    expect(store.tasks()[1]!.column).toBe("doing");
  });

  // Silently, the way a column no column names is: this surface returns nothing
  // and has no member for reporting a refusal. The write would take the task
  // off every day of the week while leaving it in the planner and on the list,
  // so not writing is the outcome that keeps the page and the planner saying
  // one thing.
  //
  // `2026-02-30` is the one that matters: it matches the pattern and is not a
  // date, so a rule that stopped at the pattern would let it through.
  test.each(["yesterday", "", "2026-9-14", "14-09-2026", "2026-02-30", "2026-13-01", "2026-09-31"])(
    "%p is not a date, and puts the task on none",
    (bad) => {
      expect(dated(bad).tasks()[0]!.due).toBeNull();
    },
  );

  test.each(["2026-09-14", "2024-02-29", "2026-12-31", "2026-01-01"])(
    "%p is a date, and the task carries it",
    (good) => {
      expect(dated(good).tasks()[0]!.due).toBe(good);
    },
  );

  // A refused date leaves the date the task already had, rather than clearing
  // it: the write does not happen at all.
  test("a refused date leaves the one the task already carried", () => {
    const store = dated("2026-09-14");
    store.setDue(store.tasks()[0]!.id, "someday");
    expect(store.tasks()[0]!.due).toBe("2026-09-14");
  });

  test("a task id nothing holds dates nothing", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.setDue("no-such-task", "2026-09-14");
    expect(store.tasks()[0]!.due).toBeNull();
    expect(store.tasks().length).toBe(1);
  });
});

describe("the planner the store reports", () => {
  test("a fresh store has not read a planner", () => {
    expect(createStore().planner()).toEqual(NO_PLANNER);
  });

  test("loading tasks replaces every task rather than adding to them", () => {
    const store = createStore();
    store.addTask("typed before the read landed");
    store.loadTasks([
      { id: "a", title: "Book the ferry", column: "todo", due: null, tags: [], createdAt: "x" },
    ]);
    expect(titles(store.tasks())).toEqual(["Book the ferry"]);
  });

  test("the tasks loaded in are copied, not held", () => {
    const store = createStore();
    const loaded: Task[] = [
      { id: "a", title: "Book the ferry", column: "todo", due: null, tags: [], createdAt: "x" },
    ];
    store.loadTasks(loaded);
    loaded.push({ id: "b", title: "later", column: "todo", due: null, tags: [], createdAt: "y" });
    expect(titles(store.tasks())).toEqual(["Book the ferry"]);
  });

  test("loading no tasks empties a store that held some", () => {
    const store = createStore();
    store.addTask("Book the ferry");
    store.loadTasks([]);
    expect(store.tasks()).toEqual([]);
  });

  test("a planner that was read reports the version it is stored at", () => {
    const store = createStore();
    store.setPlanner({
      state: "stored",
      schemaVersion: 1,
      pending: false,
      error: null,
      readAt: "2026-09-11T12:00:00.000Z",
    });
    expect(store.planner().state).toBe("stored");
    expect(store.planner().schemaVersion).toBe(1);
    expect(store.planner().pending).toBe(false);
  });

  // The window `TODO` §40 is about, and the reading that makes it measurable:
  // a change is made here and the database does not hold it yet.
  test("a planner with a write still going says it is pending", () => {
    const store = createStore();
    store.setPlanner({
      state: "stored",
      schemaVersion: 1,
      pending: true,
      error: null,
      readAt: "2026-09-11T12:00:00.000Z",
    });
    expect(store.planner().pending).toBe(true);
    expect(store.planner().state).toBe("stored");
  });

  test("a planner that cannot be stored reports why, and keeps its tasks", () => {
    const store = createStore();
    store.setPlanner({
      state: "unstored",
      schemaVersion: null,
      pending: false,
      error: "this browser does not offer IndexedDB",
      readAt: "2026-09-11T12:00:00.000Z",
    });
    store.addTask("Book the ferry");
    expect(store.planner().state).toBe("unstored");
    expect(store.planner().error).toBe("this browser does not offer IndexedDB");
    expect(titles(store.tasks())).toEqual(["Book the ferry"]);
  });
});
