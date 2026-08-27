// Points a channel at a composition of published units. This is the deploy. It
// is also the rollback: naming an older unit id is the same operation.
//
// It reads the channel's current composition, applies only the units named on
// the command line, and writes the result. That merge is what makes "deploy
// alpha" leave bravo where it was, and "roll alpha back" leave bravo at its
// newer version.
//
// No image is built and no machine is restarted. The running servers notice
// within their manifest TTL.
//
//   bun run promote qa --app alpha=9b855c4b        # deploy one app
//   bun run promote qa --app alpha=36226fb9        # roll that one app back
//   bun run promote qa --shell 43ca0019            # the shell alone
//   bun run promote qa --from-build                # everything in dist/build.json

import {
  CACHE_POINTER,
  configFromEnv,
  getObjectText,
  putObject,
  urlsInManifest,
  warmUrls,
} from "./store.ts";
import { APPS, UNITS, majorOf, type Unit } from "./contract.ts";
import type { UnitManifest } from "./publish.ts";

// test-prod and test-qa belong to the live acceptance suite. It runs this
// script rather than a stand-in - a stub could pass while the real promote
// path was broken - so the real script has to accept them.
const CHANNELS = ["prod", "qa", "test-prod", "test-qa"] as const;
type Channel = (typeof CHANNELS)[number];

/** One unit inside a channel's composition. */
export type ComposedUnit = {
  unitId: string;
  /** Which commit this unit was built from. Provenance, not identity. */
  commit: string;
  assetBase: string;
  js: string;
  css: string | null;
  imports?: Record<string, string>;
  marker: string;
};

/**
 * What a channel points at.
 *
 * Each unit carries its OWN assetBase. That is the whole difference from the
 * schema before it, where one base was shared and every file had to come from
 * one build directory - which is exactly what made the five bundles move
 * together.
 */
export type Composition = {
  schema: 3;
  composedAt: string;
  /** Which contract the composition resolved at. For diagnosis. */
  contract: string;
  shell: ComposedUnit;
  apps: Record<string, ComposedUnit>;
};

const argv = process.argv.slice(2);
const region = Bun.env.REGION ?? "eu";

const usage = () => {
  console.error("usage: bun run promote <channel> [--shell <id>] [--app <name>=<id>]...");
  console.error("       bun run promote <channel> --from-build");
  console.error(`       channels: ${CHANNELS.join(", ")}`);
  console.error(`       apps:     ${APPS.join(", ")}`);
};

const channelArg = argv[0];
if (!channelArg || channelArg.startsWith("-")) {
  usage();
  process.exit(1);
}
if (!CHANNELS.includes(channelArg as Channel)) {
  console.error(`unknown channel ${JSON.stringify(channelArg)}. Expected one of ${CHANNELS.join(", ")}.`);
  process.exit(1);
}

// -- what the operator asked for --------------------------------------------

const wanted = new Map<Unit, string>();
const fromBuild = argv.includes("--from-build");

for (let i = 1; i < argv.length; i++) {
  const arg = argv[i]!;
  if (arg === "--shell") {
    const id = argv[++i];
    if (!id) { usage(); process.exit(1); }
    wanted.set("shell", id);
  } else if (arg === "--app") {
    const pair = argv[++i];
    const [name, id] = (pair ?? "").split("=");
    if (!name || !id) {
      console.error(`--app takes <name>=<id>, got ${JSON.stringify(pair ?? "")}`);
      process.exit(1);
    }
    if (!APPS.includes(name as (typeof APPS)[number])) {
      console.error(`unknown app ${JSON.stringify(name)}. Expected one of ${APPS.join(", ")}.`);
      process.exit(1);
    }
    wanted.set(name as Unit, id);
  } else if (arg === "--from-build" || arg === "--no-warm") {
    // handled elsewhere
  } else {
    console.error(`unexpected argument ${JSON.stringify(arg)}`);
    usage();
    process.exit(1);
  }
}

