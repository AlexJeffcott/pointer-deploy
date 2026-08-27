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
//   9. A clock that moved backwards is not freshness. See `get`.
//  10. Every entry can say how old its manifest is and what its last refresh
//      said, so an origin serving a superseded composition can be read as
//      doing so rather than guessed at.

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

/** One unit inside a composition. Carries its own base. */
export type ComposedUnit = {
  unitId: string;
  commit: string;
  assetBase: string;
  js: string;
  css: string | null;
  imports?: Record<string, string>;
  /**
   * File name to SRI digest, for the files this unit published.
   *
   * Optional, and its absence is not an error: a unit published before digests
   * were recorded has none, and a composition naming one must still render.
   * What the page can check it checks; what it cannot it says nothing about.
   */
  integrity?: Record<string, string>;
  marker: string;
};

/**
 * A composition of independently published units.
 *
 * The difference from schema 2 is one field in one place: each unit has its
 * OWN assetBase. Schema 2 shared one base across everything, so every file had
 * to come from one build directory - which is exactly what made the five
 * bundles deploy and roll back together.
 */
export type ManifestV3 = {
  schema: 3;
  composedAt: string;
  contract: string;
  shell: ComposedUnit;
  apps: Record<string, ComposedUnit>;
};

// All three are readable, so promoting a pointer written before the split is
// still a working rollback rather than a 503.
export type Manifest = ManifestV1 | ManifestV2 | ManifestV3;

export type ManifestStore = {
  get(url: string): Promise<Manifest | null>;
  /** How old this URL's manifest is, and what its last refresh said. */
  stateOf(url: string): ManifestState;
};

type Entry = {
  value: Manifest | null;
  /** When the last attempt finished, success or failure. 0 means never. */
  checkedAt: number;
  /** When the last SUCCESSFUL fetch finished. 0 means never. */
  fetchedAt: number;
  /** What the last attempt failed with, or null if it succeeded. */
  lastError: string | null;
  inflight: Promise<void> | null;
};

/**
 * What an entry can say about itself, for an operator reading a response.
 *
 * The fault this exists for: a channel's pointer moves, and the origin goes on
 * serving the composition before it. Nothing a visitor or a suite could read
 * separated the three causes - the store had not taken the write, the refresh
 * was failing, or the refresh was never attempted - so a wrong page and a slow
 * one looked identical from outside.
 */
export type ManifestState = {
  /**
   * Milliseconds since the last successful fetch, or null if there has never
   * been one.
   *
   * NOT clamped at zero. A negative age means this process's clock is behind
   * the one that stamped the entry, which is a reading worth having: it is the
   * state in which a TTL over a wall clock stops expiring.
   */
  ageMs: number | null;
  /** What the last refresh attempt failed with, or null if it succeeded. */
  lastError: string | null;
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
  if (m.schema !== 1 && m.schema !== 2 && m.schema !== 3) {
    throw new Error(`unsupported manifest schema ${String(m.schema)}`);
  }

  if (m.schema === 3) return parseComposition(m);

  const common: Common = {
    buildId: str("buildId", m.buildId),
    commit: str("commit", m.commit),
    publishedAt: str("publishedAt", m.publishedAt),
    assetBase: str("assetBase", m.assetBase),
  };

  if (m.schema === 1) {
    // An absent entry is an empty one, so each required field reports itself
    // missing by name rather than the object reporting them all at once.
    const entry = (m.entry ?? {}) as Record<string, unknown>;
    return {
      ...common,
      schema: 1,
      entry: { js: str("entry.js", entry.js), css: str("entry.css", entry.css) },
    };
  }

  const shell = (m.shell ?? {}) as Record<string, unknown>;
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
    shell: { js: str("shell.js", shell.js), css: str("shell.css", shell.css) },
    imports,
    apps,
  };
}

function parseComposedUnit(label: string, value: unknown): ComposedUnit {
  const u = value as Record<string, unknown> | null;
  if (!u || typeof u !== "object") throw new Error(`manifest field ${label} is not an object`);

  let imports: Record<string, string> | undefined;
  if (u.imports !== undefined) {
    if (!u.imports || typeof u.imports !== "object") {
      throw new Error(`manifest field ${label}.imports is not an object`);
    }
    imports = {};
    for (const [name, file] of Object.entries(u.imports as Record<string, unknown>)) {
      imports[name] = str(`${label}.imports.${name}`, file);
    }
  }

  let integrity: Record<string, string> | undefined;
  if (u.integrity !== undefined) {
    if (!u.integrity || typeof u.integrity !== "object") {
      throw new Error(`manifest field ${label}.integrity is not an object`);
    }
    integrity = {};
    for (const [file, digest] of Object.entries(u.integrity as Record<string, unknown>)) {
      integrity[file] = str(`${label}.integrity.${file}`, digest);
    }
  }

  return {
    unitId: str(`${label}.unitId`, u.unitId),
    // Provenance, so a composition that predates the field still parses.
    commit: typeof u.commit === "string" ? u.commit : "",
    assetBase: str(`${label}.assetBase`, u.assetBase),
    js: str(`${label}.js`, u.js),
    css: u.css === null || u.css === undefined ? null : str(`${label}.css`, u.css),
    ...(imports ? { imports } : {}),
    ...(integrity ? { integrity } : {}),
    marker: typeof u.marker === "string" ? u.marker : "",
  };
}

