// One session with the planner, driven through the app's own controls.
//
//   bun run session [--in <file>] [--ops <file>] [--out <file>]
//                              [--shots <dir>] [--profile <dir>] [--selftest]
//
// `Bun.WebView` and not Playwright: Bun 1.4.2 ships headless browser
// automation, so this needs no second browser stack. The backend is `chrome`
// rather than the macOS default `webkit`, because two of the doors need the
// Chrome DevTools Protocol - a file input has to be SET for the import door,
// and a download has to be aimed at a directory for the export door. WebKit
// has neither.
//
// Every write goes through a control a visitor clicks: `addTask` through the
// list's form, `setTags` through its tag input, `moveTask` through the board's
// buttons. The one exception is the week's `<select>`, which is assigned and
// told to fire `change` - a headless browser draws no native dropdown, and the
// app's own handler still runs.
//
// The import and export doors are the real ones too. A planner is read out of a
// FILE through `[data-import]` and written to one through `[data-export]`, so a
// session that ends leaves the state where the next session's `--in` reads it.
export {};

import { readPlanner } from "../src/web/shell/document.ts";
import { createStore } from "../src/web/shell/api.ts";
import { SCHEMA_VERSION } from "../src/web/shell/planner.ts";

type Op =
  | { add: string }
  | { tags: string; to: readonly string[] }
  | { move: string; to: string }
  | { due: string; on: string | null }
  | { remove: string };

const flag = (name: string): string | undefined => {
  const at = Bun.argv.indexOf(name);
  return at === -1 ? undefined : Bun.argv[at + 1];
};

const ORIGIN = (flag("--origin") ?? "https://pointer-deploy.fly.dev").replace(/\/$/, "");
const IN = flag("--in");
const OPS = flag("--ops");
const OUT = flag("--out");
const SHOTS = flag("--shots");
const PROFILE = flag("--profile");
const SELFTEST = Bun.argv.includes("--selftest");

const failures: string[] = [];
let step = 0;
const heading = (text: string): void => console.log(`\n${++step}. ${text}`);
const check = (ok: boolean, said: string): boolean => {
  console.log(`  ${ok ? "ok  " : "FAIL"}  ${said}`);
  if (!ok) failures.push(said);
  return ok;
};

/**
 * A value, as a JavaScript literal. Every selector reaches the page inside one.
 *
 * Titles are visitor text and one of the SFPL titles carries an apostrophe, so
 * a selector interpolated into a single-quoted literal would end the string
 * half way through the task. Both of these are `JSON.stringify` and the names
 * say which side of the fence the value is on.
 */
const js = (value: string): string => JSON.stringify(value);
/** A title, as a CSS attribute value inside double quotes. */
const attr = (value: string): string => JSON.stringify(value);

await using view = new Bun.WebView({
  width: 1400,
  height: 1000,
  backend: "chrome",
  ...(PROFILE ? { dataStore: { directory: PROFILE } } : {}),
  console: (type: string, ...args: unknown[]) => {
    if (type === "error" || type === "warn") console.log(`  page[${type}]`, ...args);
  },
});

/** Poll the page until the expression is true. `evaluate` has no waiter. */
const until = async (expression: string, what: string, ms = 30_000): Promise<boolean> => {
  const stop = Date.now() + ms;
  for (;;) {
    if (await view.evaluate(expression)) return true;
    if (Date.now() > stop) return check(false, `timed out after ${ms} ms waiting for ${what}`);
    await Bun.sleep(100);
  }
};

const there = async (selector: string, what: string, ms = 30_000): Promise<boolean> =>
  until(`!!document.querySelector(${js(selector)})`, what, ms);

const count = async (selector: string): Promise<number> =>
  (await view.evaluate(`document.querySelectorAll(${js(selector)}).length`)) as number;

const said = async (selector: string): Promise<string> =>
  ((await view.evaluate(
    `(document.querySelector(${js(selector)})?.textContent ?? "").trim()`,
  )) as string) ?? "";

const openView = async (path: string, panel: string): Promise<void> => {
  await view.navigate(`${ORIGIN}${path}`);
  await there(`[data-app=${attr(panel)}]`, `the ${panel} panel`);
};

/**
 * Click a control, after scrolling it into view.
 *
 * `click(selector)` waits for the element to be ACTIONABLE, and an element 66
 * rows down a list is present and not actionable - measured 2026-09-16, where
 * the tag input of a task added to a 65-task planner timed out at 30 s while
 * `querySelector` had already found it. Scrolling first is what makes the
 * difference, and no amount of waiting would have.
 */
const clickOn = async (selector: string, what: string): Promise<void> => {
  await there(selector, what);
  await view.scrollTo(selector);
  await view.click(selector);
};

