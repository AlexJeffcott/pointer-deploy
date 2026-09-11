// The store the shell owns and every sub-app is handed, §15.
//
// These are the readings a browser scenario cannot take cheaply: what happens
// to the OTHER tasks when one of them is written. `keeping-a-list-of-tasks.feature`
// drives the same store through the panel and the real bundles; this is the
// same rules stated where a mutation can be aimed at them.

import { describe, expect, test } from "bun:test";
import { createStore, NO_SERVICE, type Task } from "./api.ts";

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
    expect(store.tasks()[0]!.column).toBe("todo");
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
