// A picture of what a channel is serving, and proof of which composition it is
// a picture of.
//
//   bun run shoot                      # qa, every view, into a new record
//   bun run shoot --note "step 0: the frame, five routes, three empty"
//   bun run shoot --override hello=3bba892b               # a build nobody promoted
//
// A screenshot is the only record of what a deploy LOOKED like, and it is the
// one record that can be wrong without anything saying so. The store's pointer
// is overwritten by the next promote, its history is 20 deep, dist/ is
// gitignored, and the object store was rewritten whole on 2026-09-10.
//
// THE TRAP THIS EXISTS TO CLOSE. MANIFEST_TTL_MS is 10 s and TODO §6 captured
// an x-manifest-age of 27464 ms, so a shot taken straight after a promote shows
// the composition from BEFORE it, and nothing on the image says which one it
// is. An archive of confidently wrong pictures is worse than no archive,
// because it is trusted.
//
// So every shot is gated. Each view is a fresh navigation, the __BUILD__ block
// is read FROM THE PAGE THAT WAS SHOT - not from a second load, which a promote
// landing between the two would make disagree - and both the unit ids in it and
// the instant it was composed at must equal what the store's pointer names.
// Views are shot until they all agree with each other as well, so a promote
// mid-run cannot leave one record holding two compositions.
//
// The stamp is half of that gate because the ids are not enough: promoting the
// ids a channel already serves - the check an operator runs, and the one that
// verified the promote record - moves composedAt and moves no id at all, so on
// ids alone the page from before that promote and the page from after it are
// the same reading. servesWanted in scripts/record.ts is where both halves are.
//
// WHAT THE GATE DOES NOT COVER, and the record says so rather than implying
// otherwise. The gate proves the COMPOSITION the page was built from. It does
// not prove the pixels: the panels draw what the service answered, /service
// draws a wall clock, and the renderer is whatever Chrome this machine had. So
// apiBase, the renderer and that sentence are written into shots.json beside
// the ids. A reader comparing two records can then see which of those moved,
// rather than take a difference for a change in the code.
//
// NOT REGENERABLE, on purpose. A picture of what was served on a date is
// falsified by re-shooting it, so a run REFUSES a directory that already holds
// a record. There is no --update, and --out is not one either.
//
// THE OTHER HALF OF THE RECORD. A promote to a real channel writes
// deploys/<composedAt>-<channel>/ - the act, and the pointer bytes it put - and
// prints the `--out <dir>` line that fills the pictures in. The directory is
// named by recordDir, which is the same function this file names its own by, and
// a promote writes no shots.json, which is the only file a second run into a
// directory refuses on. What a run into one DOES check is that the pointer still
// names that promote: the gates below are about the pointer as it is now, so
// without filedUnderRefusal a later promote would be shot correctly and filed
// under the earlier promote's record.
//
// --override shoots §30's query string: a composition that was published and
// never promoted, which is what a pull request has. It lands in previews/ and
// never in deploys/, and that is a refusal in scripts/record.ts rather than a
// convention. The gate does not weaken - the expectation becomes the pointer
// with the override laid over it, exactly as the origin composes it.
//
// Everything here that can be decided without a browser is in scripts/record.ts
// and is covered by scripts/record.test.ts.

import { chromium, type Browser, type Page } from "playwright-core";
import { REGIONS, type Region } from "./regions.ts";
import {
  describeIds,
  filedUnderRefusal,
  idsOf,
  outRefusal,
  overrideRefusal,
  pointerIds,
  recordDir,
  sameIds,
  servesWanted,
  type BuildBlock,
} from "./record.ts";

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
  /** The heading the page drew, read from the page and not from this tree. */
  title: string;
  /** Unit name to unit id, read from the page this shot was taken of. */
  units: Record<string, string>;
  /** Panels that rendered their error state. A true reading, not a failure. */
  panelErrors: string[];
  /** Where the page was told to find the service. The highest-variance input. */
  apiBase: string;
  contract: string | null;
  composedAt: string | null;
  waitedMs: number;
  bytes: Uint8Array;
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
 * has nothing to compare against. The override IS the expectation here - a shot
 * has to show the ids that were asked for - and a unit left out keeps following
 * the channel, so a preview of one sub-app is that sub-app against what qa
 * serves today.
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

const kind = Object.keys(override).length ? ("preview" as const) : ("deploy" as const);

