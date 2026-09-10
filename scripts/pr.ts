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
// store - so a preview can be looked at and can never be deployed. That refusal
// is older than this and was not relaxed for it.
//
// THE ORDER IS THE DESIGN. Everything that can refuse runs before anything that
// cannot be undone. The body has to still hold its <!--REVIEW block, the tree
// has to be clean, and the production record has to still describe production -
// all three before the first publish. The first version of this file published,
// committed and pushed, and only then found there was nothing to replace.
//
// WHAT IT REFUSES TO DO. It will not shoot production itself. The newest
// deploys/ record is what qa served when somebody watched it, and if that
// record disagrees with the pointer now, the honest reading is that the archive
// is stale - so this stops and says to run `bun run shoot`. Re-shooting
// silently would put a picture taken today under a deploy made a week ago.

import { UNITS, type Unit } from "./contract.ts";
import { REGIONS, type Region } from "./regions.ts";
import {
  describeIds,
  fillBody,
  pendingRefusal,
  unshotNote,
  type PendingDir,
  pointerIds,
  routeRows,
  staleRefusal,
  type ShotEntry,
} from "./record.ts";

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

type ShotRecordFile = {
  schema?: number;
  composedAt?: string | null;
  kind?: "deploy" | "preview";
  channel: string;
  units: Record<string, string>;
  shots: ShotEntry[];
};

async function sh(cmd: string[], env: Record<string, string> = {}): Promise<string> {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", env: { ...process.env, ...env } });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  const code = await proc.exited;
  if (code !== 0) throw new Error(`${cmd.join(" ")} exited ${code}\n${err || out}`);
  return out;
}

/** Exit code only, for the git reads whose failure is the answer. */
async function ok(cmd: string[]): Promise<boolean> {
  const proc = Bun.spawn(cmd, { stdout: "ignore", stderr: "ignore" });
  return (await proc.exited) === 0;
}

const stop = (message: string): never => {
  console.error(`\nFAILED ${message}`);
  process.exit(1);
};

async function pointerFor(
  region: Region,
): Promise<{ ids: Record<string, string>; composedAt: string | null }> {
  const url = `${MANIFEST_BASE.replace(/\/$/, "")}/${region}/${CHANNEL}.json`;
  const res = await fetch(url, { headers: { "cache-control": "no-cache" } });
  if (!res.ok) throw new Error(`no pointer at ${url}: ${res.status}`);
  const doc = (await res.json()) as { composedAt?: string };
  const ids = pointerIds(doc);
  if (!ids) throw new Error(`${url} names no units.`);
  // The ids alone cannot see a promote of the ids a channel already serves, and
  // shots.json has carried composedAt since schema 2. The reviewer's gate reads
  // what the shooter's gate reads.
  return { ids, composedAt: doc.composedAt ?? null };
}

/**
 * The newest record of THIS channel, whichever channels the archive holds.
 *
 * §2 makes a prod record possible, and the newest directory is then not
 * necessarily the one this run is about. Reading the channel out of each record
 * costs one file read and is the difference between a stale-record refusal and
 * a permanently wedged command.
 */
async function newestDeploy(): Promise<{ dir: string; record: ShotRecordFile } | null> {
  const files = [...new Bun.Glob("deploys/*/shots.json").scanSync(".")].sort().reverse();
  for (const file of files) {
    const record = (await Bun.file(file).json()) as ShotRecordFile;
    if (record.channel === CHANNEL) return { dir: file.replace(/\/shots\.json$/, ""), record };
  }
  return null;
}

/**
 * Every directory under deploys/, and which of the two files it holds.
 *
 * Read separately from newestDeploy because the whole point is the directory it
 * cannot see: a promote wrote its record, nobody shot it, and a scan for
 * shots.json walks straight past. What the operator was then told was that the
 * archive was stale - true, and not the useful half, because the directory
 * waiting for its pictures was already on disk with the command to fill it.
 */
async function deployDirs(): Promise<PendingDir[]> {
  const seen = new Map<string, PendingDir>();
  for (const kind of ["promote", "shots"] as const) {
    for (const file of new Bun.Glob(`deploys/*/${kind}.json`).scanSync(".")) {
      const dir = file.replace(new RegExp(`/${kind}\\.json$`), "");
      const doc = (await Bun.file(file).json()) as { channel?: string };
      const entry = seen.get(dir) ?? { dir, channel: doc.channel ?? "", hasPromote: false, hasShots: false };
      entry.channel = doc.channel ?? entry.channel;
      if (kind === "promote") entry.hasPromote = true;
      else entry.hasShots = true;
      seen.set(dir, entry);
    }
  }
  return [...seen.values()];
}