/** The planner as the database holds it. Read, never written. */
type Row = { title: string; column: string; tags: string[]; due: string | null };
const rowsHeld = async (): Promise<Row[]> =>
  (await view.evaluate(`(async () => {
    const db = await new Promise((ok, no) => {
      const r = indexedDB.open("pointer-planner", 1);
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    const rows = await new Promise((ok, no) => {
      const r = db.transaction("tasks", "readonly").objectStore("tasks").getAll();
      r.onsuccess = () => ok(r.result);
      r.onerror = () => no(r.error);
    });
    db.close();
    return rows.map((t) => ({ title: t.title, column: t.column, tags: t.tags, due: t.due }));
  })()`)) as never;

// ----------------------------------------------------------------- the doors

/**
 * A planner in, through the file input a visitor uses.
 *
 * CDP sets the input's files, which is the only way to hand a headless browser
 * a file. Everything after that is the app: the `change` event, `readDocument`,
 * and one IndexedDB transaction.
 */
const importFile = async (file: string): Promise<void> => {
  await view.navigate(`${ORIGIN}/backup`);
  await there("[data-import]:not([disabled])", "the import door");
  const root = (await view.cdp("DOM.getDocument", {})) as { root: { nodeId: number } };
  const node = (await view.cdp("DOM.querySelector", {
    nodeId: root.root.nodeId,
    selector: "[data-import]",
  })) as { nodeId: number };
  await view.cdp("DOM.setFileInputFiles", { nodeId: node.nodeId, files: [file] });
  await until(
    `!!document.querySelector("[data-import-read], [data-import-refused]")`,
    "the import to answer",
  );
  const refused = await said("[data-import-refused]");
  if (refused) return void check(false, `the import was refused: ${refused}`);
  const read = await view.evaluate(
    `document.querySelector("[data-import-read]").getAttribute("data-import-read")`,
  );
  check(true, `the shell read ${read} tasks out of ${file.split("/").pop()}`);
};

/** A planner out, through the export button. Chrome writes the download here. */
const exportFile = async (to: string): Promise<void> => {
  const dir = to.slice(0, to.lastIndexOf("/")) || ".";
  const catchment = `${dir}/.session-download`;
  await Bun.$`rm -rf ${catchment}`.quiet();
  await Bun.$`mkdir -p ${catchment}`.quiet();
  await view.cdp("Browser.setDownloadBehavior", {
    behavior: "allow",
    downloadPath: catchment,
    eventsEnabled: true,
  });
  await view.navigate(`${ORIGIN}/backup`);
  await clickOn("[data-export]:not([disabled])", "the export door");

  // Chrome writes `.crdownload` first, so a file that exists is not a file that
  // is finished. What settles it is the document PARSING and then passing the
  // shell's own reader - the same rule the import door applies.
  const stop = Date.now() + 20_000;
  for (;;) {
    const found = [...new Bun.Glob("*.json").scanSync({ cwd: catchment, absolute: true })];
    if (found[0]) {
      try {
        const doc = await Bun.file(found[0]).json();
        const outcome = readPlanner(doc, SCHEMA_VERSION, createStore().columns());
        if (!outcome.ok) {
          return void check(false, `the exported file is refused: ${outcome.problem}`);
        }
        await Bun.write(to, await Bun.file(found[0]).text());
        await Bun.$`rm -rf ${catchment}`.quiet();
        return void check(
          true,
          `exported ${outcome.tasks.length} tasks to ${to}, and the shell's own reader accepts it`,
        );
      } catch {
        // still being written
      }
    }
    if (Date.now() > stop) return void check(false, "no export landed in 20 s");
    await Bun.sleep(200);
  }
};

// ------------------------------------------------------------ the operations

const doAdd = async (title: string): Promise<void> => {
  await openView("/", "list");
  await clickOn("[data-new-task]", "the new-task field");
  await view.type(title);
  await view.click("[data-add-task]");
  await there(`[data-task=${attr(title)}]`, `the task ${title}`);
};

const doTags = async (title: string, tags: readonly string[]): Promise<void> => {
  await openView("/", "list");
  const input = `[data-tag-input=${attr(title)}]`;
  // Cleared through the app: select all, then type over it, so the `input`
  // handler sees every state and `setTags` is what writes.
  await clickOn(input, `the tag input for ${title}`);
  await view.press("a", { modifiers: ["Meta"] });
  await view.type(tags.join(", "));
  await until(
    `(document.querySelector(${js(`[data-tags=${attr(title)}]`)})?.textContent ?? "").trim() === ${js(tags.join(", "))}`,
    `the page to say the tags of ${title}`,
  );
};

const doMove = async (title: string, to: string): Promise<void> => {
  await openView("/board", "board");
  const button = `[data-move=${attr(title)}][data-to=${attr(to)}]`;
  await clickOn(button, `the move button for ${title} to ${to}`);
  await there(`[data-card=${attr(title)}][data-in=${attr(to)}]`, `${title} to be in ${to}`);
};