/**
 * The query string every view is opened with.
 *
 * On every route, not only the first. The shell's router pushes state without
 * it - `history.pushState(null, "", path)` in router.ts drops a query - so a
 * shot taken after navigating in the page would be of the channel's own
 * composition, correctly, and filed under the override's ids.
 */
const QUERY =
  kind === "preview"
    ? `?${Object.entries(override).map(([n, id]) => `${n}=${id}`).join("&")}`
    : "";

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

/**
 * What one region's pointer names, and when that composition was composed.
 *
 * The stamp comes back with the ids because a promote of the SAME ids moves it
 * and moves nothing else - which is the state filedUnderRefusal reads to tell a
 * shot of this promote from a shot of the next one.
 */
async function pointerFor(
  region: Region,
): Promise<{ ids: Record<string, string>; composedAt: string | null } | null> {
  const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${region}/${channel}.json`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) return null;
  const doc = (await res.json()) as { composedAt?: string };
  const ids = pointerIds(doc);
  return ids === null ? null : { ids, composedAt: doc.composedAt ?? null };
}

/** The bytes of one region's pointer, exactly as the store holds them. */
async function pointerBytes(region: Region): Promise<string | null> {
  const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${region}/${channel}.json`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  return res.ok ? res.text() : null;
}

/**
 * The routes the DEPLOYED shell has, read from the nav it drew.
 *
 * Not from VIEWS in this working tree. The shell owns placement and the shell
 * being shot is the deployed one, so a branch that adds a route would otherwise
 * ask the origin for a path its shell has never heard of - and Shell.tsx:103
 * falls back to DEFAULT_ROUTE without a word, so the run died on a bare
 * selector timeout twenty seconds later. Every step in PLAN.md that adds a view
 * is that case.
 */
async function routesOnPage(page: Page): Promise<string[]> {
  return page.evaluate(() =>
    [...document.querySelectorAll("nav a[href]")]
      .map((a) => a.getAttribute("href") ?? "")
      .filter((href) => href.startsWith("/")),
  );
}

/**
 * Wait until this view has finished drawing itself, and say what it drew.
 *
 * Three conditions, and the third is the one a screenshot needs most: the
 * panels are on screen before the service has answered, by design, so a shot
 * taken at the second condition is a picture of the page's DEFAULTS.
 * `data-api` is set once that fill has settled, either way.
 *
 * The second condition is read from the page as well: every panel the DEPLOYED
 * shell placed is either mounted or in its error state. A panel still loading
 * after the timeout is named, rather than arriving as a selector that never
 * matched anything.
 */
