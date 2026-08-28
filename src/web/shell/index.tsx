import { Component, render, type ComponentChildren } from "preact";
import "../theme.css";
import { createStore } from "./api.ts";
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
render(
  <ShellBoundary>
    <Shell store={createStore()} />
  </ShellBoundary>,
  root,
);