if (fromBuild) {
  const built = (await Bun.file("dist/build.json")
    .json()
    .catch(() => null)) as {
    units?: Record<string, { id: string; marker?: string }>;
  } | null;
  if (!built?.units) {
    console.error("--from-build needs dist/build.json. Run `bun run build` first.");
    process.exit(1);
  }

  // dist/ is shared, and `e2e`, `verify:live` and `falsify` all overwrite it
  // with throwaway builds. So --from-build can hand a real channel a harness
  // build minutes after a correct promote, and every check stays green because
  // the manifest it wrote is well-formed - it just describes the wrong units.
  //
  // A marker is the tell. It is empty unless BUILD_MARKER or BUILD_MARKER_<UNIT>
  // was set, and only the harnesses set those. Marked builds belong on the
  // test-* channels, which is where the suites promote them.
  const marked = UNITS.filter((u) => (built.units![u]?.marker ?? "") !== "");
  if (marked.length > 0 && !channelArg.startsWith("test-")) {
    console.error(
      `refusing: dist/build.json is a harness build. ${marked
        .map((u) => `${u}=${JSON.stringify(built.units![u]!.marker)}`)
        .join(", ")}`,
    );
    console.error(`A build carries a marker only when BUILD_MARKER is set, which e2e,`);
    console.error(`verify:live and falsify do. Run \`bun run build\` and promote again.`);
    process.exit(1);
  }

  // Explicit flags win, so --from-build --app alpha=<older> is a rollback of
  // one unit inside an otherwise current composition.
  for (const unit of UNITS) {
    if (!wanted.has(unit) && built.units[unit]) wanted.set(unit, built.units[unit]!.id);
  }
}

if (wanted.size === 0) {
  usage();
  process.exit(1);
}

const cfg = configFromEnv();
const pointer = `manifests/${region}/${channelArg}.json`;

// -- the current composition ------------------------------------------------

const currentText = await getObjectText(cfg, pointer);
let current: Composition | null = null;
if (currentText !== null) {
  try {
    const parsed = JSON.parse(currentText) as Composition;
    if (parsed.schema === 3) current = parsed;
  } catch {
    current = null;
  }
}

const missing = UNITS.filter((u) => !wanted.has(u) && !(u === "shell" ? current?.shell : current?.apps[u]));
if (missing.length) {
  console.error(
    `the ${channelArg} channel has no composition for ${missing.join(", ")}, and none was named.\n` +
      `A first promote must name every unit:\n` +
      `  bun run promote ${channelArg} --from-build`,
  );
  process.exit(1);
}

// -- read every named unit's manifest ---------------------------------------

// A unit.json's existence is proof the unit finished uploading, because
// publish.ts writes it last. Without this check a channel could point at a
// unit whose files are half there, and every visitor would see it.
const manifests = new Map<Unit, UnitManifest>();
for (const [unit, id] of wanted) {
  const text = await getObjectText(cfg, `units/${unit}/${id}/unit.json`);
  if (text === null) {
    console.error(
      `${unit} ${id} is not published. Nothing was changed; ` +
        `the ${channelArg} channel still points where it did.`,
    );
    process.exit(1);
  }
  manifests.set(unit, JSON.parse(text) as UnitManifest);
}

// Units kept from the current composition need their manifests too, because
// the contract test is over the whole composition and not only over what moved.
for (const unit of UNITS) {
  if (manifests.has(unit)) continue;
  const kept = unit === "shell" ? current!.shell : current!.apps[unit]!;
  const text = await getObjectText(cfg, `units/${unit}/${kept.unitId}/unit.json`);
  if (text === null) {
    console.error(`${unit} ${kept.unitId} is in the ${channelArg} composition but is not published.`);
    process.exit(1);
  }
  manifests.set(unit, JSON.parse(text) as UnitManifest);
}

// -- the compatibility test -------------------------------------------------

// Each unit was compiled against a set of contracts, and the set is generated
// output rather than a claim anyone wrote. A composition works when at least
// one contract is in every unit's set.
//
// This is the check the whole design needs: `tsc` at HEAD proves the HEAD
// combination, and rolling one unit back is precisely how a combination
// nothing has ever typechecked comes to be served.
let shared: string[] = [...(manifests.get("shell")!.contracts ?? [])];
for (const unit of UNITS) {
  const set = new Set(manifests.get(unit)!.contracts ?? []);
  shared = shared.filter((h) => set.has(h));
}

