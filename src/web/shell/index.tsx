import { Component, render, type ComponentChildren } from "preact";
import "../theme.css";
import { createStore } from "./api.ts";
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
