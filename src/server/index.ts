import {
  apiRefusal,
  blockRefusal,
  catalogueUrl,
  compose,
  currentIds,
  historyUrl,
  mergeKnown,
  optionsFor,
  parseHistory,
  refuseComposition,
  surfaceOf,
  type Catalogue,
  type ChannelHistory,
  type UnitSurface,
} from "./composition.ts";
import { createDocumentStore, createManifestStore, manifestUrl } from "./manifest.ts";
import { hostTable, resolveRegion, resolveTarget } from "./origins.ts";
import { shellResponse } from "./html.ts";
import { blocksWritten } from "./provides.ts";
import { createServedLog } from "./served.ts";
import { apiVersionsUrl, parseApiVersions } from "./apiversions.ts";

const PORT = Number(Bun.env.PORT ?? 3000);
const MANIFEST_BASE = Bun.env.MANIFEST_BASE ?? "";
const API_BASE = Bun.env.API_BASE ?? "";
const IS_PRODUCTION = Bun.env.NODE_ENV === "production";

if (!MANIFEST_BASE) {
  console.error("MANIFEST_BASE is not set. The server has nothing to serve.");
  process.exit(1);
}

const REGION = resolveRegion(Bun.env.FLY_REGION);
const TABLE = hostTable(IS_PRODUCTION);
const manifests = createManifestStore();

const histories = createDocumentStore<ChannelHistory>(parseHistory, { label: "history" });

// Every published unit, not only the ones this channel has served. It is read
// through the history's own parser because a catalogue IS a history whose scope
// is the store, §25.
const catalogues = createDocumentStore<Catalogue>(parseHistory, { label: "catalogue" });
const CATALOGUE_URL = catalogueUrl(MANIFEST_BASE);

const BLOCKS = await blocksWritten();

const apiVersions = API_BASE
  ? createDocumentStore<string[]>(parseApiVersions, { label: "api versions" })
  : null;

const handedOut = createServedLog();

const json = (body: unknown) =>
  new Response(JSON.stringify(body, null, 2), {
    status: 200,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });

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

    if (pathname === "/healthz") return text("ok", 200);

    if (req.method !== "GET" && req.method !== "HEAD") {
      return text("method not allowed", 405);
    }

    if (pathname === "/compositions") return json(handedOut.read());

    // The bucket answers no LIST to a browser and no LIST to a script without a
    // key, so the one object that stands for that LIST is served here. A script
    // reads it from the store directly; the page reads it from its own origin,
    // which is why the policy needs no store host in connect-src.
    if (pathname === "/units") {
      const catalogue = await catalogues.get(CATALOGUE_URL);
      if (!catalogue) return text("the unit catalogue is not available", 503);
      return json(catalogue);
    }

    if (pathname === "/assets" || pathname.startsWith("/assets/")) {
      return text("not found", 404);
    }

    const target = resolveTarget(req.headers.get("host"), TABLE, REGION);
    if (!target) return text("not found", 404);

    const url = manifestUrl(MANIFEST_BASE, target.region, target.channel);
    const manifest = await manifests.get(url);
    if (!manifest) {
      return text("the application manifest is not available", 503);
    }

    let served = manifest;
    let versions: Record<string, ReturnType<typeof optionsFor>[string]> | undefined;
    let shellSurface: UnitSurface | undefined;
    let overridden = false;
    const serves = (API_BASE ? apiVersions?.peek(apiVersionsUrl(API_BASE)) : null) ?? undefined;
    if (manifest.schema === 3) {
      const channelHistory = histories.peek(historyUrl(MANIFEST_BASE, target.region, target.channel));
      // What this channel has served, plus every published build. `peek` never
      // makes a visitor wait on the store, so a catalogue that is not there yet
      // costs the switcher entries and costs the page nothing.
      //
      // The suite's own channels take a build the harness made; a real channel
      // does not, which is the rule `promote` applies at deploy time applied
      // again where a visitor chooses.
      const history =
        channelHistory === null
          ? null
          : mergeKnown(
              channelHistory,
              catalogues.peek(CATALOGUE_URL),
              target.channel.startsWith("test-"),
            );
      if (history) {
        const wanted = new URL(req.url).searchParams;
        const ids = currentIds(manifest);
        const chosen: Record<string, string> = { ...ids };
        for (const unit of Object.keys(ids)) {
          const asked = wanted.get(unit);
          if (asked !== null && asked !== ids[unit]) {
            chosen[unit] = asked;
            overridden = true;
          }
        }

        if (overridden) {
          const refusal = refuseComposition(history, chosen, BLOCKS, serves);
          if (refusal) return text(`that composition cannot be served: ${refusal}`, 400);
          served = compose(manifest, history, chosen);
        }
        versions = optionsFor(history, chosen, ids, BLOCKS, serves);
        shellSurface = surfaceOf(history, "shell", chosen.shell ?? ids.shell ?? "");
      }
    }

    const state = manifests.stateOf(url);
    const res = shellResponse(served, target, versions, API_BASE);
    res.headers.set("x-manifest-age", state.ageMs === null ? "never" : String(state.ageMs));
    res.headers.set("x-manifest-refresh", state.lastError ?? "ok");
    const blocks = blockRefusal(BLOCKS, shellSurface);
    res.headers.set("x-shell-blocks", blocks === undefined ? "unread" : (blocks ?? "ok"));
    const api = apiRefusal(serves, shellSurface);
    res.headers.set("x-shell-api", api === undefined ? "unread" : (api ?? "ok"));

    handedOut.record({
      channel: target.channel,
      region: target.region,
      buildId: served.schema === 3 ? served.shell.unitId : served.buildId,
      units: served.schema === 3 ? currentIds(served) : {},
      contract: served.schema === 3 ? served.contract : null,
      overridden,
    });
    return res;
  },

  error(err) {
    console.error(err);
    return text("internal server error", 500);
  },
});

console.log(
  `pointer-deploy listening on http://${server.hostname}:${server.port} ` +
    `region=${REGION} manifests=${MANIFEST_BASE} api=${API_BASE || "none"}`,
);
