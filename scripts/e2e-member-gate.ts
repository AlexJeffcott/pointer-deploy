// Proves the member gate, §9, against the real store and the real scripts.
//
//   bun run e2e:members
//
// The claim: a shell that drops a member refuses exactly the sub-apps that
// called it, and nothing else. The old rule refused the whole composition,
// because a published app's contract set was fixed at its build time and cannot
// name a contract minted after it.
//
// So this removes `goingAway` from `ShellStore` - `list` calls it - publishes
// only the shell, and promotes. The refusal must name `list` and
// `ShellStore.goingAway`. Then `list` is rebuilt without the call and the same
// promote succeeds.
//
// `PLAN.md` step 4 added `board`, so the second half of the claim - "and
// nothing else" - has a subject in the output: the refusal names `list` and
// prints `board` beside it with the members it uses, unrefused. What is still
// waiting for step 10 is a run whose whole point is that half, with the member
// chosen so that the OTHER sub-app is the one that survives. `goingAway` is
// `list`'s, so this probe measures the half it always did and now shows the
// other one in passing. `scripts/members.test.ts` is what asserts it: each unit
// holds a member the other does not call, in both directions.
//
// Restored at `PLAN.md` step 1 from the version at commit ff196d5. Step 0 left
// it exiting non-zero: the gate is measured by what a SUB-APP uses, and a tree
// with none has nothing to refuse.
//
// It writes to `test-qa` and NEVER to a real channel. It edits `api.ts`, the
// sub-app and the contract registry, and restores all three - including after a
// failure, which is what the `finally` is for. `dist/` is left holding a
// restored build, MARKED - so a `--from-build` to a real channel straight after
// a run is refused rather than served.
//
// Every build it makes carries BUILD_MARKER, and that is not decoration. A
// marked unit is offered on a `test-*` channel and nowhere else, `promote`
// refuses a marked `--from-build` on a real channel, and `bun run units` hides
// it from the table an operator reads to decide what to deploy. Without the
// marker this probe published a DELIBERATELY BROKEN shell - `ShellStore` with
// `goingAway` cut out, from a dirty tree - to the production asset bucket as an
// ordinary build, and on 2026-09-11 it was the first row of `bun run units
// shell` with `bun run promote qa --shell 5569c9df` printed under it. A promote
// naming an id takes no source check, so the only thing that refused it was the
// member gate happening to fire, because `list` used the member this probe cut.
// A probe aimed at a member no unit uses would have been promotable.

import { rm } from "node:fs/promises";
import { UNITS } from "./contract.ts";

const CHANNEL = "test-qa";
/**
 * The marker every build here carries.
 *
 * Fixed rather than per-run: this probe's builds are only ever promoted to
 * `test-qa` by this probe, so two runs producing the same unit id is a publish
 * correctly skipping an upload rather than a reading going wrong.
 */
const MARKER = "member-gate-probe";

const API = "src/web/shell/api.ts";
const LIST = "src/web/apps/list/index.tsx";
const REGISTRY = "contracts/registry.json";
const MINT_NAME = "member-gate-probe";

const ok = (claim: string) => console.log(`  ok   ${claim}`);
const failures: string[] = [];
const check = (claim: string, pass: boolean, saw: string) => {
  if (pass) ok(claim);
  else {
    console.log(`  FAIL ${claim} - saw ${saw}`);
    failures.push(claim);
  }
  return pass;
};

/**
 * Runs a command and never throws on a refusal.
 *
 * The two streams are kept apart because they carry different things: the
 * scripts print their machine-readable ids on stdout and everything a person
 * reads on stderr, so a concatenation of the two cannot be parsed as either.
 */
