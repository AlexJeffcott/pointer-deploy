// Builds the application shell from a manifest. The only templating the
// server does.

import type { Manifest } from "./manifest.ts";
import type { Target } from "./origins.ts";

export type BuildInfo = {
  buildId: string;
  commit: string;
  publishedAt: string;
  channel: string;
  region: string;
};

export function buildInfo(m: Manifest, target: Target): BuildInfo {
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

export function assetUrls(m: Manifest): { js: string; css: string } {
  return {
    js: joinUrl(m.assetBase, m.entry.js),
    css: joinUrl(m.assetBase, m.entry.css),
  };
}

export function renderShell(m: Manifest, target: Target): string {
  const { js, css } = assetUrls(m);
  return `<!doctype html>
<html lang="en-GB">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>pointer-deploy</title>
    <link rel="stylesheet" href="${attr(css)}" />
  </head>
  <body>
    <div id="app"></div>
    <script type="application/json" id="__BUILD__">${jsonBlock(buildInfo(m, target))}</script>
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
