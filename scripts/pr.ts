// Gives a pull request its review URLs and its two sets of pictures.
//
//   bun run pr                     # this branch's open pull request
//   bun run pr --number 12         # a pull request by number
//   bun run pr --dry-run           # write the body to stdout and change nothing
//
// A GitHub pull request template is static markdown. GitHub substitutes nothing
// into it, so a template can ask for a URL and can never supply one. This
// supplies them.
//
// WHAT A REVIEWER GETS. Two links to the same origin, one composed by the
// channel's pointer and one by §30's query string, and beside them the same
// views shot from both. The reviewer does not have to build anything, and does
// not have to believe a description of what changed on the page.
//
//   qa      https://pointer-deploy.fly.dev/
//   branch  https://pointer-deploy.fly.dev/?hello=<id>
//
// The preview build is published with BUILD_MARKER=pr-<number>, which is the
// only marker `qa` will compose from the catalogue. `promote` refuses a marked
// unit on any channel that is not test-*, and refuses it before it contacts the
// store - so a preview can be looked at and can never be deployed. That
// refusal is older than this and was not relaxed for it.
//
// WHAT IT REFUSES TO DO. It will not shoot production itself. The newest
// deploys/ record is what qa served when somebody last looked, and if that
// record disagrees with the pointer now, the honest reading is that the archive
// is stale - so this stops and says to run `bun run shoot`. Re-shooting
// silently would put a picture taken today under a deploy made a week ago.

import { UNITS, type Unit } from "./contract.ts";
import { REGIONS, type Region } from "./regions.ts";

const REPO = "AlexJeffcott/pointer-deploy";
const ORIGIN = Bun.env.LIVE_ADDRESS ?? "https://pointer-deploy.fly.dev";
const CHANNEL = "qa";
const MANIFEST_BASE =
  Bun.env.MANIFEST_BASE ?? "https://pointer-deploy-assets.fly.storage.tigris.dev/manifests";

const argv = process.argv.slice(2);
const flag = (name: string): string | undefined => {
  const i = argv.indexOf(name);
  return i === -1 ? undefined : argv[i + 1];
};
const dryRun = argv.includes("--dry-run");

type ShotRecord = {
  kind?: "deploy" | "preview";
  channel: string;
  units: Record<string, string>;
  shots: Array<{ route: string; file: string; title: string }>;
};

async function sh(cmd: string[], env: Record<string, string> = {}): Promise<string> {
  const proc = Bun.spawn(cmd, {
    stdout: "pipe",
    stderr: "pipe",
    env: { ...process.env, ...env },
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}\n${err || out}`);
  return out;
}

/** Every unit the channel's pointer names, for the region a machine reads. */
async function pointerIds(region: Region): Promise<Record<string, string>> {
  const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${region}/${CHANNEL}.json`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`no pointer at ${url}: ${res.status}`);
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

const describe = (ids: Record<string, string>): string =>
  Object.entries(ids)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([n, id]) => `${n}=${id}`)
    .join(" ");

/**
 * The newest deploy record, and whether it still describes what qa serves.
 *
 * A record whose ids have moved on is not a picture of production any more. It
 * is not corrected here: the archive is a record of what was served, so the fix
 * is a new record from a person who watched it, not a quiet re-shoot.
 */
async function newestDeploy(): Promise<{ dir: string; record: ShotRecord }> {
  const dirs = [...new Bun.Glob("deploys/*/shots.json").scanSync(".")].sort();
  const latest = dirs.at(-1);
  if (!latest) {
    throw new Error("deploys/ holds no record, so there is no picture of production. Run `bun run shoot`.");
  }
  const record = (await Bun.file(latest).json()) as ShotRecord;
  return { dir: latest.replace(/\/shots\.json$/, ""), record };
}

// -- the run ------------------------------------------------------------------

