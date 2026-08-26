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

export type Manifest = {
  schema: 1;
  buildId: string;
  commit: string;
  publishedAt: string;
  assetBase: string;
  entry: { js: string; css: string };
};

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

/** Throws if the document is not a manifest this server understands. */
export function parseManifest(input: unknown): Manifest {
  const m = input as Record<string, unknown> | null;
  if (!m || typeof m !== "object") throw new Error("manifest is not an object");
  if (m.schema !== 1) throw new Error(`unsupported manifest schema ${String(m.schema)}`);

  const entry = m.entry as Record<string, unknown> | undefined;
  const required: Array<[string, unknown]> = [
    ["buildId", m.buildId],
    ["commit", m.commit],
    ["publishedAt", m.publishedAt],
    ["assetBase", m.assetBase],
    ["entry.js", entry?.js],
    ["entry.css", entry?.css],
  ];
  for (const [name, value] of required) {
    if (typeof value !== "string" || value.length === 0) {
      throw new Error(`manifest field ${name} is missing or not a string`);
    }
  }
  return {
    schema: 1,
    buildId: m.buildId as string,
    commit: m.commit as string,
    publishedAt: m.publishedAt as string,
    assetBase: m.assetBase as string,
    entry: { js: entry!.js as string, css: entry!.css as string },
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
