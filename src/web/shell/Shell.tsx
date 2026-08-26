import { useEffect, useRef, useState } from "preact/hooks";
import { navigate, route, setColour, setName, user } from "./api.ts";
import { loadApp, readAppMap, type AppMap } from "./loader.ts";
import styles from "./Shell.module.css";

const VIEWS: Record<string, { title: string; apps: string[]; note: string }> = {
  "/": {
    title: "Counters",
    apps: ["alpha", "bravo"],
    note: "Two sub-apps, each its own bundle. Both write to the shell's store.",
  },
  "/totals": {
    title: "Totals",
    apps: ["charlie", "delta"],
    note: "Two more bundles. Neither created a counter on this page, and both read the ones that did.",
  },
};

const apps: AppMap = readAppMap();

/** Hosts one sub-app. The shell renders no children into this node. */
function Slot({ name }: { name: string }) {
  const host = useRef<HTMLDivElement>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const assets = apps[name];
    if (!assets) {
      setError(`The manifest names no bundle for "${name}".`);
      return;
    }

    let unmount: (() => void) | undefined;
    let cancelled = false;

    loadApp(name, assets)
      .then((app) => {
        if (cancelled || !host.current) return;
        unmount = app.mount(host.current);
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : String(e)));

    return () => {
      cancelled = true;
      unmount?.();
    };
  }, [name]);

  if (error) return <p class={styles.slotError}>{error}</p>;
  return <div ref={host} class={styles.slot} data-app={name} />;
}

function Tab({ path, label }: { path: string; label: string }) {
  const current = route.value === path;
  return (
    <a
      href={path}
      class={current ? `${styles.tab} ${styles.tabCurrent}` : styles.tab}
      aria-current={current ? "page" : undefined}
      onClick={(e: MouseEvent) => {
        if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
        e.preventDefault();
        navigate(path);
      }}
    >
      {label}
    </a>
  );
}

export function Shell() {
  const view = VIEWS[route.value] ?? VIEWS["/"]!;

  return (
    <div class={styles.frame}>
      <header class={styles.masthead}>
        <h1 class={styles.title}>pointer-deploy</h1>
        <div class={styles.identity}>
          <label for="who">Name</label>
          <input
            id="who"
            type="text"
            value={user.value.name}
            onInput={(e: Event) => setName((e.currentTarget as HTMLInputElement).value)}
          />
          <label for="colour">Colour</label>
          <input
            id="colour"
            type="color"
            value={user.value.colour}
            onInput={(e: Event) => setColour((e.currentTarget as HTMLInputElement).value)}
          />
        </div>
      </header>

      <nav class={styles.nav}>
        <Tab path="/" label="Counters" />
        <Tab path="/totals" label="Totals" />
      </nav>

      <p class={styles.footnote} style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
        {view.note}
      </p>

      <div class={styles.pair}>
        {view.apps.map((name) => (
          <Slot key={name} name={name} />
        ))}
      </div>

      <p class={styles.footnote}>
        The frame owns the name, the colour and every counter. Each panel above is
        a separate bundle fetched from the object store when its view first
        appears, sharing one Preact instance through the import map.
      </p>
    </div>
  );
}
