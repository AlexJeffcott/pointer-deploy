import type { SubAppProps } from "@pointer/subapp";
import styles from "./app.module.css";

/**
 * The planner's board, drawn on `/board`.
 *
 * The third unit, `PLAN.md` step 4, and the first one placed on a route a
 * visitor does not land on. So it is the first bundle the page WARMS: the shell
 * emits a modulepreload and a style preload for it on every load, and the
 * import at navigation reads the warmed response rather than fetching a second
 * time. `measuring-what-the-page-warms.feature` is where that is measured.
 *
 * It owns no tasks and no columns. Both come off the store the shell created,
 * which is what makes this and `list` two published bundles over one collection
 * rather than two planners: a task added on `/` is on this board, and a task
 * moved here is the same task the list draws.
 *
 * `columns()` and `moveTask()` are this unit's own members - nothing else on
 * the slate calls either - which is the design constraint `PLAN.md`'s contract
 * table states and what step 10 drops `moveTask` to demonstrate.
 */
export default function Board({ store }: SubAppProps) {
  const columns = store.columns();
  const tasks = store.tasks();
  /**
   * The frame's reading of where the planner is kept, `PLAN.md` step 2.
   *
   * Read for one thing here: nothing about the board is drawn until the state
   * leaves "unread". A board that drew three empty columns on the first paint
   * would tell a visitor with a full planner that there was nothing on it, and
   * this panel is fetched LATER than `list` - the shell warms it and the import
   * runs on the navigation - so the window is not the same one TODO §41
   * measures for `list`.
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

  return (
    <section class={styles.panel} data-unit-marker={__UNIT_MARKER__}>
      <div class={styles.columns}>
        {columns.map((column) => {
          // Every task whose column is this one, in the order the store holds
          // them. The board draws no order of its own: the list and the board
          // are two views of one collection, so a task that moved column has
          // not moved place in the planner.
          const held = tasks.filter((task) => task.column === column.id);
          return (
            <div key={column.id} class={styles.column} data-column={column.id}>
              <h3 class={styles.columnTitle}>
                {column.label} <span class={styles.count} data-column-count={column.id}>{held.length}</span>
              </h3>

              {held.length === 0 ? (
                /* `data-empty` as well as the column's own marker: the
                   harness watches for that attribute to record what the
                   planner's state was every time the page said it was empty,
                   and this panel's empty message is one of those. */
                <p class={styles.empty} data-empty data-column-empty={column.id}>
                  Nothing here.
                </p>
              ) : (
                <ul class={styles.cards}>
                  {held.map((task) => (
                    <li key={task.id} class={styles.card} data-card={task.title} data-in={column.id}>
                      <span class={styles.cardTitle}>{task.title}</span>
                      {/* One button per OTHER column, drawn from `columns()`.
                          A control that let a visitor name a column would be a
                          way to reach the refusal in `moveTask`, and the whole
                          reason that refusal is silent is that no control can:
                          the buttons are the columns. */}
                      <span class={styles.moves}>
                        {columns
                          .filter((to) => to.id !== column.id)
                          .map((to) => (
                            <button
                              key={to.id}
                              type="button"
                              class={styles.button}
                              data-move={task.title}
                              data-to={to.id}
                              onClick={() => store.moveTask(task.id, to.id)}
                            >
                              {to.label}
                            </button>
                          ))}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          );
        })}
      </div>

      <p class={styles.note} data-board-note>
        A task is done when it is in the last column. There is no done flag, so this board and the
        list cannot disagree about what done means.
      </p>
    </section>
  );
}
