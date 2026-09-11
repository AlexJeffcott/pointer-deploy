import { useState } from "preact/hooks";
import type { ShellStore } from "./api.ts";
import { documentFrom, readDocument, type ImportOutcome } from "./document.ts";
import { SCHEMA_VERSION } from "./planner.ts";
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

/**
 * The planner as one file, drawn by the shell, `PLAN.md` step 3.
 *
 * No unit is placed on `/backup` and nothing is fetched for it, exactly as on
 * `/service`. Two of the document's four doors are here; push and pull are the
 * other two and arrive at steps 6 and 7.
 *
 * The frame calls `document.ts` straight and writes through
 * `ShellStore.loadTasks`, so step 3 adds no member to the contract. A sub-app
 * cannot read a file, so a member for it would be surface the member gate could
 * refuse nothing for.
 */
function BackupView({ store }: { store: ShellStore }) {
  const planner = store.planner();
  const tasks = store.tasks();
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);

  /**
   * Neither door opens before the planner has been read, and no count is drawn.
   *
   * The same requirement `list` carries, and this view needs it MORE. `list` is
   * a separately published bundle, fetched and imported after the shell paints,
   * so IndexedDB is nearly always open before it first renders - which is TODO
   * §41. This view is IN the shell bundle and `/backup` is landable directly,
   * so it draws on the first paint, before the read.
   *
   * What that window would otherwise produce is a file: `tasks` is empty until
   * the read lands, so an export taken here writes a valid, importable planner
   * holding nothing. An import taken here is overwritten by the read that
   * follows it.
   */
  const unread = planner.state === "unread";

  const save = (): void => {
    const doc = documentFrom(tasks, SCHEMA_VERSION);
    const url = URL.createObjectURL(
      new Blob([`${JSON.stringify(doc, null, 2)}\n`], { type: "application/json" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `pointer-planner-${doc.exportedAt.slice(0, 10)}.json`;
    // Attached, clicked, and taken away on the next turn of the loop. A
    // detached anchor downloads in Chrome and not in every browser, and
    // revoking the object URL in the same tick races the download starting
    // from it.
    document.body.append(link);
    link.click();
    setTimeout(() => {
      link.remove();
      URL.revokeObjectURL(url);
    }, 0);
  };

  const load = async (event: Event): Promise<void> => {
    const input = event.currentTarget as HTMLInputElement;
    const file = input.files?.[0];
    // Cleared first, so that choosing the SAME file again fires a second
    // change event. An input still holding the name does not, and a person who
    // has just seen a refusal is exactly the person who tries again.
    input.value = "";
    if (!file) return;

    // The columns as well as the version, `PLAN.md` step 4: a task in a column
    // this shell does not draw would be in the planner and on no panel of the
    // board, and the store is what knows which columns those are.
    const read = readDocument(await file.text(), SCHEMA_VERSION, store.columns());
    // The write, and the whole of "a total overwrite in one transaction": one
    // assignment to the store, which the shell's effect turns into one
    // IndexedDB transaction that clears the object store and puts the
    // document's tasks into it. A refusal never reaches this line.
    if (read.ok) store.loadTasks(read.tasks);
    setOutcome(read);
  };

  return (
    <div class={styles.report} data-backup>
      <dl class={styles.pairs}>
        <dt>Planner</dt>
        <dd data-planner-state>{planner.state}</dd>
        <dt>Tasks held</dt>
        <dd data-planner-tasks>{unread ? "not read yet" : tasks.length}</dd>
        <dt>Schema</dt>
        <dd data-planner-version>{planner.schemaVersion ?? "nothing written"}</dd>
        <dt>Writing</dt>
        <dd data-planner-pending>{planner.pending ? "a change has still to land" : "nothing waiting"}</dd>
        {planner.error ? (
          <>
            <dt>Not stored</dt>
            <dd data-planner-error>{planner.error}</dd>
          </>
        ) : null}
      </dl>

      {unread ? (
        <p class={styles.muted} data-backup-unread>
          Reading the planner. Nothing is exported or imported until it has been read.
        </p>
      ) : null}

      <div class={styles.doors}>
        <div class={styles.door}>
          <h3 class={styles.doorTitle}>Export</h3>
          <button
            type="button"
            class={styles.button}
            data-export
            disabled={unread}
            onClick={save}
          >
            Write a file
          </button>
          <p class={styles.muted}>
            Every task as one JSON file. Clearing this browser&rsquo;s site data destroys the
            planner, and this file is what survives it.
          </p>
        </div>

        <div class={styles.door}>
          <h3 class={styles.doorTitle}>Import</h3>
          <label class={styles.fileLabel} for="import-file">
            Choose a file
          </label>
          <input
            id="import-file"
            class={styles.file}
            type="file"
            accept="application/json,.json"
            data-import
            disabled={unread}
            onChange={load}
          />
          <p class={styles.muted}>
            A total overwrite. Every task here is replaced by the ones in the file, and nothing is
            merged. A file this shell cannot read is refused whole.
          </p>
        </div>
      </div>

      {outcome === null ? null : outcome.ok ? (
        <p class={styles.outcome} data-import-read={outcome.tasks.length}>
          Read {outcome.tasks.length} {outcome.tasks.length === 1 ? "task" : "tasks"} out of the
          file. Every task that was here has been replaced.
        </p>
      ) : (
        <p class={styles.refused} data-import-refused>
          The file was refused: {outcome.problem}. Nothing was changed.
        </p>
      )}

      <p class={styles.muted}>
        Pushing this planner to the service, and pulling one into another browser, are not built
        yet.
      </p>
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
        {path === "/backup" ? <BackupView store={store} /> : null}

        <div class={styles.panels}>
          {view.apps.map((name) => (
            <AsyncAppLoader key={name} name={name} assets={apps[name]} store={store} />
          ))}
        </div>
      </main>
    </div>
  );
}
