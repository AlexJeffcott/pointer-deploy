import { Component, render, type ComponentChildren } from "preact";
import "../theme.css";
import { createStore } from "./api.ts";
import { createClient, hydrate, readApiBase, serviceBacked } from "./service.ts";
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

render(
  <ShellBoundary>
    <Shell store={client ? serviceBacked(store, client, reportApi) : store} />
  </ShellBoundary>,
  root,
);

if (client) {
  void hydrate(store, client).then(reportApi);
}

function reportApi(state: string): void {
  document.documentElement.dataset.api = state;
}