/**
 * A due date, set on the week's select.
 *
 * The only operation not driven by a click. A headless browser draws no native
 * dropdown, so the value is assigned and `change` is dispatched - which runs
 * the app's own `onChange` and `store.setDue`. The select offers the SEVEN days
 * the week draws and nothing else, so a date outside this week is refused here
 * rather than written into a task no panel can show.
 */
const doDue = async (title: string, on: string | null): Promise<void> => {
  await openView("/week", "week");
  const picker = `[data-due=${attr(title)}]`;
  await there(picker, `the due picker for ${title}`);
  const offered = (await view.evaluate(
    `[...document.querySelector(${js(picker)}).options].map((o) => o.value)`,
  )) as string[];
  if (!offered.includes(on ?? "")) {
    return void check(
      false,
      `the week offers ${JSON.stringify(offered)}, and not ${JSON.stringify(on)}`,
    );
  }
  await view.evaluate(`(() => {
    const el = document.querySelector(${js(picker)});
    el.value = ${js(on ?? "")};
    el.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  })()`);
  await until(
    `(document.querySelector(${js(picker)})?.value ?? "") === ${js(on ?? "")}`,
    `the due date of ${title}`,
  );
};

const doRemove = async (title: string): Promise<void> => {
  await openView("/", "list");
  const button = `[data-remove-task=${attr(title)}]`;
  await clickOn(button, `the remove button for ${title}`);
  await until(
    `!document.querySelector(${js(`[data-task=${attr(title)}]`)})`,
    `${title} to be gone`,
  );
};

const run = async (op: Op): Promise<void> => {
  if ("add" in op) return doAdd(op.add);
  if ("tags" in op) return doTags(op.tags, op.to);
  if ("move" in op) return doMove(op.move, op.to);
  if ("due" in op) return doDue(op.due, op.on);
  if ("remove" in op) return doRemove(op.remove);
  check(false, `no such operation: ${JSON.stringify(op)}`);
};

// --------------------------------------------------------------- the session

heading(`The deployed shell answers, and the planner is read: ${ORIGIN}`);
await openView("/", "list");
await until(`!document.querySelector("[data-planner-unread]")`, "the planner to be read");
check(true, `the list draws ${await count('[data-app="list"] [data-task]')} tasks to begin with`);

if (IN) {
  heading(`In, through the file door: ${IN}`);
  await importFile(IN);
}

if (OPS) {
  const ops = (await Bun.file(OPS).json()) as Op[];
  heading(`${ops.length} operations, each through a control a visitor clicks`);
  for (const op of ops) {
    await run(op);
    console.log(`  ok    ${JSON.stringify(op)}`);
  }
}

if (SELFTEST) {
  heading("Every control, on one task of its own, taken away afterwards");
  const title = `SESSION SELFTEST ${new Date().toISOString()}`;
  const before = await rowsHeld();
  await run({ add: title });
  check(true, "addTask: the list drew it");
  await run({ tags: title, to: ["selftest", "throwaway"] });
  check(true, "setTags: the page says the store holds them");
  await run({ move: title, to: "doing" });
  check(true, "moveTask: the board drew it in doing");
  await openView("/week", "week");
  const days = (await view.evaluate(
    `[...document.querySelectorAll('[data-app="week"] [data-day]')].map((n) => n.getAttribute("data-day"))`,
  )) as string[];
  if (days[0]) {
    await run({ due: title, on: days[0] });
    check(true, `setDue: the week put it on ${days[0]}`);
  } else {
    check(false, "the week drew no days");
  }
  await run({ remove: title });
  const after = await rowsHeld();
  check(
    JSON.stringify(after.map((t) => t.title).sort()) ===
      JSON.stringify(before.map((t) => t.title).sort()),
    `removeTask: the planner is back to ${after.length} tasks`,
  );
}

heading("What the planner holds, read out of IndexedDB");
const rows = await rowsHeld();
const per = (column: string) => rows.filter((t) => t.column === column).length;
console.log(`  tasks  ${rows.length}`);
console.log(`  todo   ${per("todo")}`);
console.log(`  doing  ${per("doing")}`);
console.log(`  done   ${per("done")}`);
console.log(`  dated  ${rows.filter((t) => t.due !== null).length}`);

if (SHOTS) {
  heading(`Shots into ${SHOTS}`);
  await Bun.$`mkdir -p ${SHOTS}`.quiet();
  for (const [path, panel] of [["/", "list"], ["/board", "board"], ["/week", "week"]] as const) {
    await openView(path, panel);
    await Bun.write(`${SHOTS}/session-${panel}.png`, await view.screenshot());
    console.log(`  ok    session-${panel}.png`);
  }
}

if (OUT) {
  heading(`Out, through the export button: ${OUT}`);
  await exportFile(OUT);
}

console.log(
  `\n${failures.length === 0 ? "every reading is as specified" : `${failures.length} FAILED`}`,
);
process.exit(failures.length === 0 ? 0 : 1);
