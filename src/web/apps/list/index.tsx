import { useState } from "preact/hooks";
import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

/**
 * The planner's list, drawn on `/`.
 *
 * It owns no tasks. The store is the shell's, arrives as a prop, and every
 * write goes back through it - so this bundle and the frame stay one page while
 * being built, published and deployed on separate days. The only state here is
 * the text somebody is part-way through typing, which belongs to nobody else.
 *
 * `PLAN.md` step 1 is add, tag and remove: the three members the contract table
 * gives this unit. Renaming and completing are not omissions - a task is
 * complete when `board` moves it to the `done` column, which is step 4.
 */

const tagsFrom = (text: string): string[] =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");

export default function List({ store }: SubAppProps) {
  const tasks = store.tasks();
  const [title, setTitle] = useState("");
  /**
   * What somebody is part-way through typing into a tag input, by task id.
   *
   * The store holds TAGS and the input holds TEXT, and the two are not the same
   * thing while a comma is being typed. Driving the input straight off
   * `task.tags.join(", ")` erased the separator as it was typed: `tagsFrom`
   * drops the empty field after a trailing comma, the signal reassigns, and
   * Preact writes `travel` back over `travel,`. A visitor could never reach a
   * second tag. `page.fill` sets the whole string in one event and never met it,
   * which is why the scenario was green on a control nobody could use.
   *
   * So the draft is this panel's own state, the store is still written on every
   * keystroke, and the text beside the input - rendered from `store.tasks()` -
   * stays the reading of what the frame holds. A task with no draft falls back
   * to the store, which is what a remount and a reload both give.
   */
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [boom, setBoom] = useState(false);

  // §26, and the reading `PLAN.md` step 13 is written for: the tasks this panel
  // draws come out of a snapshot once the service holds one, so a retirement of
  // that field is a fact about THIS panel and is said here as well as on
  // `/service`. The service holds no snapshots until step 6, so this is null
  // today and nothing is drawn for it. What holds the call meanwhile is
  // `bun run e2e:members`, which drops the member and reads the refusal.
  const going = store.goingAway("snapshot.tasks");

  if (boom) throw new Error("list was asked to throw");

  const add = (e: Event) => {
    e.preventDefault();
    store.addTask(title);
    setTitle("");
  };

  return (
    <section class={styles.panel} data-unit-marker={__UNIT_MARKER__}>
      <form class={styles.add} onSubmit={add}>
        <input
          class={styles.input}
          type="text"
          placeholder="What needs doing?"
          aria-label="Task"
          data-new-task
          value={title}
          onInput={(e: Event) => setTitle((e.currentTarget as HTMLInputElement).value)}
        />
        <button type="submit" class={styles.button} data-add-task>
          Add
        </button>
      </form>

      {tasks.length === 0 ? (
        <p class={styles.empty} data-empty>
          No tasks yet.
        </p>
      ) : (
        <ul class={styles.tasks} data-tasks>
          {tasks.map((task) => (
            <li key={task.id} class={styles.task} data-task={task.title}>
              <span class={styles.title} data-task-title>
                {task.title}
              </span>
              {/* The tags twice, and both are load-bearing: the input is how a
                  visitor writes them, and the text beside it is what the page
                  SAYS the store holds. An input alone would show the keystrokes
                  back whether or not the write ever reached the frame. */}
              <input
                class={styles.tagInput}
                type="text"
                placeholder="tags"
                aria-label={`Tags for ${task.title}`}
                data-tag-input={task.title}
                value={drafts[task.id] ?? task.tags.join(", ")}
                onInput={(e: Event) => {
                  const text = (e.currentTarget as HTMLInputElement).value;
                  setDrafts((d) => ({ ...d, [task.id]: text }));
                  store.setTags(task.id, tagsFrom(text));
                }}
              />
              <span class={styles.tags} data-tags={task.title}>
                {task.tags.join(", ")}
              </span>
              <button
                type="button"
                class={styles.button}
                data-remove-task={task.title}
                onClick={() => store.removeTask(task.id)}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}

      {/* Said on the page, in these words, because it is a limit a visitor has
          to know about rather than discover. PLAN.md step 2 is what changes it,
          and a scenario in keeping-a-list-of-tasks.feature reads this line. */}
      <p class={styles.note} data-memory-note>
        These tasks are kept in this page alone. A reload starts again with none.
      </p>

      {going ? (
        <p class={styles.going} data-going="snapshot.tasks">
          The service retires <code>snapshot.tasks</code> on {going.sunset}
          {going.instead ? ` in favour of ${going.instead}` : ", with nothing named to replace it"}.
        </p>
      ) : null}

      {/* The only way to reach this panel's own error boundary from a browser.
          It is what `recovering-from-an-error.feature` drives. */}
      <button type="button" class={styles.throw} data-throw="list" onClick={() => setBoom(true)}>
        Throw
      </button>
    </section>
  );
}