async function settle(page: Page): Promise<{ title: string; panelErrors: string[] }> {
  await page.waitForSelector("div[data-unit-marker]", { timeout: 20_000 });

  try {
    await page.waitForFunction(
      () => document.querySelectorAll("[data-app-loading]").length === 0,
      undefined,
      { timeout: 20_000 },
    );
  } catch {
    const stuck = await page.evaluate(() =>
      [...document.querySelectorAll("[data-app-loading]")].map(
        (el) => el.getAttribute("data-app-loading") ?? "?",
      ),
    );
    throw new Error(`panels never finished loading: ${stuck.join(", ")}`);
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

  return page.evaluate(() => ({
    title: document.querySelector("main h2")?.textContent ?? "",
    panelErrors: [...document.querySelectorAll("[data-app-error]")].map(
      (el) => el.getAttribute("data-app-error") ?? "?",
    ),
  }));
}

/**
 * One view, shot only once the page serving it names the wanted composition.
 *
 * The order inside the loop is the whole gate: navigate, read the ids off THAT
 * page, and only then settle and shoot it. Reading the ids after the shot would
 * leave a window a promote fits inside.
 */
async function shootView(
  page: Page,
  route: string,
  want: Record<string, string>,
  composedAt: string | null,
): Promise<Shot> {
  const started = Date.now();
  let seen = "nothing";

  for (;;) {
    await page.goto(`${origin}${route}${QUERY}`, { waitUntil: "domcontentloaded" });
    const block = await buildBlock(page);

    if (block) {
      const ids = idsOf(block);
      seen = `${describeIds(ids)} at ${block.publishedAt ?? "no stamp"}`;
      if (servesWanted(block, want, composedAt)) {
        const { title, panelErrors } = await settle(page);
        const bytes = await page.screenshot({ fullPage: true, type: "png" });
        return {
          route,
          file: `${fileFor(route)}.png`,
          title,
          units: ids,
          panelErrors,
          // Read off the same block as the ids. Taking these from the first
          // page load instead put the PREVIOUS deploy's contract and date
          // beside the new deploy's ids whenever a promote landed mid-run.
          apiBase: block.apiBase ?? "",
          contract: block.contract ?? null,
          composedAt: block.publishedAt ?? null,
          waitedMs: Date.now() - started,
          bytes: new Uint8Array(bytes),
        };
      }
    }

    if (Date.now() - started > waitMs) {
      // A refused composition renders no __BUILD__ at all - the origin answers
      // 400 with the refusal as text - so the body is the reading, not "nothing".
      const body =
        seen === "nothing" ? (await page.evaluate(() => document.body.innerText)).slice(0, 200) : "";
      throw new Error(
        `${route} still served ${seen}${body ? ` (${body})` : ""} after ${waitMs} ms; ` +
          `this run asked for ${describeIds(want)} at ${composedAt ?? "no stamp"}. Nothing was ` +
          `written: a shot of one composition filed under another is the error this refuses.`,
      );
    }
    await Bun.sleep(1000);
  }
}

const fileFor = (route: string): string => route.replace(/^\//, "").replace(/\//g, "-") || "root";

// -- the run ------------------------------------------------------------------

let browser: Browser | null = null;

try {
  const takenAt = new Date();
  // recordDir, not a spelling of its own: `promote` names the directory it
  // writes with the same function and then prints `--out <dir>` for this run,
  // so two spellings would be two directories for one deploy.
  const out = flag("--out") ?? recordDir(kind, takenAt.toISOString(), channel);

  const misplaced = outRefusal(out, kind);
  if (misplaced) throw new Error(misplaced);

  // Nothing regenerates a shot. A record already in that directory is a record
  // of what was served on the day it was taken, and re-shooting it would keep
  // the date and replace the evidence.
  if (await Bun.file(`${out}/shots.json`).exists()) {
    throw new Error(
      `${out}/shots.json already exists. A picture of what was served on a date is ` +
        `falsified by re-shooting it, so this refuses rather than replacing it. Shoot ` +
        `into a new directory, or delete that one deliberately.`,
    );
  }

  // Which region answers is Fly's choice - iad is stopped under
  // auto_stop_machines - so the region is read off the page rather than
  // assumed, and the pointer compared is the one that machine reads.
  browser = await chromium.launch({ channel: "chrome", headless: true });
  const renderer = `chrome ${browser.version()}`;
  const page = await browser.newPage({ viewport: VIEWPORT, deviceScaleFactor: 1 });

  await page.goto(`${origin}/`, { waitUntil: "domcontentloaded" });
  const first = await buildBlock(page);
  if (!first) throw new Error(`${origin}/ served no __BUILD__ block, so nothing can say what it is.`);

  const region = first.region as Region;
  if (!(REGIONS as readonly string[]).includes(region)) {
    throw new Error(
      `the page reports region ${JSON.stringify(region)}, which is not one of ${REGIONS.join(", ")}.`,
    );
  }
  if (first.channel !== channel) {
    throw new Error(`${origin} serves channel ${first.channel}, and this run asked for ${channel}.`);
  }

  const pointer = await pointerFor(region);
  if (!pointer) {
    throw new Error(`no pointer at ${MANIFEST_BASE}/${region}/${channel}.json, so no shot can be checked.`);
  }

  const refused = overrideRefusal(override, pointer.ids, channel);
  if (refused) throw new Error(refused);

  // The other half of --out into a promote's record. Every gate below is about
  // the pointer as it is NOW, so a promote landing between that promote and
  // this run would be shot correctly and filed under the earlier one - and the
  // manifest bytes in that directory, the one thing in it nothing else can
  // restate, would be overwritten with the later pointer's.
  const promoted = (await Bun.file(`${out}/promote.json`)
    .json()
    .catch(() => null)) as {
    channel: string;
    composedAt: string;
    units: Record<string, { unitId: string | null }>;
    regions?: readonly string[];
  } | null;
  const misfiled = filedUnderRefusal(promoted, channel, pointer, out);
  if (misfiled) throw new Error(misfiled);

  // A unit the override does not name keeps following the channel, which is the
  // server's rule and not a convenience here: currentIds is the base and only a
  // named unit is replaced.
  const want = { ...pointer.ids, ...override };

  const routes = await routesOnPage(page);
  if (routes.length === 0) {
    throw new Error(`${origin}/ drew no navigation, so nothing here can say which views it has.`);
  }

  console.log(`${origin} -> ${channel} in ${region}, ${renderer}`);
  console.log(`pointer names ${describeIds(pointer.ids)}`);
  if (QUERY) console.log(`asking for  ${describeIds(want)}`);
  console.log(`views       ${routes.join(" ")}`);

  const shots: Shot[] = [];
  for (const route of routes) {
    const shot = await shootView(page, route, want, pointer.composedAt);
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
  const after = await pointerFor(region);
  if (!after || !sameIds(after.ids, pointer.ids) || after.composedAt !== pointer.composedAt) {
    throw new Error(
      `the pointer moved during this run: ${describeIds(pointer.ids)} at ${pointer.composedAt} -> ` +
        `${after ? `${describeIds(after.ids)} at ${after.composedAt}` : "absent"}. ` +
        `Nothing was written; shoot again.`,
    );
  }

  // -- the record, written only now -------------------------------------------

  for (const shot of shots) {
    await Bun.write(`${out}/shots/${shot.file}`, shot.bytes);
  }

  // Every region's pointer, as bytes. They should agree - promote refuses a
  // write that would make them drift, §3 - and a record that keeps both is how
  // a reader can check that rather than take it.
  const pointers: Record<string, string | null> = {};
  for (const r of REGIONS) {
    const text = await pointerBytes(r);
    if (text === null) {
      pointers[r] = null;
      continue;
    }
    // A file a promote already wrote is the bytes it PUT. This is the same
    // question asked of the store afterwards, and for a region THIS promote
    // did not write - `--region eu` leaves the other region where it was - the
    // answer is a different deploy's pointer. So it never overwrites the
    // promote's file, and where there is none it is filed under a name that
    // says which reading it is. A record whose two manifests look alike and
    // mean different things is the §3 drift written down as though it were one
    // deploy.
    const put = `manifest.${r}.json`;
    const asServed = `manifest.${r}.as-served.json`;
    const fromPromote = await Bun.file(`${out}/${put}`).exists();
    pointers[r] = fromPromote ? put : asServed;
    if (!fromPromote) await Bun.write(`${out}/${asServed}`, text);
  }

  const last = shots[shots.length - 1]!;
  const record = {
    schema: 2,
    takenAt: takenAt.toISOString(),
    kind,
    channel,
    region,
    origin,
    override: kind === "preview" ? override : null,
    contract: last.contract,
    composedAt: last.composedAt,
    units: shots[0]!.units,
    gate: "pointer" as const,
    // What the gate does NOT cover, named rather than left for a reader to find
    // by diffing two images. Each is an input to the pixels that no unit id
    // decides.
    unchecked: {
      apiBase: last.apiBase,
      renderer,
      note: "the panels draw what the service answered, and /service draws the time it read. Neither is a function of the unit ids.",
    },
    viewport: VIEWPORT,
    manifests: pointers,
    shots: shots.map(({ route, file, title, units, panelErrors, waitedMs }) => ({
      route,
      file: `shots/${file}`,
      title,
      units,
      panelErrors,
      waitedMs,
    })),
  };
  await Bun.write(`${out}/shots.json`, `${JSON.stringify(record, null, 2)}\n`);

  // A preview's line is the pull request body, so it gets no notes.md: two
  // places to write one line is one place that goes stale.
  if (kind === "deploy") {
    await Bun.write(
      `${out}/notes.md`,
      `${note || "TODO: one line saying what this deploy demonstrates."}\n\n` +
        `Written by hand. The first line is the entry in the changelog, so it says what\n` +
        `this promote demonstrates rather than what it changed - the ids beside it already\n` +
        `say what changed.\n`,
    );
  }

  console.log(`\n${out}`);
  console.log(`  ${shots.length} shots, ${describeIds(shots[0]!.units)}, contract ${last.contract ?? "?"}`);
  if (!note && kind === "deploy") console.log(`  notes.md needs its first line.`);
} catch (err) {
  console.error(`\nFAILED ${err instanceof Error ? err.message : String(err)}`);
  process.exitCode = 1;
} finally {
  await browser?.close();
}
