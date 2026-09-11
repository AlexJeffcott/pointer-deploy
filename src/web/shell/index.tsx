import { Component, render, type ComponentChildren } from "preact";
import { effect } from "@preact/signals";
import "../theme.css";
import { createStore, type ShellStore } from "./api.ts";
import { openPlanner, SCHEMA_VERSION } from "./planner.ts";
import {
  awaiting,
  createClient,
  noteSunset,
  readApiBase,
  readData,
  readService,
} from "./service.ts";
import { Shell } from "./Shell.tsx";

class ShellBoundary extends Component<
  { children?: ComponentChildren },
  { error: string | null }
> {
  state = { error: null as string | null };

  componentDidCatch(error: unknown): void {
    this.setState({ error: error instanceof Error ? error.message : String(error) });
  }

  render() {
    if (this.state.error === null) return <>{this.props.children}</>;
    return (
      <p data-shell-error>
        The frame failed: {this.state.error}{" "}
        <button type="button" data-shell-reload onClick={() => location.reload()}>
          Reload the page
        </button>
      </p>
    );
  }
}

const root = document.getElementById("app");
if (!root) throw new Error("#app is missing from the shell");

const store = createStore();
const base = readApiBase();
const client = base ? createClient(base) : null;

// Before the render, not after it. The first paint then says which service is
// being read and that it has not answered yet, which is a different panel from
// one drawn with no service at all.
if (client) store.setService(awaiting(base));

render(
  <ShellBoundary>
    <Shell store={store} />
  </ShellBoundary>,
  root,
);

// The planner is read after the first paint, like the service and for the same
// reason: opening IndexedDB is asynchronous and a page that waited for it would
// show nothing at all while it opened. What the panel must not do is claim the
// planner is EMPTY before the read lands, which is why `PlannerReport.state`
// starts at "unread" and the panel draws neither list nor empty message until
// it moves.
void startPlanner(store);

if (client) {
  // Two reads, started together and settled apart. The document says what the
  // service holds; the data call says whether the version this shell calls
  // answers, and carries the `Sunset` header a document cannot. Neither waits
  // for the other, and a page whose document read fails still draws its tasks:
  // the planner is in this browser and the service holds none of it.
  void readService(store, client);
  void readData(client).then((state) => {
    noteSunset(store, client);
    reportApi(state);
  });
}

function reportApi(state: string): void {
  document.documentElement.dataset.api = state;
}

const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/**
 * Opens the planner, fills the store from it, and writes it back on every
 * change. `PLAN.md` step 2.
 *
 * A browser that refuses IndexedDB is not a failure to report to the visitor as
 * an error: the planner degrades to what step 1 had, the tasks live in this
 * page, and the panel says which of the two it is. So every path here ends in a
 * report and none of them throws.
 */
async function startPlanner(store: ShellStore): Promise<void> {
  const unstored = (e: unknown): void =>
    store.setPlanner({
      state: "unstored",
      schemaVersion: null,
      error: why(e),
      readAt: new Date().toISOString(),
    });

  let planner: Awaited<ReturnType<typeof openPlanner>>;
  try {
    planner = await openPlanner();
  } catch (e) {
    unstored(e);
    return;
  }

  try {
    store.loadTasks(await planner.read());
  } catch (e) {
    planner.close();
    unstored(e);
    return;
  }

  store.setPlanner({
    state: "stored",
    schemaVersion: SCHEMA_VERSION,
    error: null,
    readAt: new Date().toISOString(),
  });

  // Started AFTER the read, and it skips its own first run. An effect created
  // before the read would write the empty list it was created with over what is
  // stored, which is the one way this feature can lose a visitor's tasks.
  let loaded = false;
  effect(() => {
    const tasks = store.tasks();
    if (!loaded) {
      loaded = true;
      return;
    }
    void planner.write(tasks).catch((e) => unstored(e));
  });
}

// What the page is drawn from, said on the document so that a scenario can read
// it without reaching into a bundle. `data-api` is the same thing for the
// service.
effect(() => {
  document.documentElement.dataset.planner = store.planner().state;
});