/** Whether git holds this path at this commit. A raw URL to one it does not is a 404. */
const trackedAt = (sha: string, path: string): Promise<boolean> =>
  ok(["git", "cat-file", "-e", `${sha}:${path}`]);

// -- the run ------------------------------------------------------------------

// One region is enough to read a pointer in the ordinary case: a promote writes
// every region and refuses a write that would make two of them drift, §3.
// `--region` is the deliberate exception, and a record written by one names the
// regions it wrote - so REGION in the environment is how an operator reads the
// other one rather than a default this pretends cannot matter.
const region: Region = (Bun.env.REGION as Region) ?? REGIONS[0]!;

const branch = (await sh(["git", "rev-parse", "--abbrev-ref", "HEAD"])).trim();
if (branch === "main") {
  stop("this is main. Every change goes through a pull request, so branch first.");
}

const number =
  flag("--number") ??
  JSON.parse(await sh(["gh", "pr", "view", "--json", "number"])).number.toString();
console.log(`pull request #${number} on ${branch}`);

// -- everything that can refuse, before anything that cannot be undone --------

const template = await Bun.file(".github/pull_request_template.md").text();
const currentBody = dryRun
  ? template
  : JSON.parse(await sh(["gh", "pr", "view", number, "--json", "body"])).body;

if (fillBody(currentBody, "probe") === null) {
  stop(
    `the body of #${number} has no <!--REVIEW block left, so there is nothing to replace ` +
      `and no way to know where a previous run's section ended. Paste ` +
      `.github/pull_request_template.md back into the body, or edit the table by hand.`,
  );
}

// A publish records `dirty` and does not refuse it, so a run from an edited
// tree would put units in the store that no commit holds, shoot them, and link
// the pictures at a sha that does not contain the source.
const dirty = (await sh(["git", "status", "--porcelain"])).trim();
if (dirty && !dryRun) {
  stop(
    `the working tree has uncommitted changes, so a preview published from it would name ` +
      `source no commit holds:\n${dirty}`,
  );
}

const pointer = await pointerFor(region);
const live = pointer.ids;

// Before the stale reading, because a promote nobody shot is the reason the
// newest SHOT record is stale, and naming it is one command instead of a hunt.
// Only the NEWEST one refuses: `shoot` will not file a picture under a promote
// the pointer moved past, so blocking on an older one blocks forever.
const dirs = await deployDirs();
const waiting = pendingRefusal(dirs, CHANNEL);
if (waiting) stop(waiting);

const stranded = unshotNote(dirs, CHANNEL);
if (stranded) console.error(`note: ${stranded}`);

const newest = await newestDeploy();
const stale = staleRefusal(newest?.record ?? null, CHANNEL, live, newest?.dir ?? "", {
  record: newest?.record.composedAt ?? null,
  live: pointer.composedAt,
});
if (stale) stop(stale);

const prodDir = newest!.dir;
const prod = newest!.record;

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
 * BUILD_MARKER is compiled into the bundle: build.ts defines __BUILD_MARKER__
 * and __UNIT_MARKER__ from it, so a marked build's bytes differ from an
 * unmarked one's and its ids differ with them. Comparing a marked build against
 * the channel would therefore report every branch as changing every unit,
 * including one that edited nothing but this file.
 */
console.log("building to read what this branch changes");
await sh(["bun", "run", "build.ts"], { NODE_ENV: "production" });
const plainIds = await idsInDist();

// A unit id is a hash of that unit's output and nothing else, so a branch that
// changed no bundle builds the ids qa already serves. The baseline is what qa
// SERVES, because that is the page the reviewer is comparing against - and it
// is not the same as main. Where qa is behind, that is said rather than shown
// as this branch's doing.
const behind: string[] = [];
const qaCommit = await (async (): Promise<string | null> => {
  const text = await Bun.file(`${prodDir}/manifest.${region}.json`)
    .text()
    .catch(() => "");
  const doc = text ? (JSON.parse(text) as { shell?: { commit?: string } }) : null;
  return doc?.shell?.commit ?? null;
})();
if (qaCommit && !(await ok(["git", "merge-base", "--is-ancestor", qaCommit, "HEAD"]))) {
  behind.push(
    `qa serves units built at ${qaCommit.slice(0, 8)}, which is not in this branch's history. ` +
      `The right column is this branch against what qa serves, not against main.`,
  );
}

const moved = (UNITS as readonly Unit[]).filter((u) => plainIds[u] && plainIds[u] !== live[u]);

let previewUrl = "";
let previewDir = "";
let previewIds: Record<string, string> = {};

