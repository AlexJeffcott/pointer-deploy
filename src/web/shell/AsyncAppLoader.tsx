// Fetches one sub-app and renders it INSIDE the shell's tree.
//
// This replaced a `Slot` that called `render()` into a host node. That older
// shape gave each sub-app its own Preact root, and a separate root has two
// consequences that were measured rather than argued (TODO §7):
//
//   - the shell's error boundary could not catch anything the sub-app threw on
//     a later render. The error reached window.onerror instead;
//   - a Provider in the shell reached nothing inside the sub-app, because
//     Preact context travels down the vnode tree.
//
// One tree removes both. It also means a sub-app is placed by composition:
// this component goes wherever a sub-app should appear.

import { Component, type ComponentChildren } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { ShellStore } from "./api.ts";
import { StoreContext } from "./context.ts";
import { forget, loadApp, type AppAssets, type SubApp } from "./loader.ts";
import styles from "./Shell.module.css";

type Props = {
  name: string;
  assets: AppAssets | undefined;
  /**
   * Used ONLY when nothing above has provided one.
   *
   * The rule is that the outermost loader provides and an inner one inherits.
   * Without it, a sub-app loaded inside another sub-app would read "a store is
   * already there" and silently take that one - which is the wrong store, and
   * nothing would report it.
   */
  store?: ShellStore;
};

/**
 * What a caught error offers.
 *
 * "Mount again" and not "reload": the module is already evaluated and a browser
 * will not evaluate a module URL twice, so nothing is re-fetched. `forget` is
 * still called, because an import that REJECTED left no module at all and that
 * one really can be retried.
 */
class Boundary extends Component<
  { name: string; children?: ComponentChildren },
  { error: string | null; attempt: number }
> {
  state = { error: null as string | null, attempt: 0 };

  componentDidCatch(error: unknown): void {
    this.setState({ error: error instanceof Error ? error.message : String(error) });
  }

  private again = (): void => {
    forget(this.props.name);
    this.setState({ error: null, attempt: this.state.attempt + 1 });
  };

  render() {
    if (this.state.error === null) {
      // The key remounts the whole subtree, so a sub-app that threw is built
      // from scratch rather than resumed from the state that threw.
      return <div key={this.state.attempt}>{this.props.children}</div>;
    }
    return (
      <p class={styles.slotError} data-app-error={this.props.name}>
        {this.state.error}{" "}
        <button type="button" data-app-retry={this.props.name} onClick={this.again}>
          Mount again
        </button>
      </p>
    );
  }
}

/** The import, and what is shown while it is in flight. */
function Panel({ name, assets }: { name: string; assets: AppAssets | undefined }) {
  const store = useContext(StoreContext);
  const [app, setApp] = useState<SubApp | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!assets) {
      setError(`The manifest names no bundle for "${name}".`);
      return;
    }
    let cancelled = false;
    loadApp(name, assets)
      .then((loaded) => {
        if (!cancelled) setApp(() => loaded);
      })
      .catch((e: unknown) => {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      });
    return () => {
      cancelled = true;
    };
  }, [name, assets]);

  // Named, because a refusal is a state a visitor and a scenario both have to
  // be able to see. A browser that rejects a bundle whose digest does not match
  // reports it here and nowhere else.
  if (error) return <p class={styles.slotError} data-app-error={name}>{error}</p>;
  if (!store) {
    return <p class={styles.slotError} data-app-error={name}>No store was provided.</p>;
  }
  if (!app) return <div class={styles.slot} data-app-loading={name} />;

  const App = app;
  return (
    <div class={styles.slot} data-app={name}>
      <App store={store} />
    </div>
  );
}

export function AsyncAppLoader({ name, assets, store }: Props) {
  const inherited = useContext(StoreContext);
  const body = (
    <Boundary name={name}>
      <Panel name={name} assets={assets} />
    </Boundary>
  );
  if (inherited) return body;
  if (!store) {
    return <p class={styles.slotError} data-app-error={name}>No store was provided.</p>;
  }
  return <StoreContext.Provider value={store}>{body}</StoreContext.Provider>;
}
