import type { SubAppProps } from "@pointer/subapp";
import type { Task } from "@pointer/shell";
import styles from "./app.module.css";
import { label, weekOf } from "./week.ts";

/**
 * The planner's week, drawn on `/week`.
 *
 * The fourth unit, `PLAN.md` step 5, and the SECOND placed off the landing
 * route - so four of the six files the page warms are now for a view a visitor
 * may never open, and step 4's reading of what a warm buys has a second
 * subject. The page warms `list` as well, and always did; that pair buys
 * nothing, because the landing route imports it anyway.
 *
 * It owns no tasks. `tasks()` is the shell's collection and `setDue` is this
 * unit's own member - nothing else on the slate calls it, which is the design
 * constraint `PLAN.md`'s contract table states and what step 10 demonstrates
 * by dropping one such member and refusing one unit.
 *
 * What it adds to step 4's claim is the third bundle: `list`, `board` and
 * `week` are three separately published files over ONE store and ONE signals
 * runtime, resolved through the import map the shell writes. A task added on
 * `/` is given a date here, and the list draws the same task.
 */

/**
 * The one control on this page, and the only caller of `setDue`.
 *
 * A select rather than seven buttons: the board draws one button per OTHER
 * column and there are two of those, and seven on every card is a panel nobody
 * can read.
 *
 * A task whose date is not in this week gets its own date at the top, because a
 * select whose value matches no option draws the first one and would tell a
 * visitor the task had no date. **That option is `disabled`**, and a cold read
 * on 2026-09-13 is why. Without it the option set held a value that is not
 * necessarily a date - `"yesterday"` is exactly what reaches this branch - and
 * the sentence "the options are the reachable values" was false in the file
 * that stated it. What kept a bad value from being written back was that a
 * select fires no `change` for the option already chosen, which is a DOM event
 * rule nothing here records and nothing tests. Disabled, the claim is a
 * property of the markup again: every option a visitor can CHOOSE is one of
 * the seven days or the empty value.
 */
function DuePicker({
  task,
  days,
  onPick,
}: {
  task: Task;
  days: readonly string[];
  onPick: (due: string | null) => void;
}) {
  const held = task.due;
  const outside = held !== null && !days.includes(held);
  return (
    <select
      class={styles.picker}
      aria-label={`Due date for ${task.title}`}
      data-due={task.title}
      value={held ?? ""}
      onChange={(e) => {
        const picked = (e.currentTarget as HTMLSelectElement).value;
        onPick(picked === "" ? null : picked);
      }}
    >
      <option value="">No date</option>
      {outside ? (
        <option value={held} disabled>
          {held}
        </option>
      ) : null}
      {days.map((day) => (
        <option key={day} value={day}>
          {label(day)}
        </option>
      ))}
    </select>
  );
}

export default function Week({ store }: SubAppProps) {
  const tasks = store.tasks();
  /**
   * The frame's reading of where the planner is kept, `PLAN.md` step 2.
   *
   * Read for one thing, the same as `board`: nothing is drawn until the state
   * leaves "unread". Seven empty days drawn before the read landed would tell
   * a visitor with a full planner that nothing was due.
   */
  const planner = store.planner();

  if (planner.state === "unread") {
    return (
      <section class={styles.panel} data-unit-marker={__UNIT_MARKER__}>
        <p class={styles.empty} data-planner-unread>
          Reading the planner…
        </p>
      </section>
    );
  }

  const days = weekOf(new Date());

  /**
   * Every task the seven panels do not draw, in two groups.
   *
   * The board reports what it cannot place in one line, because a task in a
   * column no column names is a fault. Here it is two facts and only one of
   * them is: a task due next month is in `elsewhere` and nothing is wrong with
   * it, and a task carrying `"yesterday"` is in `elsewhere` too and something
   * is. This page does not tell them apart - it prints the value each task
   * actually carries, so a value that is not a date is legible as itself. The
   * two doors that WRITE one refuse it: `setDue` silently, because the control
   * above is the set, and `readDocument` by name. IndexedDB is the third and
   * guards nothing, TODO §46.
   */
  const undated = tasks.filter((task) => task.due === null);
  const elsewhere = tasks.filter((task) => task.due !== null && !days.includes(task.due));

  return (
    <section class={styles.panel} data-unit-marker={__UNIT_MARKER__}>
      <div class={styles.days}>
        {days.map((day) => {
          // The tasks due on this day, in the order the store holds them. This
          // panel keeps no order of its own, for the reason the board keeps
          // none: the list, the board and the week are three views of one
          // collection, so a task given a date has not moved place in it.
          const due = tasks.filter((task) => task.due === day);
          return (
            <div key={day} class={styles.day} data-day={day}>
              <h3 class={styles.dayTitle}>
                {label(day)}{" "}
                <span class={styles.count} data-day-count={day}>
                  {due.length}
                </span>
              </h3>

              {due.length === 0 ? (
                /* `data-empty` as well as this day's own marker: the harness
                   watches for that attribute to record what the planner's
                   state was every time the page said it was empty. */
                <p class={styles.empty} data-empty data-day-empty={day}>
                  Nothing due.
                </p>
              ) : (
                <ul class={styles.cards}>
                  {due.map((task) => (
                    <li key={task.id} class={styles.card} data-card={task.title} data-on={day}>
                      <span class={styles.cardTitle}>{task.title}</span>
                      <DuePicker
                        task={task}
                        days={days}
                        onPick={(picked) => store.setDue(task.id, picked)}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <div class={styles.loose}>
        <div class={styles.group} data-group="undated">
          <h3 class={styles.groupTitle}>
            No date{" "}
            <span class={styles.count} data-undated-count>
              {undated.length}
            </span>
          </h3>
          {undated.length === 0 ? (
            <p class={styles.empty} data-empty data-undated-empty>
              Every task has a date.
            </p>
          ) : (
            <ul class={styles.cards}>
              {undated.map((task) => (
                <li key={task.id} class={styles.card} data-card={task.title} data-on="">
                  <span class={styles.cardTitle}>{task.title}</span>
                  <DuePicker
                    task={task}
                    days={days}
                    onPick={(picked) => store.setDue(task.id, picked)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        <div class={styles.group} data-group="elsewhere">
          <h3 class={styles.groupTitle}>
            Another date{" "}
            <span class={styles.count} data-elsewhere-count>
              {elsewhere.length}
            </span>
          </h3>
          {elsewhere.length === 0 ? (
            <p class={styles.empty} data-empty data-elsewhere-empty>
              Nothing is dated outside this week.
            </p>
          ) : (
            <ul class={styles.cards}>
              {elsewhere.map((task) => (
                <li key={task.id} class={styles.card} data-card={task.title} data-on={task.due}>
                  <span class={styles.cardTitle}>{task.title}</span>
                  {/* The value the task carries, printed as it is. A date
                      outside this week reads as a date; a value that is not a
                      date reads as itself, which is the only thing this panel
                      can honestly say about one. */}
                  <span class={styles.held} data-elsewhere-due={task.title}>
                    {task.due}
                  </span>
                  <DuePicker
                    task={task}
                    days={days}
                    onPick={(picked) => store.setDue(task.id, picked)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <p class={styles.note} data-week-note>
        Every task the planner holds is on this page once: on a day, under No date, or under
        Another date. A week runs Monday to Sunday, so what is drawn here changes with the date
        and not with anything a visitor did.
      </p>
    </section>
  );
}
