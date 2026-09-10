// A picture of what a channel is serving, and proof of which composition it is
// a picture of.
//
//   bun run shoot                      # qa, every view, into a new record
//   bun run shoot --note "step 0: the frame, five routes, three empty"
//   bun run shoot --out deploys/2026-09-14T10-22-00Z-qa   # fill a record promote made
//   bun run shoot --override hello=3bba892b               # a build nobody promoted
//
// A screenshot is the only record of what a deploy LOOKED like, and it is the
// one record that can be wrong without anything saying so. The store's pointer
// is overwritten by the next promote, its history is 20 deep, and dist/ is
// gitignored - so git holds nothing about what has been served, and the store
// was already rewritten once, on 2026-09-10.
//
// THE TRAP THIS EXISTS TO CLOSE. MANIFEST_TTL_MS is 10 s and TODO §6 captured
// an x-manifest-age of 27464 ms, so a shot taken straight after a promote shows
// the composition from BEFORE it, and nothing on the image says which one it
// is. An archive of confidently wrong pictures is worse than no archive,
// because it is trusted.
//
// So every shot is gated. Each view is a fresh navigation, the __BUILD__ block
// is read FROM THE PAGE THAT WAS SHOT - not from a second load, which a promote
// landing between the two would make disagree - and the unit ids in it must
// equal the ones the store's pointer names. Views are shot until they all agree
// with each other as well, so a promote mid-run cannot leave one record holding
// two compositions.
//
// Nothing is written until every shot has passed. A partial record would be a
// record that has to be read carefully, and this is the one file a reader is
// entitled to trust without reading anything else.
//
// NOT REGENERABLE, on purpose. A picture of what was served on a date is
// falsified by re-shooting it. There is no --update, and there should not be.
//
// --override shoots §30's query string: a composition that was published and
// never promoted, which is what a pull request has. It lands in previews/ and
// not deploys/, because deploys/ is the archive of what was SERVED and a
// preview never was. The gate does not weaken - the expectation becomes the
// pointer with the override laid over it, exactly as the origin composes it.

import { chromium, type Browser, type Page } from "playwright-core";
import { VIEWS } from "../src/web/shell/views.ts";
import { REGIONS, type Region } from "./regions.ts";

/** The channels a browser can reach. */
const ORIGINS: Record<string, string> = {
  qa: Bun.env.LIVE_ADDRESS ?? "https://pointer-deploy.fly.dev",
};

// Why prod is not in that table: it is reached by a Host header, and no browser
// can be made to send one - Host is forbidden to setExtraHTTPHeaders, and Fly
// routes on SNI, so a resolver override cannot supply it either. The same
// reason scripts/e2e-independent-deploy.ts runs its browser half locally.
// TODO §2 - a domain and a certificate - is what puts prod in here.
const UNREACHABLE =
  "prod has no hostname a browser can reach: Host is forbidden to " +
  "setExtraHTTPHeaders and Fly routes on SNI, so nothing here can ask for it. " +
  "TODO §2 is the domain and the certificate that would.";

const MANIFEST_BASE =
  Bun.env.MANIFEST_BASE ?? "https://pointer-deploy-assets.fly.storage.tigris.dev/manifests";

/** The store's 5 s pointer cache, the server's 10 s TTL, and room for §6's 27 s. */
const PROPAGATION_MS = 45_000;

const VIEWPORT = { width: 1280, height: 800 };

/** What a shot is a picture of. Written beside it, and checked before it is. */
type Shot = {
  route: string;
  file: string;
  /** Unit name to unit id, read from the page this shot was taken of. */
  units: Record<string, string>;
  /** Panels that rendered their error state. A true reading, not a failure. */
  panelErrors: string[];
  /** How long the gate waited for this view to serve the pointer's composition. */
  waitedMs: number;
  bytes: Uint8Array;
};

type BuildBlock = {
  channel: string;
  region: string;
  contract?: string;
  publishedAt?: string;
  apiBase?: string;
  units?: Record<string, { unitId: string; commit: string; marker: string }>;
};

// -- what was asked for -------------------------------------------------------

const argv = process.argv.slice(2);

const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};

const usage = () => {
  console.error("usage: bun run shoot [--channel qa] [--note <text>] [--out <dir>] [--wait <ms>]");
  console.error("       bun run shoot --override <unit>=<id>[,<unit>=<id>...]  # a composition nobody promoted");
  console.error(`       channels a browser can reach: ${Object.keys(ORIGINS).join(", ")}`);
};

