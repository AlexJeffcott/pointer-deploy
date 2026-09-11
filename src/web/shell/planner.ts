import type { Task } from "./api.ts";

/**
 * The planner's database, owned by the shell.
 *
 * `PLAN.md` step 2. The shell reads this once at startup and writes it back on
 * every change, and `list` never touches it: a sub-app draws the store and the
 * store is what knows where its contents are kept. That is why this module
 * exports nothing to `@pointer/shell` - it is the shell's own machinery, not
 * contract surface, and a member here could refuse nothing for anybody.
 */
export const DB_NAME = "pointer-planner";

/**
 * The version this shell knows, and the one it opens at.
 *
 * Opened at a FIXED version, deliberately. `PLAN.md` step 14 adds version 2,
 * step 15 rolls this shell back onto data version 2 has already written, and
 * the `VersionError` that produces is the thing step 15 exists to show. Step 16
 * is the fix - open with no version, read `db.version`, and degrade to no cache
 * when the stored version is higher - and building it here would leave steps 15
 * and 16 with nothing to demonstrate.
 */
export const SCHEMA_VERSION = 1;

const TASKS = "tasks";
const META = "meta";

/** One `meta` record. The store is keyed on `key`, so the name is in the row. */
type MetaRow = { key: string; value: unknown };

/**
 * What the shell holds once the database is open.
 *
 * `read` is called once and `write` on every change. Neither throws: a caller
 * that has a handle has already got past the open, and a write that fails after
 * that is reported through the report rather than by stopping the page.
 */
export type Planner = {
  read(): Promise<Task[]>;
  write(tasks: readonly Task[]): Promise<void>;
  close(): void;
};

const done = <T>(request: IDBRequest<T>): Promise<T> =>
  new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("indexeddb request failed"));
  });

const committed = (tx: IDBTransaction): Promise<void> =>
  new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = () => reject(tx.error ?? new Error("indexeddb transaction aborted"));
    tx.onerror = () => reject(tx.error ?? new Error("indexeddb transaction failed"));
  });

/**
 * Opens the database, creating version 1's two object stores if they are new.
 *
 * Rejects rather than returning null when the browser has no IndexedDB at all,
 * so that one caller reads one failure: a private window that refuses storage
 * and a database that will not open are the same fact to the page, which is
 * that the planner is not being stored.
 */
export async function openPlanner(): Promise<Planner> {
  const idb = globalThis.indexedDB as IDBFactory | undefined;
  if (!idb) throw new Error("this browser does not offer IndexedDB");

  const request = idb.open(DB_NAME, SCHEMA_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains(TASKS)) db.createObjectStore(TASKS, { keyPath: "id" });
    if (!db.objectStoreNames.contains(META)) db.createObjectStore(META, { keyPath: "key" });
  };

  const db = await done(request);

  return {
    read: async () => {
      const tx = db.transaction(TASKS, "readonly");
      const rows = await done(tx.objectStore(TASKS).getAll() as IDBRequest<Task[]>);
      await committed(tx);
      // Insertion order is what the list draws and `getAll` returns key order,
      // so the order is restored from the ids rather than assumed. `newId`
      // mints them in sequence within one page and prefixes the counter, which
      // is not an ordering across visits - `createdAt` is, and it is what a
      // task carries for exactly this.
      return [...rows].sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    },

    /**
     * Every task, in one transaction, replacing what was there.
     *
     * A clear and a rewrite rather than a diff. The list is small, one page
     * owns it, and a partial write is the failure worth designing against:
     * `PLAN.md` puts import and pull behind the same rule at step 3, and a
     * transaction that aborts leaves the planner exactly as it was.
     */
    write: async (tasks) => {
      const tx = db.transaction([TASKS, META], "readwrite");
      const store = tx.objectStore(TASKS);
      store.clear();
      for (const task of tasks) store.put(task);
      const meta = tx.objectStore(META);
      meta.put({ key: "schemaVersion", value: SCHEMA_VERSION } satisfies MetaRow);
      meta.put({ key: "writtenAt", value: new Date().toISOString() } satisfies MetaRow);
      await committed(tx);
    },

    close: () => db.close(),
  };
}