// One region is enough to read a pointer: promote writes every region and
// refuses a write that would make two of them drift, §3.
const region: Region = (Bun.env.REGION as Region) ?? REGIONS[0]!;

const branch = (await sh(["git", "rev-parse", "--abbrev-ref", "HEAD"])).trim();
if (branch === "main") {
  console.error("this is main. Every change goes through a pull request, so branch first.");
  process.exit(1);
}

const number =
  flag("--number") ??
  JSON.parse(await sh(["gh", "pr", "view", "--json", "number"])).number.toString();
console.log(`pull request #${number} on ${branch}`);

// -- what production is, and whether the archive still says so -----------------

const live = await pointerIds(region);
const { dir: prodDir, record: prod } = await newestDeploy();

if (describe(prod.units) !== describe(live)) {
  console.error(
    `\nFAILED ${prodDir} holds ${describe(prod.units)} and ${CHANNEL} now serves ` +
      `${describe(live)}. The newest deploy record is not a picture of production, ` +
      `so this run would put a stale image beside a live one. Run \`bun run shoot\` first.`,
  );
  process.exit(1);
}

// -- what this branch serves ---------------------------------------------------

const marker = `pr-${number}`;

const idsInDist = async (): Promise<Record<string, string>> => {
  const built = (await Bun.file("dist/build.json").json()) as {
    units: Record<string, { id: string }>;
  };
  return Object.fromEntries(Object.entries(built.units).map(([n, u]) => [n, u.id]));
};

/**
 * Which units this branch changes - read from an UNMARKED build, on purpose.
 *
 * `BUILD_MARKER` is compiled into the bundle: build.ts defines __BUILD_MARKER__
 * and __UNIT_MARKER__ from it, so a marked build's bytes differ from an
 * unmarked one's and its ids differ with them. Comparing a marked build against
 * the channel would therefore report every branch as changing every unit,
 * including one that edited nothing but this file.
 *
 * So the reading is taken first, and the marked build is made only when there
 * is something to preview.
 */
console.log("building to read what this branch changes");
await sh(["bun", "run", "build.ts"], { NODE_ENV: "production" });
const plainIds = await idsInDist();

// A unit id is a hash of that unit's output and nothing else, so a branch that
// changed no bundle builds the ids qa already serves. Publishing that would add
// nothing to the store, and the query string would compose the channel.
const moved = UNITS.filter((u: Unit) => plainIds[u] && plainIds[u] !== live[u]);

let previewUrl = "";
let previewDir = "";
let previewIds: Record<string, string> = {};

if (moved.length === 0) {
  console.log(`no unit changed: this branch builds ${describe(plainIds)}, which is what ${CHANNEL} serves.`);
} else {
  console.log(`changed: ${moved.map((u) => `${u} ${live[u]} -> ${plainIds[u]}`).join(", ")}`);
  console.log(`building with BUILD_MARKER=${marker}`);
  await sh(["bun", "run", "build.ts"], { NODE_ENV: "production", BUILD_MARKER: marker });
  const markedIds = await idsInDist();

  // The marker is baked into dist/build.json at build time; publish reads it
  // from there rather than from its own environment.
  await sh(["bun", "run", "scripts/publish.ts"]);

  // The marked ids, not the unmarked ones: those are the units in the store.
  // The shell draws its own marker in the nav foot, so the preview picture is
  // labelled `pr-<n>` and the production picture is not. That difference is in
  // every preview and is not a change this branch made.
  previewIds = Object.fromEntries(moved.map((u) => [u, markedIds[u]!]));
  previewUrl = `${ORIGIN}/?${Object.entries(previewIds).map(([n, id]) => `${n}=${id}`).join("&")}`;
  previewDir = `previews/${marker}`;
  console.log(`shooting ${previewUrl}`);
  await sh([
    "bun",
    "run",
    "scripts/shoot.ts",
    "--override",
    Object.entries(previewIds).map(([n, id]) => `${n}=${id}`).join(","),
    "--out",
    previewDir,
  ]);
}

