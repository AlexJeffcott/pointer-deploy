// Builds the application shell from a manifest. The only templating the
// server does.

import type { ComposedUnit, Manifest } from "./manifest.ts";
import type { Target } from "./origins.ts";

export type BuildInfo = {
  /**
   * The shell's unit id under schema 3.
   *
   * The page no longer has one build id - it has five - but a single field
   * naming the frame the visitor is looking at is still the thing to report
   * first, and every unit id is beside it in `units`.
   */
  buildId: string;
  commit: string;
  publishedAt: string;
  channel: string;
  region: string;
  /** Schema 3 only. Every unit in the composition, and the contract it ran at. */
  units?: Record<string, { unitId: string; commit: string; marker: string }>;
  contract?: string;
};

export function buildInfo(m: Manifest, target: Target): BuildInfo {
  if (m.schema === 3) {
    return {
      buildId: m.shell.unitId,
      commit: m.shell.commit,
      publishedAt: m.composedAt,
      channel: target.channel,
      region: target.region,
      units: Object.fromEntries(
        [["shell", m.shell] as const, ...Object.entries(m.apps)].map(([n, u]) => [
          n,
          { unitId: u.unitId, commit: u.commit, marker: u.marker },
        ]),
      ),
      contract: m.contract,
    };
  }
  return {
    buildId: m.buildId,
    commit: m.commit,
    publishedAt: m.publishedAt,
    channel: target.channel,
    region: target.region,
  };
}

const attr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

// A JSON data block, not inline JavaScript: nothing to escape wrongly, and
// nothing that needs a CSP exception later. Browsers do not execute it.
// `<` must still be escaped or a value containing "</script" would end the tag.
const jsonBlock = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const joinUrl = (base: string, file: string) =>
  `${base.replace(/\/$/, "")}/${file.replace(/^\//, "")}`;

/**
 * Absolute URLs for one unit's own files.
 *
 * Schema 3's whole difference is here: each unit is joined against its own
 * base, so the shell can come from one published unit and alpha from another.
 */
const unitUrls = (u: ComposedUnit): { js: string; css?: string } => ({
  js: joinUrl(u.assetBase, u.js),
  ...(u.css ? { css: joinUrl(u.assetBase, u.css) } : {}),
});

/**
 * The entry script and stylesheet, whichever schema named them.
 *
 * `css` is null when the shell unit published none. A composition may say so -
 * `ComposedUnit.css` is `string | null` - and joining the base against an empty
 * name produced the unit's own DIRECTORY, which the page then linked as a
 * stylesheet and the browser fetched as a listing. Schemas 1 and 2 require the
 * field, so only a composition reaches the null.
 */
export function assetUrls(m: Manifest): { js: string; css: string | null } {
  if (m.schema === 3) {
    return {
      js: joinUrl(m.shell.assetBase, m.shell.js),
      css: m.shell.css === null ? null : joinUrl(m.shell.assetBase, m.shell.css),
    };
  }
  const entry = m.schema === 1 ? m.entry : m.shell;
  return {
    js: joinUrl(m.assetBase, entry.js),
    css: joinUrl(m.assetBase, entry.css),
  };
}

/** What the shell's loader is told about one sub-app. */
export type AppAssets = {
  js: string;
  css?: string;
  /**
   * The stylesheet's digest, when the unit published one.
   *
   * Only the stylesheet: a sub-app's script is imported by URL, and a dynamic
   * import takes no integrity argument. That one is attached in the import map
   * instead, which is the only place a module fetched by specifier can carry a
   * digest at all.
   */
  cssIntegrity?: string;
};

/** Every sub-app's absolute URLs, for the shell to fetch on demand. */
export function appUrls(m: Manifest): Record<string, AppAssets> {
  if (m.schema === 1) return {};
  if (m.schema === 3) {
    return Object.fromEntries(
      Object.entries(m.apps).map(([name, a]) => {
        const urls = unitUrls(a);
        const digest = a.css ? a.integrity?.[a.css] : undefined;
        return [name, { ...urls, ...(digest ? { cssIntegrity: digest } : {}) }];
      }),
    );
  }
  return Object.fromEntries(
    Object.entries(m.apps).map(([name, a]) => [
      name,
      { js: joinUrl(m.assetBase, a.js), ...(a.css ? { css: joinUrl(m.assetBase, a.css) } : {}) },
    ]),
  );
}

/**
 * The import map.
 *
 * Sub-apps are built separately with these specifiers external, so this is what
 * makes them resolve to the shell's copies. Without it each app would fail to
 * load, and with a per-app copy instead they would each get their own signals
 * runtime and stop responding to the shell's state.
 */
export function importMap(m: Manifest): Record<string, string> {
  if (m.schema === 1) return {};
  // The import map always resolves against the SHELL's base, whichever unit a
  // sub-app came from. That is what keeps one Preact on the page when the
  // bundles around it were published weeks apart.
  if (m.schema === 3) {
    return Object.fromEntries(
      Object.entries(m.shell.imports ?? {}).map(([name, file]) => [
        name,
        joinUrl(m.shell.assetBase, file),
      ]),
    );
  }
  return Object.fromEntries(
    Object.entries(m.imports).map(([name, file]) => [name, joinUrl(m.assetBase, file)]),
  );
}

const JAVASCRIPT = /\.m?js$/;

/**
 * URL to digest, for every script the page can fetch as a module.
 *
 * This is the only mechanism that reaches them. The shell's entry carries its
 * digest on the tag, but the chunk that entry imports, and every sub-app the
 * loader imports by URL, are fetched by the module loader with no tag and no
 * argument to put a digest in. The import map's own `integrity` section is
 * where those are declared.
 */
