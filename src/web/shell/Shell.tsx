import { useState } from "preact/hooks";
import type { ShellStore } from "./api.ts";
import { AsyncAppLoader } from "./AsyncAppLoader.tsx";
import { readAppMap, type AppMap } from "./loader.ts";
import { navigate, route } from "./router.ts";
import { DEFAULT_ROUTE, VIEWS } from "./views.ts";
import styles from "./Shell.module.css";

const apps: AppMap = readAppMap();

function NavItem({ path, label }: { path: string; label: string }) {
  const current = route.value === path;
  return (
    <a
      href={path}
      class={current ? `${styles.navItem} ${styles.navItemCurrent}` : styles.navItem}
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

/**
 * What the shell knows about the service, drawn by the shell, §26.
 *
 * No unit is fetched for this view. The shell read the discovery document once
 * and this reads the store, so the reading on screen is the one every panel
 * acts on rather than a second call that could disagree with it.
 */
function ServiceView({ store }: { store: ShellStore }) {
  const report = store.service();
  return (
    <div class={styles.report} data-service={report.state}>
      <dl class={styles.pairs}>
        <dt>State</dt>
        <dd data-service-state>{report.state}</dd>
        <dt>Base</dt>
        <dd>{report.base || "none named"}</dd>
        <dt>Calling</dt>
        <dd>{report.calling || "nothing"}</dd>
        <dt>Serves</dt>
        <dd data-service-serves>{report.serves.join(", ") || "unknown"}</dd>
        <dt>Read at</dt>
        <dd>{report.readAt ?? "never"}</dd>
        {/* What one response said, kept apart from what the document says. A
            proxy or a different deploy can make the two disagree. */}
        <dt>Sunset header</dt>
        <dd data-header-sunset={report.headerSunset ?? undefined}>
          {report.headerSunset ?? "none"}
        </dd>
        {report.error ? (
          <>
            <dt>Error</dt>
            <dd data-service-error>{report.error}</dd>
          </>
        ) : null}
      </dl>

      <table class={styles.fields}>
        <thead>
          <tr>
            <th>Field</th>
            <th>Type</th>
            <th>Going away</th>
          </tr>
        </thead>
        <tbody>
          {report.fields.length === 0 ? (
            <tr>
              <td colSpan={3} class={styles.muted}>
                The service publishes no fields to this shell.
              </td>
            </tr>
          ) : (
            report.fields.map((f) => (
              <tr key={f.path} data-field={f.path}>
                <td>
                  <code>{f.path}</code>
                </td>
                <td class={styles.muted}>{f.type}</td>
                <td data-going={f.going ? f.path : undefined}>
                  {f.going
                    ? `${f.going.sunset} — ${f.going.reason}` +
                      (f.going.instead ? ` Use ${f.going.instead}.` : " Nothing replaces it.")
                    : ""}
                </td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

export function Shell({ store }: { store: ShellStore }) {
  const path = VIEWS[route.value] ? route.value : DEFAULT_ROUTE;
  const view = VIEWS[path]!;
  const [boom, setBoom] = useState(false);

  if (boom) throw new Error("the shell was asked to throw");

  return (
    <div class={styles.frame} data-unit-marker={__UNIT_MARKER__}>
      <nav class={styles.sidenav}>
        <h1 class={styles.title}>pointer-deploy</h1>
        <div class={styles.navItems}>
          {Object.entries(VIEWS).map(([to, v]) => (
            <NavItem key={to} path={to} label={v.title} />
          ))}
        </div>
        <div class={styles.navFoot}>
          {/* A test affordance, and the only way to reach the frame's error
              boundary from a browser. It stays until something real needs the
              same corner. */}
          <button
            type="button"
            class={styles.throw}
            data-throw="shell"
            onClick={() => setBoom(true)}
          >
            Throw
          </button>
          {__BUILD_MARKER__ ? (
            <code class={styles.marker} data-build-marker={__BUILD_MARKER__}>
              {__BUILD_MARKER__}
            </code>
          ) : null}
        </div>
      </nav>

      <main class={styles.main}>
        <h2 class={styles.viewTitle}>{view.title}</h2>
        <p class={styles.note}>{view.note}</p>

        {path === "/service" ? <ServiceView store={store} /> : null}

        <div class={styles.panels}>
          {view.apps.map((name) => (
            <AsyncAppLoader key={name} name={name} assets={apps[name]} store={store} />
          ))}
        </div>
      </main>
    </div>
  );
}
