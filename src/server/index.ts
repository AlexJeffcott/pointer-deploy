// The whole server. Routing and templating; nothing else.
//
// It holds no application files. Every script and stylesheet a visitor loads
// comes from the store, named by the manifest the channel points at. That is
// why this image is rebuilt when the server changes and not when the
// application changes.

import { createManifestStore, manifestUrl } from "./manifest.ts";
import { hostTable, resolveRegion, resolveTarget } from "./origins.ts";
import { shellResponse } from "./html.ts";

const PORT = Number(Bun.env.PORT ?? 3000);
const MANIFEST_BASE = Bun.env.MANIFEST_BASE ?? "";
const IS_PRODUCTION = Bun.env.NODE_ENV === "production";

if (!MANIFEST_BASE) {
  console.error("MANIFEST_BASE is not set. The server has nothing to serve.");
  process.exit(1);
}

const REGION = resolveRegion(Bun.env.FLY_REGION);
const TABLE = hostTable(IS_PRODUCTION);
const manifests = createManifestStore();

const text = (body: string, status: number) =>
  new Response(body, {
    status,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
    },
  });

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",

  async fetch(req) {
    const { pathname } = new URL(req.url);

    // Deliberately reads no manifest. If health depended on the store, a store
    // outage would make the platform kill machines that were serving visitors
    // correctly, turning a degraded state into a full outage.
    if (pathname === "/healthz") return text("ok", 200);

    if (req.method !== "GET" && req.method !== "HEAD") {
      return text("method not allowed", 405);
    }

    // The server has no application files. Anything asking it for one is
    // asking the wrong host, and saying so beats serving a stale copy.
    if (pathname === "/assets" || pathname.startsWith("/assets/")) {
      return text("not found", 404);
    }

    const target = resolveTarget(req.headers.get("host"), TABLE, REGION);
    // Fails closed. An unknown host must never fall back to a channel.
    if (!target) return text("not found", 404);

    const manifest = await manifests.get(
      manifestUrl(MANIFEST_BASE, target.region, target.channel),
    );
    if (!manifest) {
      return text("the application manifest is not available", 503);
    }

    return shellResponse(manifest, target);
  },

  error(err) {
    console.error(err);
    return text("internal server error", 500);
  },
});

console.log(
  `pointer-deploy listening on http://${server.hostname}:${server.port} ` +
    `region=${REGION} manifests=${MANIFEST_BASE}`,
);
