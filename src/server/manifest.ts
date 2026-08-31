type Common = {
  buildId: string;
  commit: string;
  publishedAt: string;
  assetBase: string;
};

export type ManifestV1 = Common & {
  schema: 1;
  entry: { js: string; css: string };
};

export type ManifestV2 = Common & {
  schema: 2;
  shell: { js: string; css: string };
  imports: Record<string, string>;
  apps: Record<string, { js: string; css?: string }>;
};

export type ComposedUnit = {
  unitId: string;
  commit: string;
  assetBase: string;
  js: string;
  css: string | null;
  imports?: Record<string, string>;
  integrity?: Record<string, string>;
  marker: string;
};

export type ManifestV3 = {
  schema: 3;
  composedAt: string;
  contract: string;
  shell: ComposedUnit;
  apps: Record<string, ComposedUnit>;
};

export type Manifest = ManifestV1 | ManifestV2 | ManifestV3;

export type DocumentStore<T> = {
  get(url: string): Promise<T | null>;
  peek(url: string): T | null;
  stateOf(url: string): ManifestState;
};

export type ManifestStore = DocumentStore<Manifest>;

type Entry<T> = {
  value: T | null;
  checkedAt: number;
  fetchedAt: number;
  lastError: string | null;
  inflight: Promise<void> | null;
};

export type ManifestState = {
  ageMs: number | null;
  lastError: string | null;
};

export type StoreOptions = {
  label?: string;
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

  if (Object.keys(apps).length === 0) throw new Error("manifest names no apps");

  const shell = parseComposedUnit("shell", m.shell);
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
  return createDocumentStore(parseManifest, options);
}

function bounded<V>(p: Promise<V>, ms: number, message: string): Promise<V> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const bell = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(message)), ms);
  });
  // Stryker disable next-line ArrowFunction: housekeeping.
  return Promise.race([p, bell]).finally(() => clearTimeout(timer));
}

export function createDocumentStore<T>(
  parse: (input: unknown) => T,
  options: StoreOptions = {},
): DocumentStore<T> {
  const label = options.label ?? "manifest";
  const ttlMs = options.ttlMs ?? Number(Bun.env.MANIFEST_TTL_MS ?? 10_000);
  const timeoutMs = options.timeoutMs ?? Number(Bun.env.MANIFEST_TIMEOUT_MS ?? 3_000);
  // Stryker disable next-line ArithmeticOperator: the number is not behaviour.
  const deadlineMs = timeoutMs * 2;
  const doFetch = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  // Stryker disable next-line ArrowFunction: the default sink is console.
  const warn = options.onWarn ?? ((m: string) => console.warn(m));

  const entries = new Map<string, Entry<T>>();

  const entryFor = (url: string): Entry<T> => {
    let e = entries.get(url);
    if (!e) {
      e = { value: null, checkedAt: 0, fetchedAt: 0, lastError: null, inflight: null };
      entries.set(url, e);
    }
    return e;
  };

  async function fetchDocument(url: string): Promise<T> {
    const res = await doFetch(url, {
      signal: AbortSignal.timeout(timeoutMs),
      // Stryker disable next-line ObjectLiteral,StringLiteral: courtesy.
      headers: { accept: "application/json" },
    });
    // Stryker disable next-line StringLiteral: log wording.
    if (!res.ok) throw new Error(`GET ${url} responded ${res.status}`);
    return parse(await res.json());
  }

  async function refresh(url: string, e: Entry<T>): Promise<void> {
    try {
      e.value = await bounded(
        fetchDocument(url),
        deadlineMs,
        `GET ${url} did not answer within ${deadlineMs} ms`,
      );
      e.fetchedAt = now();
      e.lastError = null;
    } catch (err) {
      e.lastError = err instanceof Error ? err.message : String(err);
      // Stryker disable next-line StringLiteral: log wording.
      warn(`[${label}] refresh failed for ${url}: ${e.lastError}`);
    } finally {
      e.checkedAt = now();
    }
  }

  function beginRefresh(url: string, e: Entry<T>): Promise<void> {
    const p = refresh(url, e).finally(() => {
      // Stryker disable next-line ConditionalExpression: no input reaches it.
      if (e.inflight === p) e.inflight = null;
    });
    e.inflight = p;
    return p;
  }

  return {
    stateOf(url: string): ManifestState {
      const e = entries.get(url);
      return {
        ageMs: e && e.fetchedAt !== 0 ? now() - e.fetchedAt : null,
        lastError: e ? e.lastError : null,
      };
    },

    peek(url: string): T | null {
      const e = entryFor(url);
      const age = now() - e.checkedAt;
      if ((age < 0 || age >= ttlMs) && !e.inflight) beginRefresh(url, e);
      return e.value;
    },

    async get(url: string): Promise<T | null> {
      const e = entryFor(url);

      const age = now() - e.checkedAt;
      if (age >= 0 && age < ttlMs) return e.value;

      const pending = e.inflight ?? beginRefresh(url, e);
      if (e.value) return e.value;
      await pending;
      return e.value;
    },
  };
}