// -- the body ------------------------------------------------------------------

// The shots have to be pushed before anything can link them, and they have to
// be linked at a COMMIT rather than at the branch: a branch is deleted on merge
// and its raw URLs go with it, which would leave a merged pull request
// describing pictures nobody can see. So this commits the directory it just
// wrote, and nothing else - `git add <path>` stages that path alone, so work in
// progress elsewhere in the tree is left where it is.
if (previewDir && !dryRun) {
  await sh(["git", "add", previewDir]);
  const staged = await sh(["git", "diff", "--cached", "--name-only"]);
  if (staged.trim()) {
    await sh(["git", "commit", "-m", `Shoot ${marker} against what qa serves`]);
    await sh(["git", "push"]);
    console.log(`committed ${previewDir}`);
  }
}

const sha = (await sh(["git", "rev-parse", "HEAD"])).trim();
const raw = (path: string) => `https://raw.githubusercontent.com/${REPO}/${sha}/${path}`;

const preview = previewDir
  ? ((await Bun.file(`${previewDir}/shots.json`).json()) as ShotRecord)
  : null;

const rows: string[] = [
  `| | ${CHANNEL} serves | this branch |`,
  `| --- | --- | --- |`,
  `| Open it | [${ORIGIN}](${ORIGIN}/) | ${previewUrl ? `[preview](${previewUrl})` : "the same page - no unit changed"} |`,
];

for (const shot of prod.shots) {
  const mine = preview?.shots.find((s) => s.route === shot.route);
  const left = `[![${shot.route}](${raw(`${prodDir}/${shot.file}`)})](${raw(`${prodDir}/${shot.file}`)})`;
  const right = mine
    ? `[![${shot.route}](${raw(`${previewDir}/${mine.file}`)})](${raw(`${previewDir}/${mine.file}`)})`
    : "unchanged";
  rows.push(`| \`${shot.route}\` ${shot.title} | ${left} | ${right} |`);
}

const composition = [
  ``,
  `| | Composition | Record |`,
  `| --- | --- | --- |`,
  `| ${CHANNEL} | \`${describe(live)}\` | [\`${prodDir}\`](https://github.com/${REPO}/tree/${sha}/${prodDir}) |`,
  preview
    ? `| this branch | \`${describe({ ...live, ...previewIds })}\` | [\`${previewDir}\`](https://github.com/${REPO}/tree/${sha}/${previewDir}) |`
    : `| this branch | \`${describe(live)}\` - no bundle changed | none |`,
  ``,
  `The preview is published with marker \`${marker}\`, which \`qa\` composes on request and`,
  `\`promote\` refuses to deploy. A unit the URL does not name follows the channel.`,
].join("\n");

const section = [...rows, composition].join("\n");

// -- putting it in the body ----------------------------------------------------

const MARKER_START = "<!--REVIEW";
const template = await Bun.file(".github/pull_request_template.md").text();
const current = dryRun ? template : JSON.parse(await sh(["gh", "pr", "view", "--json", "body"])).body;

const body = (() => {
  const i = current.indexOf(MARKER_START);
  if (i === -1) {
    // Already filled once, or written without the template. Replacing a section
    // this cannot find would mean guessing where it ended.
    return null;
  }
  const end = current.indexOf("-->", i);
  return `${current.slice(0, i)}${section}${current.slice(end + 3)}`;
})();

if (body === null) {
  console.log(`\nThe body has no ${MARKER_START} block left, so nothing was replaced. The section:\n`);
  console.log(section);
  process.exit(0);
}

if (dryRun) {
  console.log(`\n${body}`);
  process.exit(0);
}

await Bun.write(".git/PR_BODY.md", body);
await sh(["gh", "pr", "edit", number, "--body-file", ".git/PR_BODY.md"]);
console.log(`\nhttps://github.com/${REPO}/pull/${number}`);