if (shared.length === 0) {
  console.error(`no contract is supported by every unit in this composition. Nothing was changed.`);
  const width = Math.max(...UNITS.map((u) => u.length));
  for (const unit of UNITS) {
    const m = manifests.get(unit)!;
    console.error(`  ${unit.padEnd(width)} ${m.id}  ${m.contracts.join(", ") || "none"}`);
  }
  process.exit(1);
}
const contract = shared[shared.length - 1]!;

// Vendor packages are not in the contract - see scripts/contract.ts - so a
// mismatch is reported rather than refused. Refusing would force every app to
// republish on a patch bump, and folding versions into the contract hash would
// do the same thing more quietly.
const shellShared = manifests.get("shell")!.shared ?? {};
for (const unit of UNITS) {
  if (unit === "shell") continue;
  const theirs = manifests.get(unit)!.shared ?? {};
  for (const [pkg, version] of Object.entries(theirs)) {
    const shellVersion = shellShared[pkg];
    if (shellVersion && majorOf(shellVersion) !== majorOf(version)) {
      console.error(
        `  WARNING ${unit} was built against ${pkg} ${version}, the shell ships ${shellVersion}. ` +
          `Different majors are not covered by the contract.`,
      );
    }
  }
}

// -- compose ----------------------------------------------------------------

const composedUnit = (m: UnitManifest): ComposedUnit => ({
  unitId: m.id,
  commit: m.commit,
  assetBase: m.assetBase,
  js: m.js,
  css: m.css,
  ...(m.imports ? { imports: m.imports } : {}),
  marker: m.marker ?? "",
});

const composition: Composition = {
  schema: 3,
  composedAt: new Date().toISOString(),
  contract,
  shell: composedUnit(manifests.get("shell")!),
  apps: Object.fromEntries(APPS.map((a) => [a, composedUnit(manifests.get(a)!)])),
};

// -- warm, then write -------------------------------------------------------

// A deploy is not finished while the first visitor still has to wait for the
// store to fetch a file from cold. Only the units that are moving need it: the
// rest were warmed by the promote that put them there. Warming happens BEFORE
// the pointer is written, so no visitor can reach the new files first.
if (!argv.includes("--no-warm")) {
  const moving = [...wanted.keys()].filter((u) => {
    const before = u === "shell" ? current?.shell : current?.apps[u];
    return before?.unitId !== wanted.get(u);
  });
  const urls = moving.flatMap((u) =>
    urlsInManifest({
      schema: 3,
      shell: u === "shell" ? composition.shell : undefined,
      apps: u === "shell" ? {} : { [u]: composition.apps[u]! },
    }),
  );
  if (urls.length) {
    const started = Bun.nanoseconds();
    const { warmed, failed } = await warmUrls(urls);
    const ms = Math.round((Bun.nanoseconds() - started) / 1e6);
    console.error(`  warmed ${warmed}/${urls.length} files of ${moving.join(", ")} in ${ms} ms`);
    for (const f of failed) console.error(`  COLD ${f}`);
  }
}

await putObject(cfg, pointer, new TextEncoder().encode(`${JSON.stringify(composition, null, 2)}\n`), {
  contentType: "application/json; charset=utf-8",
  cacheControl: CACHE_POINTER,
});

const width = Math.max(...UNITS.map((u) => u.length));
console.error(`${channelArg} (${region}) at contract ${contract}:`);
for (const unit of UNITS) {
  const now = unit === "shell" ? composition.shell : composition.apps[unit]!;
  const before = unit === "shell" ? current?.shell : current?.apps[unit];
  const moved = before?.unitId !== now.unitId;
  console.error(
    `  ${unit.padEnd(width)} ${now.unitId}` +
      (moved ? `  <- ${before?.unitId ?? "new"}` : `  unchanged`),
  );
}

console.log(JSON.stringify(Object.fromEntries(UNITS.map((u) => [
  u,
  u === "shell" ? composition.shell.unitId : composition.apps[u]!.unitId,
])), null, 2));
