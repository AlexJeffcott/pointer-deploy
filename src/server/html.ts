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

/** The entry script and stylesheet, whichever schema named them. */
export function assetUrls(m: Manifest): { js: string; css: string } {
  if (m.schema === 3) {
    return {
      js: joinUrl(m.shell.assetBase, m.shell.js),
      css: joinUrl(m.shell.assetBase, m.shell.css ?? ""),
    };
  }
  const entry = m.schema === 1 ? m.entry : m.shell;
  return {
    js: joinUrl(m.assetBase, entry.js),
    css: joinUrl(m.assetBase, entry.css),
  };
}

/** Every sub-app's absolute URLs, for the shell to fetch on demand. */
export function appUrls(m: Manifest): Record<string, { js: string; css?: string }> {
  if (m.schema === 1) return {};
  if (m.schema === 3) {
    return Object.fromEntries(Object.entries(m.apps).map(([name, a]) => [name, unitUrls(a)]));
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

export function renderShell(m: Manifest, target: Target): string {
  const { js, css } = assetUrls(m);
  const imports = importMap(m);
  const apps = appUrls(m);

  // The import map must be parsed before any module script runs.
  const importMapTag = Object.keys(imports).length
    ? `\n    <script type="importmap">${jsonBlock({ imports })}</script>`
    : "";
  const appsTag = Object.keys(apps).length
    ? `\n    <script type="application/json" id="__APPS__">${jsonBlock(apps)}</script>`
    : "";

  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>pointer-deploy</title>
    <link rel="stylesheet" href="${attr(css)}" />${importMapTag}
  </head>
  <body>
    <div id="app"></div>
    <script type="application/json" id="__BUILD__">${jsonBlock(buildInfo(m, target))}</script>${appsTag}
    <script type="module" src="${attr(js)}"></script>
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
    },
  });
}