async function run(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; out: string; said: string }> {
  const proc = Bun.spawn(args, {
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, said: `${out}${err}` };
}

const idsOf = (out: string): Record<string, string> => {
  const start = out.lastIndexOf("{");
  if (start === -1) return {};
  try {
    return JSON.parse(out.slice(start)) as Record<string, string>;
  } catch {
    return {};
  }
};

/** One published unit's own manifest, read back out of the store. */
const unitDoc = async (
  unit: string,
  id: string,
): Promise<{ contracts?: string[]; marker?: string }> => {
  const base = "https://pointer-deploy-assets.fly.storage.tigris.dev";
  return (await fetch(`${base}/units/${unit}/${id}/unit.json`).then((r) => r.json())) as {
    contracts?: string[];
    marker?: string;
  };
};

const saved = new Map<string, string>();
const save = async (path: string) => saved.set(path, await Bun.file(path).text());
const restore = async () => {
  for (const [path, text] of saved) await Bun.write(path, text);
};

let baseline: Record<string, string> = {};

try {
  await save(API);
  await save(LIST);
  await save(REGISTRY);

  console.log(`${CHANNEL} - a baseline every unit was built together for`);
  const built = await run(["bun", "run", "build"], { BUILD_MARKER: MARKER });
  if (built.code !== 0) throw new Error(`the baseline build failed:\n${built.said}`);
  await run(["bun", "run", "publish"]);
  const promoted = await run(["bun", "run", "promote", CHANNEL, "--from-build"]);
  if (promoted.code !== 0) throw new Error(`the baseline promote failed:\n${promoted.said}`);
  baseline = idsOf(promoted.out);
  // Every unit this tree builds, counted from `UNITS` rather than written
  // down. The literal 2 here was step 1's unit count and outlived it: `board`
  // arrived at step 4 and this check failed on a composition that was correct.
  check(
    "a baseline composition is serving",
    Object.keys(baseline).length === UNITS.length,
    JSON.stringify(baseline),
  );
  console.log(`  ${JSON.stringify(baseline)}`);

  // --- the change: one member goes, and one app used it --------------------

  console.log(`\nremoving ShellStore.goingAway, which list calls`);
  const api = saved.get(API)!;
  const withoutGoingAway = api
    .replace("  /** The sunset on one field path, or null when the service does not mark it. */\n  goingAway(path: string): FieldSunset | null;\n", "")
    .replace("    goingAway: (path) => service.value.fields.find((f) => f.path === path)?.going ?? null,\n", "");
  if (withoutGoingAway === api) throw new Error(`${API} no longer declares goingAway the way this expects`);
  await Bun.write(API, withoutGoingAway);

  // `list` has to stop calling it or nothing can be built at all: the member
  // reading refuses to guess for a consumer that does not compile.
  const list = saved.get(LIST)!;
  const listKeeps = list.includes("store.goingAway(");
  check("list calls goingAway in the baseline", listKeeps, "no call to patch");

  const minted = await run(["bun", "run", "contract:mint", "--name", MINT_NAME]);
  console.log(minted.said.trim().split("\n").map((l) => `  ${l}`).join("\n"));
  check("the smaller surface mints a contract", minted.code === 0, `exit ${minted.code}`);
  check(
    "and the direction reading calls it not additive",
    minted.said.includes("NOT additive"),
    "no direction reading",
  );

  // Build with `list` still calling goingAway: the reading must refuse to guess.
  const blocked = await run(["bun", "run", "build"], { BUILD_MARKER: MARKER });
  check(
    "a build refuses while a sub-app still calls the member",
    blocked.code !== 0 && blocked.said.includes("do not compile against the surface at HEAD"),
    `exit ${blocked.code}`,
  );

  // The same reading, taken from a member the surface still has. It is a
  // rewrite and not a deletion, so the panel keeps drawing what it drew.
  await Bun.write(
    LIST,
    list.replace(
      'store.goingAway("snapshot.tasks")',
      'store.service().fields.find((f) => f.path === "snapshot.tasks")?.going ?? null',
    ),
  );
  const rebuilt = await run(["bun", "run", "build"], { BUILD_MARKER: MARKER });
  if (rebuilt.code !== 0) throw new Error(`the smaller build failed:\n${rebuilt.said}`);
  check(
    "with the call gone, the build reads list as no longer using it",
    !/ShellStore\.goingAway\s+\S/.test(rebuilt.said),
    "list still reads as using it",
  );

  // Only the shell is published. The app in the channel keeps the unit.json it
  // already has, which is the state the gate is for.
  const publishedShell = await run(["bun", "run", "publish", "shell"]);
  const newShell = idsOf(publishedShell.out).shell;
  check("a new shell is published alone", Boolean(newShell), publishedShell.said.slice(-200));

  // The shell just published is the broken one, and it is now in the production
  // asset bucket for good: nothing deletes a published unit before the 90-day
  // floor. What keeps it out of an operator's way is the marker, so the marker
  // is READ BACK from the store rather than assumed from the environment this
  // script set. Without it, `bun run units shell` lists this build first and
  // prints a promote command naming it.
  const published = await unitDoc("shell", newShell!);
  check(
    "the broken shell is published as a harness build, so nothing lists it as deployable",
    (published.marker ?? "") === MARKER,
    `marker ${JSON.stringify(published.marker ?? "")}`,
  );
  const listed = await run(["bun", "run", "units", "shell"]);
  check(
    "and `bun run units shell` does not show it",
    !listed.said.includes(newShell!),
    "it is in the table an operator reads",
  );

  // --- the reading ---------------------------------------------------------

  console.log(`\npromoting the smaller shell over the untouched apps`);
  const refused = await run(["bun", "run", "promote", CHANNEL, "--shell", newShell!]);
  console.log(refused.said.trim().split("\n").map((l) => `  ${l}`).join("\n"));
  check("the promote is refused", refused.code !== 0, `exit ${refused.code}`);
  check(
    "it names list and the member",
    refused.said.includes("list uses ShellStore.goingAway"),
    "no mention of list",
  );

  // What the rule this replaced would have said. `list` was published against
  // the contract at HEAD and the smaller shell satisfies only the contract just
  // minted, so the sets are disjoint: the old rule refused the composition
  // whole, whether or not the app had ever called the member.
  const shellSet = (await unitDoc("shell", newShell!)).contracts ?? [];
  const listSet = (await unitDoc("list", baseline.list!)).contracts ?? [];
  console.log(`  contract sets: shell ${shellSet.join(",")} / list ${listSet.join(",")}`);
  check(
    "the contract sets share nothing, so the old rule refused the composition whole",
    shellSet.length > 0 && listSet.length > 0 && !shellSet.some((c) => listSet.includes(c)),
    `${shellSet.join(",")} vs ${listSet.join(",")}`,
  );

  console.log(`\npublishing the rebuilt list, and promoting the pair`);
  const publishedList = await run(["bun", "run", "publish", "list"]);
  const newList = idsOf(publishedList.out).list;
  const allowed = await run([
    "bun",
    "run",
    "promote",
    CHANNEL,
    "--shell",
    newShell!,
    "--app",
    `list=${newList}`,
  ]);
  check("the same promote is allowed once list no longer needs it", allowed.code === 0, allowed.said.slice(-300));
} finally {
  console.log(`\nrestoring the tree and ${CHANNEL}`);
  await restore();
  await rm(`contracts/${MINT_NAME}`, { recursive: true, force: true });
  const rebuilt = await run(["bun", "run", "build"], { BUILD_MARKER: MARKER });
  if (rebuilt.code !== 0) console.log(`  the restoring build FAILED:\n${rebuilt.said}`);
  await run(["bun", "run", "publish"]);
  const back = await run(["bun", "run", "promote", CHANNEL, "--from-build"]);
  console.log(`  ${CHANNEL} is at ${JSON.stringify(idsOf(back.out))}`);
  if (Object.keys(baseline).length) {
    const same = Object.entries(baseline).every(([u, id]) => idsOf(back.out)[u] === id);
    if (!same) console.log(`  WARNING it did not come back to ${JSON.stringify(baseline)}`);
  }
}

console.log(
  failures.length
    ? `\nFAILED: ${failures.length} of the checks above.`
    : "\nSUCCESS: a dropped member refuses the app that used it, and says which member.",
);
process.exit(failures.length ? 1 : 0);