if (moved.length === 0) {
  console.log(`no unit changed: this branch builds ${describeIds(plainIds)}, which is what ${CHANNEL} serves.`);
} else {
  console.log(`changed: ${moved.map((u) => `${u} ${live[u]} -> ${plainIds[u]}`).join(", ")}`);
  console.log(`building with BUILD_MARKER=${marker}`);
  await sh(["bun", "run", "build.ts"], { NODE_ENV: "production", BUILD_MARKER: marker });
  const markedIds = await idsInDist();

  // The marker is baked into dist/build.json at build time; publish reads it
  // from there rather than from its own environment.
  await sh(["bun", "run", "scripts/publish.ts"]);

  // The marked ids, not the unmarked ones: those are the units in the store.
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

// -- the images have to exist where the body says they do ---------------------

// The shots have to be pushed before anything can link them, and they have to
// be linked at a COMMIT rather than at the branch: a branch is deleted on merge
// and its raw URLs go with it, which would leave a merged pull request
// describing pictures nobody can see. `git commit -- <path>` commits that path
// alone, so work staged elsewhere in the index is left where it is.
if (previewDir && !dryRun) {
  await sh(["git", "add", "--", previewDir]);
  const staged = (await sh(["git", "diff", "--cached", "--name-only", "--", previewDir])).trim();
  if (staged) {
    await sh(["git", "commit", "-m", `Shoot ${marker} against what qa serves`, "--", previewDir]);
    await sh(["git", "push"]);
    console.log(`committed ${previewDir}`);
  }
}

const sha = (await sh(["git", "rev-parse", "HEAD"])).trim();
const raw = (path: string) => `https://raw.githubusercontent.com/${REPO}/${sha}/${path}`;

// The gate the first version was blind to, and the likeliest state of all: a
// shoot that nobody committed. Every id matched, the body was written, and
// every image in the production column was a 404 that only a human would see.
if (!dryRun) {
  for (const dir of [prodDir, previewDir].filter(Boolean)) {
    if (!(await trackedAt(sha, `${dir}/shots.json`))) {
      stop(
        `${dir} is not in git at ${sha.slice(0, 8)}, so every image linked from it would be ` +
          `a 404. Commit it and run this again.`,
      );
    }
  }
}

// -- the body ------------------------------------------------------------------

const preview = previewDir
  ? ((await Bun.file(`${previewDir}/shots.json`).json()) as ShotRecordFile)
  : null;

const cell = (dir: string, entry: ShotEntry | null): string =>
  entry ? `[![${entry.route}](${raw(`${dir}/${entry.file}`)})](${raw(`${dir}/${entry.file}`)})` : "";

const rows = routeRows(prod.shots, preview?.shots ?? null).map((row) => {
  const left = row.state === "added" ? "not on this channel" : cell(prodDir, row.prod);
  const right =
    preview === null
      ? "unchanged - no unit changed"
      : row.state === "removed"
        ? "**this branch removes this view**"
        : cell(previewDir, row.preview);
  return `| \`${row.route}\` ${row.title} | ${left} | ${right} |`;
});

const section = [
  `| | ${CHANNEL} serves | this branch |`,
  `| --- | --- | --- |`,
  `| Open it | [${ORIGIN}](${ORIGIN}/) | ${previewUrl ? `[preview](${previewUrl})` : "the same page - no unit changed"} |`,
  ...rows,
  ``,
  `| | Composition | Record |`,
  `| --- | --- | --- |`,
  `| ${CHANNEL} | \`${describeIds(live)}\` | [\`${prodDir}\`](https://github.com/${REPO}/tree/${sha}/${prodDir}) |`,
  preview
    ? `| this branch | \`${describeIds({ ...live, ...previewIds })}\` | [\`${previewDir}\`](https://github.com/${REPO}/tree/${sha}/${previewDir}) |`
    : `| this branch | \`${describeIds(live)}\` - no bundle changed | none |`,
  ``,
  ...(preview
    ? [
        `The preview is published with marker \`${marker}\`, which \`qa\` composes on request and`,
        `\`promote\` refuses to deploy. A unit the URL does not name follows the channel.`,
        ``,
      ]
    : []),
  ...behind.map((line) => `**Note.** ${line}`),
  ...(behind.length ? [``] : []),
  `The gate proves the composition each picture was built from. It does not prove the`,
  `pixels: the panels draw what the service answered, \`/service\` draws the time it read,`,
  `and the renderer is a local Chrome. Each record's \`shots.json\` names those under`,
  `\`unchecked\`, so a difference between two images can be read rather than guessed at.`,
].join("\n");

const body = fillBody(currentBody, section);
if (body === null) stop("the <!--REVIEW block went missing between the first check and now.");

if (dryRun) {
  console.log(`\n${body}`);
  process.exit(0);
}

await Bun.write(".git/PR_BODY.md", body!);
await sh(["gh", "pr", "edit", number, "--body-file", ".git/PR_BODY.md"]);
console.log(`\nhttps://github.com/${REPO}/pull/${number}`);
