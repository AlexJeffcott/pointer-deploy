import { Component, render, type ComponentChildren } from "preact";
import "../theme.css";
import { createStore } from "./api.ts";
import { createClient, hydrate, readApiBase, serviceBacked } from "./service.ts";
import { Shell } from "./Shell.tsx";

/**
 * The last boundary on the page.
 *
 * A sub-app's throw is caught by its own AsyncAppLoader and costs one panel.
 * This one catches the FRAME, and the frame has no smaller reload than the
 * document: the code that would draw a recovery control is the code that threw.
 * So the control says reload the page, which is the truth.
 */
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

// One store, made here and handed down. Nothing imports it: a sub-app receives
// it as a prop, and a test makes its own with createStore().
//
// §13. Where a service is configured, the store is wrapped so every write is
// sent on, and its values are filled in from the service AFTER the first paint.
// Nothing here is awaited before rendering: the page must appear at the same
// moment whether the service is fast, slow, or not there at all.
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
  // Hydrated through the PLAIN store. Through the wrapper, every value the
  // service just sent would be posted straight back to it.
  void hydrate(store, client).then(reportApi);
}

/**
 * What the page says about the service, for a person and for a scenario.
 *
 * On the root element rather than in the frame's markup: the service is not
 * what this page is about, and a reading nobody has to look at is better than
 * a control that moves the layout when a fourth deploy is having a bad day.
 */
function reportApi(state: string): void {
  document.documentElement.dataset.api = state;
}
