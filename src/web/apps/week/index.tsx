import type { SubAppProps } from "@pointer/subapp";
import type { Task } from "@pointer/shell";
import styles from "./app.module.css";

/**
 * The planner's week, drawn on `/week`.
 *
 * The fourth unit, `PLAN.md` step 5, and the SECOND placed off the landing
 * route - so the page now warms two bundles rather than one, and step 4's
 * reading of what a warm buys has a second subject.
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

const DAY_MS = 86_400_000;

/**
 * The names of the days and months, written out rather than formatted.
 *
 * `toLocaleDateString` reads the browser's locale, so two visitors would see
 * two different pages and two screenshots of one composition would differ for
 * a reason the deploy record cannot name. The set is fixed here instead.
 */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const iso = (at: number): string => new Date(at).toISOString().slice(0, 10);

/**
 * The seven days of the week `now` falls in, Monday first.
 *
 * Monday to Sunday and not "the next seven days": a week is a window two
 * people can agree on, and a rolling window means a task drawn today is on a
 * different panel tomorrow for no reason a person did anything about.
 *
 * The visitor's own midnight, read through the local getters and then held as
 * UTC. `new Date().toISOString()` alone would put a visitor east of Greenwich
 * on tomorrow's panel for part of every evening.
 *
 * This is the whole of what this unit knows about a week, and it is NOT on the
 * contract surface. The columns are, because `board` draws one panel per
 * column and a task moves between them, so two units have to agree on the set.
 * Nothing has to agree with this one: a date is a date, and `setDue` takes it.
 */
function weekOf(now: Date): string[] {
  const midnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const weekday = (new Date(midnight).getUTCDay() + 6) % 7;
  const monday = midnight - weekday * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => iso(monday + i * DAY_MS));
}

/** `2026-09-14` at index 0 reads `Mon 14 Sep`. The index IS the weekday. */
const label = (day: string, index: number): string =>
  `${WEEKDAYS[index]} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;

/**
 * The one control on this page, and the only caller of `setDue`.
 *
 * A select rather than seven buttons: the board draws one button per OTHER
 * column and there are two of those, and seven on every card is a panel nobody
 * can read. The options ARE the reachable values, which is the argument that
 * lets `setDue` refuse a bad date silently - nothing here can produce one.
 *
 * A task whose date is not in this week gets its own date at the top, because
 * a select whose value matches no option draws the first one and would tell a
 * visitor the task had no date.
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
      {outside ? <option value={held}>{held}</option> : null}
      {days.map((day, index) => (
        <option key={day} value={day}>
          {label(day, index)}
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
    <section class={styles.panel} data-unit-marker={__UNIT_MARKER__} data-week-total={tasks.length}>
      <div class={styles.days}>
        {days.map((day, index) => {
          // The tasks due on this day, in the order the store holds them. This
          // panel keeps no order of its own, for the reason the board keeps
          // none: the list, the board and the week are three views of one
          // collection, so a task given a date has not moved place in it.
          const due = tasks.filter((task) => task.due === day);
          return (
            <div key={day} class={styles.day} data-day={day}>
              <h3 class={styles.dayTitle}>
                {label(day, index)}{" "}
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
