// The whole server. Routing and templating; nothing else.
//
// It holds no application files. Every script and stylesheet a visitor loads
// comes from the store, named by the manifest the channel points at. That is
// why this image is rebuilt when the server changes and not when the
// application changes.

import {
  compose,
  currentIds,
  historyUrl,
  optionsFor,
  parseHistory,
  refuseComposition,
  switcherChannels,
  type ChannelHistory,
} from "./composition.ts";
import { createDocumentStore, createManifestStore, manifestUrl } from "./manifest.ts";
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

/** Empty unless an operator names a channel. See switcherChannels. */
const SWITCHER_CHANNELS = switcherChannels(Bun.env.VERSION_SWITCHER_CHANNELS);

// The same rules as the manifest, over a different document. A visitor waits
// for neither, and a store outage costs neither its last good value.
const histories = createDocumentStore<ChannelHistory>(parseHistory, { label: "history" });

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

    const url = manifestUrl(MANIFEST_BASE, target.region, target.channel);
    const manifest = await manifests.get(url);
    if (!manifest) {
      return text("the application manifest is not available", 503);
    }

    // The version switcher, when this channel has one.
    //
    // Everything here fails to the ordinary page. A channel that is not named,
    // a manifest older than schema 3, a history that is absent or unreadable:
    // each one leaves `versions` undefined and the visitor gets exactly what
    // the pointer names, which is what they would have got before this existed.
    let served = manifest;
    let versions: Record<string, ReturnType<typeof optionsFor>[string]> | undefined;
    if (SWITCHER_CHANNELS.has(target.channel) && manifest.schema === 3) {
      const history = await histories.get(historyUrl(MANIFEST_BASE, target.region, target.channel));
      if (history) {
        const wanted = new URL(req.url).searchParams;
        const ids = currentIds(manifest);
        // Only keys that name a unit of THIS composition. An unrecognised
        // parameter is left alone rather than refused: a page carrying somebody
        // else's tracking parameter must still render.
        const chosen: Record<string, string> = { ...ids };
        let overridden = false;
        for (const unit of Object.keys(ids)) {
          const asked = wanted.get(unit);
          if (asked !== null && asked !== ids[unit]) {
            chosen[unit] = asked;
            overridden = true;
          }
        }

        // Validated only when something was actually asked for. A visitor who
        // asked for nothing must never be refused, however stale the history.
        if (overridden) {
          const refusal = refuseComposition(history, chosen);
          if (refusal) return text(`that composition cannot be served: ${refusal}`, 400);
          served = compose(manifest, history, chosen);
        }
        versions = optionsFor(history, chosen, ids);
      }
    }

    // What this page was assembled from, said out loud.
    //
    // A pointer deploy has one failure nobody outside the process can see: the
    // channel moved and this origin is still serving the composition before
    // it. The page looks correct, every check is green, and the only reading
    // anyone had was "the deploy has not arrived yet" - which is also what a
    // deploy that will never arrive looks like. The age separates a manifest
    // that is one TTL behind from one that has stopped being refreshed, and
    // the refresh line names the store's own error when there is one.
    const state = manifests.stateOf(url);
    const res = shellResponse(served, target, versions);
    res.headers.set("x-manifest-age", state.ageMs === null ? "never" : String(state.ageMs));
    res.headers.set("x-manifest-refresh", state.lastError ?? "ok");
    return res;
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
