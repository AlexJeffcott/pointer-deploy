import { useState } from "preact/hooks";
import type { ShellStore } from "./api.ts";
import { documentFrom, readDocument, readPlanner, type ImportOutcome } from "./document.ts";
import type { ServiceClient } from "./service.ts";
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

/** What a push came to: the address, or the sentence that stopped it. */
type PushOutcome = { ok: true; snapshot: string; createdAt: string } | { ok: false; problem: string };

/**
 * The planner as one document, drawn by the shell, `PLAN.md` steps 3 and 6.
 *
 * No unit is placed on `/backup` and nothing is fetched for it, exactly as on
 * `/service`. All FOUR doors are here from step 6: export writes a file, import
 * reads one, push writes a snapshot to the service and pull reads one back.
 *
 * The frame calls `document.ts` and the client straight, and writes through
 * `ShellStore.loadTasks`, so neither step adds a member to the contract. A
 * sub-app cannot read a file and does not hold the client, so a member for
 * either would be surface the member gate could refuse nothing for.
 *
 * Import and pull are ONE rule. `readDocument` is `JSON.parse` and then
 * `readPlanner`; the pull door calls the second of those on a response the
 * service has already parsed. Both end in `loadTasks`, which is one assignment
 * and therefore one IndexedDB transaction.
 */
function BackupView({ store, client }: { store: ShellStore; client: ServiceClient | null }) {
  const planner = store.planner();
  const tasks = store.tasks();
  const [outcome, setOutcome] = useState<ImportOutcome | null>(null);
  const [pushed, setPushed] = useState<PushOutcome | null>(null);
  const [address, setAddress] = useState("");
  const [pulled, setPulled] = useState<ImportOutcome | null>(null);
  const [busy, setBusy] = useState(false);

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

  const why = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  /**
   * The planner to the service, `PLAN.md` step 6.
   *
   * The bytes are built once and sent as they are: the address a snapshot gets
   * is the sha256 of what was sent, so serialising here and again inside the
   * client would be two byte strings and could be two addresses for one
   * planner.
   *
   * What is pushed is what is ON SCREEN, and not what the database holds. The
   * store is ahead of IndexedDB by the width of one transaction - `PlannerReport
   * .pending` is that window - and a person pressing this has just looked at
   * their tasks.
   */
  const push = async (): Promise<void> => {
    if (!client) return;
    setBusy(true);
    try {
      const said = await client.push(JSON.stringify(documentFrom(tasks, SCHEMA_VERSION)));
      setPushed({ ok: true, ...said });
    } catch (e) {
      setPushed({ ok: false, problem: why(e) });
    } finally {
      setBusy(false);
    }
  };

  /**
   * One snapshot back into this browser, `PLAN.md` step 6.
   *
   * The same rule as the file door and the same total overwrite. Nothing is
   * written until the document is read: a snapshot a newer shell pushed, or a
   * body that was never a planner, is refused by name and the planner is
   * untouched - which is the half of the rule `PLAN.md`'s four-doors table is
   * about, and the half nothing enforced before this step.
   *
   * The address is trimmed because it arrives by being copied, and a copied
   * line brings its whitespace with it.
   */
  const pull = async (): Promise<void> => {
    if (!client) return;
    setBusy(true);
    try {
      const said = await client.pull(address.trim());
      const read = readPlanner(said.document, SCHEMA_VERSION, store.columns());
      if (read.ok) store.loadTasks(read.tasks);
      setPulled(read);
    } catch (e) {
      setPulled({ ok: false, problem: why(e) });
    } finally {
      setBusy(false);
    }
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

      <div class={styles.doors}>
        <div class={styles.door}>
          <h3 class={styles.doorTitle}>Push</h3>
          <button
            type="button"
            class={styles.button}
            data-push
            disabled={unread || busy || !client}
            onClick={push}
          >
            {busy ? "Working…" : "Push a snapshot"}
          </button>
          {/* Said on the page, in these words, because it is the whole of the
              security model: there is no account, no login and no user record
              anywhere, so holding the address IS the permission to read. */}
          <p class={styles.muted}>
            The planner goes to the service, which keeps it in a bucket and hands back an address.
            Anyone holding that address can read this planner.
          </p>
        </div>

        <div class={styles.door}>
          <h3 class={styles.doorTitle}>Pull</h3>
          <label class={styles.fileLabel} for="pull-address">
            An address
          </label>
          <input
            id="pull-address"
            class={styles.address}
            type="text"
            spellcheck={false}
            autocomplete="off"
            placeholder="the address a push handed back"
            value={address}
            data-pull-address
            disabled={unread || busy || !client}
            onInput={(e: Event) => setAddress((e.currentTarget as HTMLInputElement).value)}
          />
          <button
            type="button"
            class={styles.button}
            data-pull
            disabled={unread || busy || !client || address.trim() === ""}
            onClick={pull}
          >
            {busy ? "Working…" : "Pull it in"}
          </button>
          <p class={styles.muted}>
            A total overwrite, exactly as an import is. A snapshot a newer shell pushed is refused
            whole, and nothing here is merged.
          </p>
        </div>
      </div>

      {client ? null : (
        <p class={styles.muted} data-no-service>
          This page was served without a service to call, so there is nowhere to push to and
          nothing to pull from.
        </p>
      )}

      {pushed === null ? null : pushed.ok ? (
        <p class={styles.outcome} data-pushed={pushed.snapshot}>
          Kept at <code>{pushed.snapshot}</code>, {pushed.createdAt}. Anyone holding that address
          can read this planner.
        </p>
      ) : (
        <p class={styles.refused} data-push-refused>
          The push did not land: {pushed.problem}. The planner is unchanged.
        </p>
      )}

      {pulled === null ? null : pulled.ok ? (
        <p class={styles.outcome} data-pull-read={pulled.tasks.length}>
          Read {pulled.tasks.length} {pulled.tasks.length === 1 ? "task" : "tasks"} out of that
          snapshot. Every task that was here has been replaced.
        </p>
      ) : (
        <p class={styles.refused} data-pull-refused>
          The snapshot was refused: {pulled.problem}. Nothing was changed.
        </p>
      )}
    </div>
  );
}

/**
 * `client` is null when the server named no service, and `/backup` says so
 * rather than drawing two doors that cannot open. The frame is handed the one
 * the page already made: a second client here would be a second timeout, a
 * second base and a second reading of the same `Sunset` header.
 */
export function Shell({
  store,
  client = null,
}: {
  store: ShellStore;
  client?: ServiceClient | null;
}) {
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
        {path === "/backup" ? <BackupView store={store} client={client} /> : null}

        <div class={styles.panels}>
          {view.apps.map((name) => (
            <AsyncAppLoader key={name} name={name} assets={apps[name]} store={store} />
          ))}
        </div>
      </main>
    </div>
  );
}
