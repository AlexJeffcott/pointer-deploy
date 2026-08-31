import { Component, type ComponentChildren } from "preact";
import { useContext, useEffect, useState } from "preact/hooks";
import type { ShellStore } from "./api.ts";
import { StoreContext } from "./context.ts";
import { forget, loadApp, type AppAssets, type SubApp } from "./loader.ts";
import styles from "./Shell.module.css";

type Props = {
  name: string;
  assets: AppAssets | undefined;
  store?: ShellStore;
};

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
