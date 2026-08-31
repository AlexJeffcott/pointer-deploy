import type { AppAssets, BuildInfo, VersionOption } from "@pointer/blocks";
import type { ComposedUnit, Manifest } from "./manifest.ts";
import type { Target } from "./origins.ts";

export type { AppAssets, BuildInfo } from "@pointer/blocks";

export function buildInfo(m: Manifest, target: Target, apiBase = ""): BuildInfo {
  const api = apiBase ? { apiBase } : {};
  if (m.schema === 3) {
    return {
      ...api,
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
    ...api,
    buildId: m.buildId,
    commit: m.commit,
    publishedAt: m.publishedAt,
    channel: target.channel,
    region: target.region,
  };
}

const attr = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");

const jsonBlock = (value: unknown) =>
  JSON.stringify(value).replace(/</g, "\\u003c");

const joinUrl = (base: string, file: string) =>
  `${base.replace(/\/$/, "")}/${file.replace(/^\//, "")}`;

const unitUrls = (u: ComposedUnit): { js: string; css?: string } => ({
  js: joinUrl(u.assetBase, u.js),
  ...(u.css ? { css: joinUrl(u.assetBase, u.css) } : {}),
});

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

export function importMap(m: Manifest): Record<string, string> {
  if (m.schema === 1) return {};
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

export function importMapDocument(m: Manifest): ImportMapDocument | null {
  const imports = importMap(m);
  if (Object.keys(imports).length === 0) return null;
  const integrity = moduleIntegrity(m);
  return Object.keys(integrity).length ? { imports, integrity } : { imports };
}

function importMapText(m: Manifest): string | null {
  const doc = importMapDocument(m);
  return doc === null ? null : jsonBlock(doc);
}

const sha256 = (text: string) =>
  `sha256-${new Bun.CryptoHasher("sha256").update(text).digest("base64")}`;

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
    if (!url) continue;
    try {
      origins.add(new URL(url).origin);
    } catch {}
  }
  return [...origins].sort();
}

const serviceOrigin = (apiBase: string): string | null => {
  if (!apiBase) return null;
  try {
    return new URL(apiBase).origin;
  } catch {
    return null;
  }
};

export function contentSecurityPolicy(m: Manifest, apiBase = ""): string {
  const origins = assetOrigins(m);
  const files = origins.length ? origins.join(" ") : "'none'";
  const text = importMapText(m);
  const script = [...origins, ...(text === null ? [] : [`'${sha256(text)}'`])];
  // The one host §13 names, and nothing else. The store is where every script
  // comes from, so it must not also be somewhere a compromised unit may send
  // anything, and the page's own origin needs no allowance: the server merges
  // the unit catalogue and renders the switcher's options into the page, so
  // nothing on it fetches `/units`, §25.
  const service = serviceOrigin(apiBase);
  return [
    "default-src 'none'",
    `script-src ${script.length ? script.join(" ") : "'none'"}`,
    `style-src ${files}`,
    `connect-src ${service ?? "'none'"}`,
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
  ].join("; ");
}

const sri = (digest?: string) =>
  digest ? ` integrity="${attr(digest)}" crossorigin="anonymous"` : "";

function shellDigests(m: Manifest): { js?: string; css?: string } {
  if (m.schema !== 3) return {};
  const at = (file: string | null) => (file ? m.shell.integrity?.[file] : undefined);
  return { js: at(m.shell.js), css: at(m.shell.css) };
}

function preloadLinks(m: Manifest): string {
  const digests = moduleIntegrity(m);
  const tags: string[] = [];
  for (const app of Object.values(appUrls(m))) {
    tags.push(
      `<link rel="modulepreload" href="${attr(app.js)}"` +
        `${sri(digests[app.js])}${digests[app.js] ? "" : ' crossorigin="anonymous"'} />`,
    );
    if (app.css) {
      tags.push(
        `<link rel="preload" as="style" href="${attr(app.css)}"${sri(app.cssIntegrity)} />`,
      );
    }
  }
  return tags.map((t) => `\n    ${t}`).join("");
}

export function renderShell(
  m: Manifest,
  target: Target,
  versions?: Record<string, VersionOption[]>,
  apiBase = "",
): string {
  const { js, css } = assetUrls(m);
  const apps = appUrls(m);
  const digest = shellDigests(m);

  const mapText = importMapText(m);
  const importMapTag =
    mapText === null ? "" : `\n    <script type="importmap">${mapText}</script>`;
  const appsTag = Object.keys(apps).length
    ? `\n    <script type="application/json" id="__APPS__">${jsonBlock(apps)}</script>`
    : "";
  const versionsTag =
    versions && Object.keys(versions).length
      ? `\n    <script type="application/json" id="__VERSIONS__">${jsonBlock(versions)}</script>`
      : "";
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
    <script type="application/json" id="__BUILD__">${jsonBlock(buildInfo(m, target, apiBase))}</script>${appsTag}${versionsTag}
    <script type="module" src="${attr(js)}"${sri(digest.js)}></script>${preloadLinks(m)}
  </body>
</html>
`;
}

export function shellResponse(
  m: Manifest,
  target: Target,
  versions?: Record<string, VersionOption[]>,
  apiBase = "",
): Response {
  return new Response(renderShell(m, target, versions, apiBase), {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "no-store, must-revalidate",
      "content-security-policy": contentSecurityPolicy(m, apiBase),
    },
  });
}
