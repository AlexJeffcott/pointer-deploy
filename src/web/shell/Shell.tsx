import { useEffect, useRef, useState } from "preact/hooks";
import { buildMarker, navigate, route, setColour, setName, user } from "./api.ts";
import { loadApp, readAppMap, type AppMap } from "./loader.ts";
import { chooseVersion, readVersions, type VersionOption } from "./versions.ts";
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
const versions = readVersions();

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

  // Named, because a refusal is a state a visitor and a scenario both have to
  // be able to see. A browser that rejects a bundle whose digest does not match
  // reports it here and nowhere else.
  if (error) return <p class={styles.slotError} data-app-error={name}>{error}</p>;
  return <div ref={host} class={styles.slot} data-app={name} />;
}

/** How one option reads. The id is the identity; the marker is for a person. */
function optionLabel(o: VersionOption): string {
  const name = o.marker ? `${o.unitId} (${o.marker})` : o.unitId;
  if (o.disabled) return `${name} - no shared contract`;
  return o.deployed ? `${name} - deployed` : name;
}

/**
 * One unit's choices.
 *
 * An id that cannot be composed with the rest is DISABLED and not hidden.
 * Hiding it would say the build was never deployed to this channel, which is
 * false and is the opposite of what an operator is looking for: the reason a
 * rollback is refused is exactly what they came to find out.
 */
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

/**
 * The switcher, or nothing.
 *
 * Nothing is the ordinary case. The server sends no options unless the channel
 * is named in VERSION_SWITCHER_CHANNELS, so a visitor to a channel without one
 * sees exactly the page they saw before this existed.
 */
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

export function Shell() {
  const view = VIEWS[route.value] ?? VIEWS["/"]!;

  return (
    // The shell is a unit like any other, so its marker has to reach the DOM
    // too. Without this BUILD_MARKER_SHELL changes nothing the shell emits,
    // its unit id does not move, and "deploy the shell alone" cannot be
    // observed by anything.
    <div class={styles.frame} data-unit-marker={__UNIT_MARKER__}>
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

      <Versions />

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
        {buildMarker ? <> Build label: <code data-build-marker={buildMarker}>{buildMarker}</code>.</> : null}
      </p>
    </div>
  );
}