const channel = flag("--channel") ?? "qa";
const note = flag("--note") ?? "";
const waitMs = Number(flag("--wait") ?? PROPAGATION_MS);

/**
 * Units this run asks the origin for by name, instead of taking the pointer's.
 *
 * §30's query string, and it is what makes a pull request's build shootable: it
 * was published and nothing promoted it, so no pointer names it and the gate
 * has nothing to compare against. The override IS the expectation here - a
 * shot has to show the ids that were asked for - and a unit left out keeps
 * following the channel, so a preview of one sub-app is that sub-app against
 * what qa serves today.
 */
const override: Record<string, string> = {};
for (const pair of (flag("--override") ?? "").split(",").filter(Boolean)) {
  const [name, id] = pair.split("=");
  if (!name || !id) {
    console.error(`--override takes <unit>=<id> pairs, got ${JSON.stringify(pair)}`);
    process.exit(1);
  }
  override[name] = id;
}

for (let i = 0; i < argv.length; i++) {
  const arg = argv[i]!;
  if (["--channel", "--note", "--out", "--wait", "--override"].includes(arg)) {
    i++;
  } else {
    console.error(`unexpected argument ${JSON.stringify(arg)}`);
    usage();
    process.exit(1);
  }
}

if (!Number.isFinite(waitMs) || waitMs <= 0) {
  console.error(`--wait takes milliseconds, got ${JSON.stringify(flag("--wait") ?? "")}`);
  process.exit(1);
}

const origin = ORIGINS[channel];
if (!origin) {
  console.error(channel === "prod" ? UNREACHABLE : `unknown channel ${JSON.stringify(channel)}.`);
  usage();
  process.exit(1);
}

// -- reading the page ---------------------------------------------------------

/**
 * The __BUILD__ block of the page currently loaded.
 *
 * Read from the page object rather than by fetching the HTML again. Two loads
 * are two compositions whenever a promote lands between them, and the whole
 * point of this file is that the picture and the ids come from one of them.
 */
async function buildBlock(page: Page): Promise<BuildBlock | null> {
  const text = await page.evaluate(
    () => document.getElementById("__BUILD__")?.textContent ?? "",
  );
  if (!text) return null;
  try {
    return JSON.parse(text) as BuildBlock;
  } catch {
    return null;
  }
}

const idsOf = (block: BuildBlock): Record<string, string> =>
  Object.fromEntries(Object.entries(block.units ?? {}).map(([n, u]) => [n, u.unitId]));

const sameIds = (a: Record<string, string>, b: Record<string, string>): boolean => {
  const names = new Set([...Object.keys(a), ...Object.keys(b)]);
  return [...names].every((n) => a[n] === b[n]);
};

const describeIds = (ids: Record<string, string>): string =>
  Object.entries(ids)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, id]) => `${n}=${id}`)
    .join(" ");

/** What the pointer for one region names. Null when there is no pointer there. */
async function pointerIds(region: Region): Promise<Record<string, string> | null> {
  const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${region}/${channel}.json`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) return null;
  const doc = (await res.json()) as {
    shell?: { unitId?: string };
    apps?: Record<string, { unitId?: string }>;
  };
  const ids: Record<string, string> = {};
  if (doc.shell?.unitId) ids.shell = doc.shell.unitId;
  for (const [name, unit] of Object.entries(doc.apps ?? {})) {
    if (unit.unitId) ids[name] = unit.unitId;
  }
  return ids;
}

/** The bytes of one region's pointer, exactly as the store holds them. */
async function pointerBytes(region: Region): Promise<string | null> {
  const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${region}/${channel}.json`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  return res.ok ? res.text() : null;
}

/**
 * Wait until this view has finished drawing itself.
 *
 * Three conditions, and the third is the one a screenshot needs most: the
 * panels are on screen before the service has answered, by design, so a shot
 * taken at the second condition is a picture of the page's DEFAULTS.
 * `data-api` is set once that fill has settled, either way.
 */
