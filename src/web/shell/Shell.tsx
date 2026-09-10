import { useLayoutEffect, useState } from "preact/hooks";
import type { ShellStore } from "./api.ts";
import { AsyncAppLoader } from "./AsyncAppLoader.tsx";
import { readAppMap, type AppMap } from "./loader.ts";
import { navigate, route } from "./router.ts";
import { DEFAULT_ROUTE, VIEWS } from "./views.ts";
import styles from "./Shell.module.css";

const apps: AppMap = readAppMap();

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

/** The frame's own three fields from the service, §27. */
function Motd({ store }: { store: ShellStore }) {
  const message = store.motd();
  if (message === null) return null;
  return (
    <p
      class={message.level === "warn" ? `${styles.motd} ${styles.motdWarn}` : styles.motd}
      data-motd={message.level}
    >
      {message.text} <span class={styles.motdUntil}>until {message.until}</span>
    </p>
  );
}

export function Shell({ store }: { store: ShellStore }) {
  const view = VIEWS[route.value] ?? VIEWS[DEFAULT_ROUTE]!;
  const who = store.user();
  const compact = store.flags().compact;
  const [boom, setBoom] = useState(false);

  // On the root element rather than in the tree: the palette is CSS custom
  // properties, and the body has to see them too. Set in a layout effect so a
  // page never paints one theme and then the other.
  useLayoutEffect(() => {
    document.documentElement.dataset.dark = String(who.theme.dark);
  }, [who.theme.dark]);

  if (boom) throw new Error("the shell was asked to throw");

  return (
    <div
      class={compact ? `${styles.frame} ${styles.compact}` : styles.frame}
      data-unit-marker={__UNIT_MARKER__}
      data-compact={compact}
    >
      <header class={styles.masthead}>
        <h1 class={styles.title}>pointer-deploy</h1>
        <div class={styles.identity}>
          <label for="who">Name</label>
          <input
            id="who"
            type="text"
            value={who.name}
            onInput={(e: Event) => store.setName((e.currentTarget as HTMLInputElement).value)}
          />
          <label for="colour">Colour</label>
          <input
            id="colour"
            type="color"
            value={who.colour}
            onInput={(e: Event) => store.setColour((e.currentTarget as HTMLInputElement).value)}
          />
          <button type="button" data-throw="shell" onClick={() => setBoom(true)}>
            Throw
          </button>
        </div>
      </header>

      <Motd store={store} />

      <nav class={styles.nav}>
        {Object.entries(VIEWS).map(([path, v]) => (
          <Tab key={path} path={path} label={v.title} />
        ))}
      </nav>

      <p class={styles.footnote} style={{ marginTop: 0, borderTop: "none", paddingTop: 0 }}>
        {view.note}
      </p>

      <div class={styles.pair}>
        {view.apps.map((name) => (
          <AsyncAppLoader key={name} name={name} assets={apps[name]} store={store} />
        ))}
      </div>

      <p class={styles.footnote}>
        The frame owns the name, the colour and every counter, and hands each panel
        the store as a prop. Each panel above is a separate bundle fetched from the
        object store when its view first appears, rendered inside this tree so one
        boundary can catch what it throws.
        {__BUILD_MARKER__ ? (
          <> Build label: <code data-build-marker={__BUILD_MARKER__}>{__BUILD_MARKER__}</code>.</>
        ) : null}
      </p>
    </div>
  );
}
