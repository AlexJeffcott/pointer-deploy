// Reads a channel's manifest over public HTTPS and caches it.
//
// The contract, in priority order:
//
//   1. A fresh cached manifest is returned with no network call.
//   2. A stale cached manifest is returned immediately and refreshed behind
//      the request. A visitor never waits for the store.
//   3. Only a cold cache waits, and only up to `timeoutMs`.
//   4. Single-flight: N concurrent callers for one URL cause one fetch.
//   5. A failed refresh leaves the last good value in place, so a running
//      server survives an indefinite store outage.
//   6. A failed refresh still advances the retry clock, so a dead store is
//      retried on the TTL rather than on every request.
//   7. A cold cache plus a failed fetch yields null. The caller answers 503.
//   8. An invalid document is a failed refresh, not a poisoned cache.

type Common = {
  buildId: string;
  commit: string;
  publishedAt: string;
  assetBase: string;
};

/** One self-contained bundle. */
export type ManifestV1 = Common & {
  schema: 1;
  entry: { js: string; css: string };
};

/**
 * A shell plus independently loaded sub-apps.
 *
 * `imports` becomes the page's import map, so a sub-app's bare specifiers
 * resolve to the shell's copies and the whole page shares one Preact and one
 * store. `apps` is what the shell fetches when a view needs one.
 */
export type ManifestV2 = Common & {
  schema: 2;
  shell: { js: string; css: string };
  imports: Record<string, string>;
  apps: Record<string, { js: string; css?: string }>;
};

// Both are readable, so promoting a build from before the split is still a
// working rollback rather than a 503.
export type Manifest = ManifestV1 | ManifestV2;

export type ManifestStore = {
  get(url: string): Promise<Manifest | null>;
};

type Entry = {
  value: Manifest | null;
  /** When the last attempt finished, success or failure. 0 means never. */
  checkedAt: number;
  inflight: Promise<void> | null;
};

export type StoreOptions = {
  ttlMs?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  now?: () => number;
  onWarn?: (message: string) => void;
};

export function manifestUrl(base: string, region: string, channel: string): string {
  return `${base.replace(/\/$/, "")}/${region}/${channel}.json`;
}

const str = (name: string, value: unknown): string => {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`manifest field ${name} is missing or not a string`);
  }
  return value;
};

/** Throws if the document is not a manifest this server understands. */
export function parseManifest(input: unknown): Manifest {
  const m = input as Record<string, unknown> | null;
  if (!m || typeof m !== "object") throw new Error("manifest is not an object");
  if (m.schema !== 1 && m.schema !== 2) {
    throw new Error(`unsupported manifest schema ${String(m.schema)}`);
  }

  const common: Common = {
    buildId: str("buildId", m.buildId),
    commit: str("commit", m.commit),
    publishedAt: str("publishedAt", m.publishedAt),
    assetBase: str("assetBase", m.assetBase),
  };

  if (m.schema === 1) {
    const entry = m.entry as Record<string, unknown> | undefined;
    return {
      ...common,
      schema: 1,
      entry: { js: str("entry.js", entry?.js), css: str("entry.css", entry?.css) },
    };
  }

  const shell = m.shell as Record<string, unknown> | undefined;
  const rawImports = m.imports;
  const rawApps = m.apps;
  if (!rawImports || typeof rawImports !== "object") {
    throw new Error("manifest field imports is missing or not an object");
  }
  if (!rawApps || typeof rawApps !== "object") {
    throw new Error("manifest field apps is missing or not an object");
  }

  const imports: Record<string, string> = {};
  for (const [name, value] of Object.entries(rawImports as Record<string, unknown>)) {
    imports[name] = str(`imports.${name}`, value);
  }

  const apps: Record<string, { js: string; css?: string }> = {};
  for (const [name, value] of Object.entries(rawApps as Record<string, unknown>)) {
    const a = value as Record<string, unknown> | null;
    if (!a || typeof a !== "object") {
      throw new Error(`manifest field apps.${name} is not an object`);
    }
    apps[name] = {
      js: str(`apps.${name}.js`, a.js),
      ...(a.css === undefined ? {} : { css: str(`apps.${name}.css`, a.css) }),
    };
  }

  // A shell with no sub-apps renders an empty page. Better to keep the last
  // good manifest than to serve that.
  if (Object.keys(apps).length === 0) throw new Error("manifest names no apps");

  return {
    ...common,
    schema: 2,
    shell: { js: str("shell.js", shell?.js), css: str("shell.css", shell?.css) },
    imports,
    apps,
  };
}

export function createManifestStore(options: StoreOptions = {}): ManifestStore {
  const ttlMs = options.ttlMs ?? Number(Bun.env.MANIFEST_TTL_MS ?? 10_000);
  const timeoutMs = options.timeoutMs ?? Number(Bun.env.MANIFEST_TIMEOUT_MS ?? 3_000);
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const warn = options.onWarn ?? ((m: string) => console.warn(m));

  const entries = new Map<string, Entry>();

  const entryFor = (url: string): Entry => {
    let e = entries.get(url);
    if (!e) {
      e = { value: null, checkedAt: 0, inflight: null };
      entries.set(url, e);
    }
    return e;
  };

  async function refresh(url: string, e: Entry): Promise<void> {
    try {
      const res = await doFetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        headers: { accept: "application/json" },
      });
      if (!res.ok) throw new Error(`GET ${url} responded ${res.status}`);
      e.value = parseManifest(await res.json());
    } catch (err) {
      // e.value is deliberately untouched. Rules 5 and 8.
      warn(`[manifest] refresh failed for ${url}: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      e.checkedAt = now(); // Rule 6: advances on failure too.
    }
  }

  function beginRefresh(url: string, e: Entry): Promise<void> {
    const p = refresh(url, e).finally(() => {
      if (e.inflight === p) e.inflight = null;
    });
    e.inflight = p; // Set synchronously, so rule 4 holds within a tick.
    return p;
  }

  return {
    async get(url: string): Promise<Manifest | null> {
      const e = entryFor(url);

      // Covers both "good and fresh" and "failed recently". Rules 1 and 6.
      if (now() - e.checkedAt < ttlMs) return e.value;

      const pending = e.inflight ?? beginRefresh(url, e);
      if (e.value) return e.value; // Rule 2: never wait when something is serveable.
      await pending; // Rule 3.
      return e.value; // Rule 7: may still be null.
    },
  };
}