async function settle(page: Page, apps: readonly string[]): Promise<string[]> {
  await page.waitForSelector("div[data-unit-marker]", { timeout: 20_000 });

  const errors: string[] = [];
  for (const app of apps) {
    await page.waitForSelector(`[data-app="${app}"] section, [data-app-error="${app}"]`, {
      timeout: 20_000,
    });
    const failed = await page.$(`[data-app-error="${app}"]`);
    if (failed) errors.push(app);
  }

  await page.waitForFunction(
    () => {
      const el = document.getElementById("__BUILD__");
      const named = el?.textContent
        ? Boolean((JSON.parse(el.textContent) as { apiBase?: string }).apiBase)
        : false;
      return !named || document.documentElement.dataset.api !== undefined;
    },
    undefined,
    { timeout: 20_000 },
  );

  return errors;
}

/**
 * One view, shot only once the page serving it names the pointer's composition.
 *
 * The order inside the loop is the whole gate: navigate, read the ids off THAT
 * page, and only then settle and shoot it. Reading the ids after the shot would
 * leave a window a promote fits inside.
 */
async function shootView(page: Page, route: string, want: Record<string, string>): Promise<Shot> {
  const started = Date.now();
  let seen = "nothing";

  for (;;) {
    await page.goto(`${origin}${route}${QUERY}`, { waitUntil: "domcontentloaded" });
    const block = await buildBlock(page);

    if (block) {
      const ids = idsOf(block);
      seen = describeIds(ids);
      if (sameIds(ids, want)) {
        const panelErrors = await settle(page, VIEWS[route]!.apps);
        const bytes = await page.screenshot({ fullPage: true, type: "png" });
        return {
          route,
          file: `${fileFor(route)}.png`,
          units: ids,
          panelErrors,
          waitedMs: Date.now() - started,
          bytes: new Uint8Array(bytes),
        };
      }
    }

    if (Date.now() - started > waitMs) {
      // A refused composition renders no __BUILD__ at all - the origin answers
      // 400 with the refusal as text - so the body is the reading, not "nothing".
      const body = seen === "nothing" ? (await page.evaluate(() => document.body.innerText)).slice(0, 200) : "";
      throw new Error(
        `${route} still served ${seen}${body ? ` (${body})` : ""} after ${waitMs} ms; ` +
          `this run asked for ${describeIds(want)}. Nothing was written: a shot of one ` +
          `composition filed under another is the error this refuses.`,
      );
    }
    await Bun.sleep(1000);
  }
}