export function moduleIntegrity(m: Manifest): Record<string, string> {
  if (m.schema !== 3) return {};
  const digests: Record<string, string> = {};
  for (const u of [m.shell, ...Object.values(m.apps)]) {
    for (const [file, digest] of Object.entries(u.integrity ?? {})) {
      if (JAVASCRIPT.test(file)) digests[joinUrl(u.assetBase, file)] = digest;
    }
  }
  return digests;
}

export type ImportMapDocument = {
  imports: Record<string, string>;
  integrity?: Record<string, string>;
};

/** The import map, or null when the manifest names no shared specifiers. */
export function importMapDocument(m: Manifest): ImportMapDocument | null {
  const imports = importMap(m);
  if (Object.keys(imports).length === 0) return null;
  const integrity = moduleIntegrity(m);
  return Object.keys(integrity).length ? { imports, integrity } : { imports };
}

/** The exact text of the inline import map. The policy allows these bytes. */
function importMapText(m: Manifest): string | null {
  const doc = importMapDocument(m);
  return doc === null ? null : jsonBlock(doc);
}

const sha256 = (text: string) =>
  `sha256-${new Bun.CryptoHasher("sha256").update(text).digest("base64")}`;

/** Every origin the manifest names a file on. */
function assetOrigins(m: Manifest): string[] {
  const { js, css } = assetUrls(m);
  const urls = [
    js,
    css,
    ...Object.values(importMap(m)),
    ...Object.values(appUrls(m)).flatMap((a) => [a.js, a.css]),
  ];
  const origins = new Set<string>();
  for (const url of urls) {
    // Stryker disable next-line ConditionalExpression: it decides nothing.
    // An absent file names no origin, and a shell with no stylesheet now
    // reaches this with null rather than with a joined base. Removing the
    // guard cannot change the answer: new URL(null), new URL(undefined) and
    // new URL("") all throw into the same catch below, which adds no origin
    // either. The guard says which of the two cases this is, and nothing more.
    if (!url) continue;
    try {
      origins.add(new URL(url).origin);
    } catch {
      // A manifest naming a URL this server cannot parse names no origin to
      // allow. The page then fails to load that file, which is the right end.
    }
  }
  return [...origins].sort();
}

/**
 * What the page is allowed to fetch, and from where.
 *
 * Derived from the manifest rather than configured, because which store the
 * files come from is what the manifest is for: a composition served from a
 * second bucket would otherwise be refused by a policy naming the first.
 *
 * `default-src 'none'` and no exception for anything the page does not do. The
 * import map is the page's one inline script and is allowed by the hash of its
 * own bytes, so injected script in this HTML is still refused. The JSON data
 * blocks need no allowance: a script element the browser does not execute is
 * not a script the policy is asked about.
 */
export function contentSecurityPolicy(m: Manifest): string {
  const origins = assetOrigins(m);
  const files = origins.length ? origins.join(" ") : "'none'";
  const text = importMapText(m);
  const script = [...origins, ...(text === null ? [] : [`'${sha256(text)}'`])];
  return [
    "default-src 'none'",
    `script-src ${script.length ? script.join(" ") : "'none'"}`,
    `style-src ${files}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

/**
 * A digest on a tag, with the CORS the browser needs to check it.
 *
 * Without `crossorigin` a cross-origin stylesheet with an integrity attribute
 * is refused rather than checked, so the page renders unstyled. The bucket
 * allows GET from any origin, which is what `bun run setup:store` sets.
 */
const sri = (digest?: string) =>
  digest ? ` integrity="${attr(digest)}" crossorigin="anonymous"` : "";

/** The digests for the shell's own entry and stylesheet, when it has them. */
function shellDigests(m: Manifest): { js?: string; css?: string } {
  if (m.schema !== 3) return {};
  const at = (file: string | null) => (file ? m.shell.integrity?.[file] : undefined);
  return { js: at(m.shell.js), css: at(m.shell.css) };
}

export function renderShell(m: Manifest, target: Target): string {
  const { js, css } = assetUrls(m);
  const apps = appUrls(m);
  const digest = shellDigests(m);

  // The import map must be parsed before any module script runs.
  const mapText = importMapText(m);
  const importMapTag =
    mapText === null ? "" : `\n    <script type="importmap">${mapText}</script>`;
  const appsTag = Object.keys(apps).length
    ? `\n    <script type="application/json" id="__APPS__">${jsonBlock(apps)}</script>`
    : "";
  // Dropped rather than emptied, the same way the import map and the app list
  // are. A link whose href is the unit's directory makes the browser fetch a
  // listing and parse it as CSS.
  const styleTag =
    css === null ? "" : `\n    <link rel="stylesheet" href="${attr(css)}"${sri(digest.css)} />`;

  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>pointer-deploy</title>${styleTag}${importMapTag}
  </head>
  <body>
    <div id="app"></div>
    <script type="application/json" id="__BUILD__">${jsonBlock(buildInfo(m, target))}</script>${appsTag}
    <script type="module" src="${attr(js)}"${sri(digest.js)}></script>
  </body>
</html>
`;
}

export function shellResponse(m: Manifest, target: Target): Response {
  return new Response(renderShell(m, target), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      // Not optional. An edge cache that stores this serves one visitor's
      // build to everyone, and it outlives the promotion that replaced it.
      "cache-control": "no-store, must-revalidate",
      // The second half of the answer to "whoever can write the pointer can
      // run script on this origin". The digests say the files must be the
      // published bytes; this says nothing else may be fetched at all.
      "content-security-policy": contentSecurityPolicy(m),
    },
  });
}
