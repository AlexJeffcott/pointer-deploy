import { useState } from "preact/hooks";
import type { ShellStore } from "./api.ts";
import { AsyncAppLoader } from "./AsyncAppLoader.tsx";
import { readAppMap, type AppMap } from "./loader.ts";
import { navigate, route } from "./router.ts";
import { chooseVersion, readVersions, type VersionOption } from "./versions.ts";
import { DEFAULT_ROUTE, VIEWS } from "./views.ts";
import styles from "./Shell.module.css";

const apps: AppMap = readAppMap();
const versions = readVersions();

function optionLabel(o: VersionOption): string {
  const name = o.marker ? `${o.unitId} (${o.marker})` : o.unitId;
  if (o.disabled) return `${name} - no shared contract`;
  return o.live ? `${name} - live` : name;
}

function UnitVersions({ unit, options }: { unit: string; options: VersionOption[] }) {
  const id = `version-${unit}`;
  return (
    <span class={styles.version}>
      <label for={id}>{unit}</label>
      <select
        id={id}
        data-version-select={unit}
        value={options.find((o) => o.current)?.unitId}
        onChange={(e: Event) => {
          const wanted = (e.currentTarget as HTMLSelectElement).value;
          const option = options.find((o) => o.unitId === wanted);
          if (option) chooseVersion(unit, option);
        }}
      >
        {options.map((o) => (
          <option key={o.unitId} value={o.unitId} disabled={o.disabled && !o.current}>
            {optionLabel(o)}
          </option>
        ))}
      </select>
    </span>
  );
}

function Versions() {
  const units = Object.keys(versions);
  if (units.length === 0) return null;
  return (
    <div class={styles.versions} data-versions>
      <span class={styles.versionsLabel}>Serving</span>
      {units.map((unit) => (
        <UnitVersions key={unit} unit={unit} options={versions[unit]!} />
      ))}
    </div>
  );
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

export function Shell({ store }: { store: ShellStore }) {
  const view = VIEWS[route.value] ?? VIEWS[DEFAULT_ROUTE]!;
  const who = store.user();
  const [boom, setBoom] = useState(false);
  if (boom) throw new Error("the shell was asked to throw");

  return (
    <div class={styles.frame} data-unit-marker={__UNIT_MARKER__}>
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

      <nav class={styles.nav}>
        {Object.entries(VIEWS).map(([path, v]) => (
          <Tab key={path} path={path} label={v.title} />
        ))}
      </nav>

      <Versions />

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