const fileFor = (route: string): string =>
  route.replace(/^\//, "").replace(/\//g, "-") || "root";

/**
 * The query string every view is opened with.
 *
 * On every route, not only the first. The shell's router pushes state without
 * it - `history.pushState(null, "", path)` in router.ts drops a query - so a
 * shot taken after navigating in the page would be of the channel's own
 * composition, correctly, and filed under the override's ids.
 */
const QUERY = Object.keys(override).length
  ? `?${Object.entries(override).map(([n, id]) => `${n}=${id}`).join("&")}`
  : "";

const stamp = (d: Date): string => d.toISOString().replace(/[:.]/g, "-").replace(/-\d{3}Z$/, "Z");

// -- the run ------------------------------------------------------------------

let browser: Browser | null = null;

try {
  // Which region answers is Fly's choice - iad is stopped under
  // auto_stop_machines - so the region is read off the page rather than
  // assumed, and the pointer compared is the one that machine reads.
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  const first = await buildBlock(page);
  if (!first) throw new Error(`${origin}/ served no __BUILD__ block, so nothing can say what it is.`);

  const region = first.region as Region;
  if (!(REGIONS as readonly string[]).includes(region)) {
    throw new Error(`the page reports region ${JSON.stringify(region)}, which is not one of ${REGIONS.join(", ")}.`);
  }
  if (first.channel !== channel) {
    throw new Error(`${origin} serves channel ${first.channel}, and this run asked for ${channel}.`);
  }

  const pointer = await pointerIds(region);
  if (!pointer) throw new Error(`no pointer at ${MANIFEST_BASE}/${region}/${channel}.json, so no shot can be checked.`);

  // A unit the override does not name keeps following the channel, which is the
  // server's rule and not a convenience here: currentIds is the base and only a
  // named unit is replaced. So the expectation is the pointer with the override
  // laid over it, and a run with no override is the pointer itself.
  const unknown = Object.keys(override).filter((n) => !(n in pointer));
  if (unknown.length) {
    throw new Error(
      `--override names ${unknown.join(", ")}, and ${channel} composes ` +
        `${Object.keys(pointer).join(", ")}. The origin ignores a name it does not compose, ` +
        `so this would have shot the channel and filed it as a preview.`,
    );
  }
  const want = { ...pointer, ...override };

  console.log(`${origin} -> ${channel} in ${region}`);
  console.log(`pointer names ${describeIds(pointer)}`);
  if (QUERY) console.log(`asking for  ${describeIds(want)}`);

  const routes = Object.keys(VIEWS);
  const shots: Shot[] = [];
  for (const route of routes) {
    const shot = await shootView(page, route, want);
    shots.push(shot);
    const flagged = shot.panelErrors.length ? `  PANEL ERROR ${shot.panelErrors.join(", ")}` : "";
    console.log(`  ${route.padEnd(12)} ${shot.file.padEnd(14)} ${shot.waitedMs} ms${flagged}`);
  }

  // The last gate. Each shot agreed with the pointer when it was taken; a
  // promote between the first view and the last would let two compositions
  // into one record, each of them correct on its own.
  const drifted = shots.filter((s) => !sameIds(s.units, shots[0]!.units));
  if (drifted.length) {
    throw new Error(
      `this run shot two compositions: ${describeIds(shots[0]!.units)} and ` +
        `${drifted.map((s) => `${s.route} ${describeIds(s.units)}`).join(", ")}. ` +
        `A promote landed mid-run. Nothing was written; shoot again.`,
    );
  }
  const after = await pointerIds(region);
  if (!after || !sameIds(after, pointer)) {
    throw new Error(
      `the pointer moved during this run: ${describeIds(pointer)} -> ` +
        `${after ? describeIds(after) : "absent"}. Nothing was written; shoot again.`,
    );
  }

  // -- the record, written only now -------------------------------------------

  const takenAt = new Date();
  // A preview was never promoted, so it is not a deploy record and does not go
  // in the archive of what was served. Separate directory, separate meaning.
  const kind = QUERY ? "previews" : "deploys";
  const out = flag("--out") ?? `${kind}/${stamp(takenAt)}-${channel}`;

  for (const shot of shots) {
    await Bun.write(`${out}/shots/${shot.file}`, shot.bytes);
  }

  // Every region's pointer, as bytes. They should agree - promote refuses a
  // write that would make them drift, §3 - and a record that keeps both is how
  // a reader can check that rather than take it.
  const pointers: Record<string, string | null> = {};
  for (const r of REGIONS) {
    const text = await pointerBytes(r);
    pointers[r] = text === null ? null : `manifest.${r}.json`;
    if (text !== null) await Bun.write(`${out}/manifest.${r}.json`, text);
  }

  const record = {
    schema: 1,
    takenAt: takenAt.toISOString(),
    channel,
    region,
    origin,
    contract: first.contract ?? null,
    composedAt: first.publishedAt ?? null,
    units: shots[0]!.units,
    kind: QUERY ? ("preview" as const) : ("deploy" as const),
    override: QUERY ? override : null,
    gate: "pointer" as const,
    viewport: VIEWPORT,
    manifests: pointers,
    shots: shots.map(({ route, file, units, panelErrors, waitedMs }) => ({
      route,
      file: `shots/${file}`,
      title: VIEWS[route]!.title,
      apps: VIEWS[route]!.apps,
      units,
      panelErrors,
      waitedMs,
    })),
  };
  await Bun.write(`${out}/shots.json`, `${JSON.stringify(record, null, 2)}\n`);

  // A preview's line is the pull request body, so it gets no notes.md: two
  // places to write one line is one place that goes stale.
  const notes = `${out}/notes.md`;
  if (!QUERY && !(await Bun.file(notes).exists())) {
    await Bun.write(
      notes,
      `${note || "TODO: one line saying what this deploy demonstrates."}\n\n` +
        `Written by hand. The first line is the entry in the changelog, so it says what\n` +
        `this promote demonstrates rather than what it changed - the ids beside it already\n` +
        `say what changed.\n`,
    );
  }

  console.log(`\n${out}`);
  console.log(`  ${shots.length} shots, ${describeIds(shots[0]!.units)}, contract ${first.contract ?? "?"}`);
  if (!note && !QUERY) console.log(`  notes.md needs its first line.`);
} catch (err) {
  console.error(`\nFAILED ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