function parseComposition(m: Record<string, unknown>): ManifestV3 {
  const rawApps = m.apps;
  if (!rawApps || typeof rawApps !== "object") {
    throw new Error("manifest field apps is missing or not an object");
  }

  const apps: Record<string, ComposedUnit> = {};
  for (const [name, value] of Object.entries(rawApps as Record<string, unknown>)) {
    apps[name] = parseComposedUnit(`apps.${name}`, value);
  }

  // A shell with no sub-apps renders an empty page. Better to keep the last
  // good composition than to serve that.
  if (Object.keys(apps).length === 0) throw new Error("manifest names no apps");

  const shell = parseComposedUnit("shell", m.shell);
  // The shell is the only unit that carries the import map. Without it every
  // sub-app's bare specifiers fail to resolve and the page renders empty.
  if (!shell.imports || Object.keys(shell.imports).length === 0) {
    throw new Error("manifest field shell.imports is missing or empty");
  }

  return {
    schema: 3,
    composedAt: str("composedAt", m.composedAt),
    contract: str("contract", m.contract),
    shell,
    apps,
  };
}

export function createManifestStore(options: StoreOptions = {}): ManifestStore {
  const ttlMs = options.ttlMs ?? Number(Bun.env.MANIFEST_TTL_MS ?? 10_000);
  const timeoutMs = options.timeoutMs ?? Number(Bun.env.MANIFEST_TIMEOUT_MS ?? 3_000);
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  // Stryker disable next-line ArrowFunction: the default sink is console. Which
  // function logs is not behaviour, and only a spy on console could catch it.
  const warn = options.onWarn ?? ((m: string) => console.warn(m));

  const entries = new Map<string, Entry>();

  const entryFor = (url: string): Entry => {
    let e = entries.get(url);
    if (!e) {
      e = { value: null, checkedAt: 0, fetchedAt: 0, lastError: null, inflight: null };
      entries.set(url, e);
    }
    return e;
  };

  async function refresh(url: string, e: Entry): Promise<void> {
    try {
      const res = await doFetch(url, {
        signal: AbortSignal.timeout(timeoutMs),
        // Stryker disable next-line ObjectLiteral,StringLiteral: courtesy.
        // The store serves one representation and negotiates nothing, so no
        // reading of this system changes when the header does.
        headers: { accept: "application/json" },
      });
      // Stryker disable next-line StringLiteral: log wording. The status check
      // itself is held next door; only the sentence is here.
      if (!res.ok) throw new Error(`GET ${url} responded ${res.status}`);
      e.value = parseManifest(await res.json());
      e.fetchedAt = now();
      e.lastError = null;
    } catch (err) {
      // e.value is deliberately untouched. Rules 5 and 8.
      e.lastError = err instanceof Error ? err.message : String(err);
      // Stryker disable next-line StringLiteral: log wording. That warn is
      // called at all is held by "a failed refresh reports through onWarn".
      warn(`[manifest] refresh failed for ${url}: ${e.lastError}`);
    } finally {
      e.checkedAt = now(); // Rule 6: advances on failure too.
    }
  }

  function beginRefresh(url: string, e: Entry): Promise<void> {
    const p = refresh(url, e).finally(() => {
      // Stryker disable next-line ConditionalExpression: no input reaches it.
      // This is the only writer of e.inflight, and its only caller runs it when
      // e.inflight is null, so a second promise cannot exist while this one is
      // in flight. This callback was also registered before any other
      // continuation on p, so nothing has run between p settling and here. The
      // guard states the invariant a second call site would have to keep, and
      // it cannot be tested because it cannot yet be broken.
      if (e.inflight === p) e.inflight = null;
    });
    e.inflight = p; // Set synchronously, so rule 4 holds within a tick.
    return p;
  }

  return {
    stateOf(url: string): ManifestState {
      // Never creates an entry. Asking what a URL's state is must not be the
      // thing that gives it one, or a caller reading before serving would
      // report an age for a manifest nothing has ever fetched.
      const e = entries.get(url);
      return {
        ageMs: e && e.fetchedAt !== 0 ? now() - e.fetchedAt : null,
        lastError: e ? e.lastError : null,
      };
    },

    async get(url: string): Promise<Manifest | null> {
      const e = entryFor(url);

      // Covers both "good and fresh" and "failed recently". Rules 1 and 6.
      //
      // The lower bound is rule 9, and it is not defensive: a wall clock moves
      // backwards. An NTP correction does it, and so does a machine resumed
      // from a snapshot with its clock behind the world's - which is what this
      // one runs on, since fly.toml suspends it when nobody is asking. A
      // negative age would then read as fresher than any TTL, the entry would
      // never be refreshed again, and the origin would serve a composition
      // nobody promoted for as long as the skew lasted, silently and without
      // one failed request to show for it. A clock that cannot be compared
      // with the one that stamped the entry is a reason to refetch, not a
      // reason to trust what is held.
      const age = now() - e.checkedAt;
      if (age >= 0 && age < ttlMs) return e.value;

      const pending = e.inflight ?? beginRefresh(url, e);
      if (e.value) return e.value; // Rule 2: never wait when something is serveable.
      await pending; // Rule 3.
      return e.value; // Rule 7: may still be null.
    },
  };
}
