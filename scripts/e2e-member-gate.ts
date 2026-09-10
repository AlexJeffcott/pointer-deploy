// Proves the member gate, §9, against the real store and the real scripts.
//
//   bun run scripts/e2e-member-gate.ts
//
// The claim: a shell that drops a member refuses exactly the sub-apps that
// called it, and nothing else. The old rule refused the whole composition,
// because a published app's contract set was fixed at its build time and cannot
// name a contract minted after it.
//
// So this removes `goingAway` from `ShellStore` - hello calls it - publishes
// only the shell, and promotes. The refusal must name hello and
// `ShellStore.goingAway`. Then hello is rebuilt without the call and the same
// promote succeeds.
//
// With one sub-app the second half of the claim - "and nothing else" - is not
// measured here. It returns as a check the day a second unit exists; until
// then `scripts/members.test.ts` is what says a member no app calls costs no
// app anything.
//
// It writes to `test-qa` and NEVER to a real channel. It edits `api.ts`,
// `service.ts`, the sub-app and the contract registry, and restores all four -
// including after a failure, which is what the `finally` is for. `dist/` is
// left holding a restored build.

import { rm } from "node:fs/promises";

const CHANNEL = "test-qa";

const API = "src/web/shell/api.ts";
const CLIENT = "src/web/shell/service.ts";
const HELLO = "src/web/apps/hello/index.tsx";
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
async function run(args: string[]): Promise<{ code: number; out: string; said: string }> {
  const proc = Bun.spawn(args, {
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1" },
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

const saved = new Map<string, string>();
const save = async (path: string) => saved.set(path, await Bun.file(path).text());
const restore = async () => {
  for (const [path, text] of saved) await Bun.write(path, text);
};

let baseline: Record<string, string> = {};

try {
  await save(API);
  await save(CLIENT);
  await save(HELLO);
  await save(REGISTRY);

  console.log(`${CHANNEL} - a baseline every unit was built together for`);
  const built = await run(["bun", "run", "build"]);
  if (built.code !== 0) throw new Error(`the baseline build failed:\n${built.said}`);
  await run(["bun", "run", "publish"]);
  const promoted = await run(["bun", "run", "promote", CHANNEL, "--from-build"]);
  if (promoted.code !== 0) throw new Error(`the baseline promote failed:\n${promoted.said}`);
  baseline = idsOf(promoted.out);
  check("a baseline composition is serving", Object.keys(baseline).length === 2, JSON.stringify(baseline));
  console.log(`  ${JSON.stringify(baseline)}`);

  // --- the change: one member goes, and one app used it --------------------

  console.log(`\nremoving ShellStore.goingAway, which hello calls`);
  const api = saved.get(API)!;
  const withoutGoingAway = api
    .replace("  /** The sunset on one field path, or null when the service does not mark it. */\n  goingAway(path: string): FieldSunset | null;\n", "")
    .replace("    goingAway: (path) => service.value.fields.find((f) => f.path === path)?.going ?? null,\n", "");
  if (withoutGoingAway === api) throw new Error(`${API} no longer declares goingAway the way this expects`);
  await Bun.write(API, withoutGoingAway);

  // The shell's own client passes the member through, so it goes with it. The
  // build does not typecheck this file, and leaving it broken would still be
  // leaving it broken.
  const client = saved.get(CLIENT)!;
  await Bun.write(CLIENT, client.replace("    goingAway: (path) => store.goingAway(path),\n", ""));

  // hello has to stop calling it or nothing can be built at all: the member
  // reading refuses to guess for a consumer that does not compile.
  const hello = saved.get(HELLO)!;
  const helloKeeps = hello.includes("store.goingAway(");
  check("hello calls goingAway in the baseline", helloKeeps, "no call to patch");

  const minted = await run(["bun", "run", "contract:mint", "--name", MINT_NAME]);
  console.log(minted.said.trim().split("\n").map((l) => `  ${l}`).join("\n"));
  check("the smaller surface mints a contract", minted.code === 0, `exit ${minted.code}`);
  check(
    "and the direction reading calls it not additive",
    minted.said.includes("NOT additive"),
    "no direction reading",
  );

  // Build with hello still calling goingAway: the reading must refuse to guess.
  const blocked = await run(["bun", "run", "build"]);
  check(
    "a build refuses while a sub-app still calls the member",
    blocked.code !== 0 && blocked.said.includes("do not compile against the surface at HEAD"),
    `exit ${blocked.code}`,
  );

  // The same reading, taken from a member the surface still has. It is a
  // rewrite and not a deletion, so the panel keeps drawing what it drew.
  await Bun.write(
    HELLO,
    hello.replace(
      'store.goingAway("greeting.audience")',
      'store.service().fields.find((f) => f.path === "greeting.audience")?.going ?? null',
    ),
  );
  const rebuilt = await run(["bun", "run", "build"]);
  if (rebuilt.code !== 0) throw new Error(`the smaller build failed:\n${rebuilt.said}`);
  check(
    "with the call gone, the build reads hello as no longer using it",
    !/ShellStore\.goingAway\s+\S/.test(rebuilt.said),
    "hello still reads as using it",
  );

  // Only the shell is published. The app in the channel keeps the unit.json it
  // already has, which is the state the gate is for.
  const publishedShell = await run(["bun", "run", "publish", "shell"]);
  const newShell = idsOf(publishedShell.out).shell;
  check("a new shell is published alone", Boolean(newShell), publishedShell.said.slice(-200));

  // --- the reading ---------------------------------------------------------

  console.log(`\npromoting the smaller shell over the untouched apps`);
  const refused = await run(["bun", "run", "promote", CHANNEL, "--shell", newShell!]);
  console.log(refused.said.trim().split("\n").map((l) => `  ${l}`).join("\n"));
  check("the promote is refused", refused.code !== 0, `exit ${refused.code}`);
  check(
    "it names hello and the member",
    refused.said.includes("hello uses ShellStore.goingAway"),
    "no mention of hello",
  );

  // What the rule this replaced would have said. hello was published against
  // the contract at HEAD and the smaller shell satisfies only the contract just
  // minted, so the sets are disjoint: the old rule refused the composition
  // whole, whether or not the app had ever called the member.
  const setOf = async (unit: string, id: string): Promise<string[]> => {
    const base = "https://pointer-deploy-assets.fly.storage.tigris.dev";
    const doc = (await fetch(`${base}/units/${unit}/${id}/unit.json`).then((r) => r.json())) as {
      contracts?: string[];
    };
    return doc.contracts ?? [];
  };
  const shellSet = await setOf("shell", newShell!);
  const helloSet = await setOf("hello", baseline.hello!);
  console.log(`  contract sets: shell ${shellSet.join(",")} / hello ${helloSet.join(",")}`);
  check(
    "the contract sets share nothing, so the old rule refused the composition whole",
    shellSet.length > 0 && helloSet.length > 0 && !shellSet.some((c) => helloSet.includes(c)),
    `${shellSet.join(",")} vs ${helloSet.join(",")}`,
  );

  console.log(`\npublishing the rebuilt hello, and promoting the pair`);
  const publishedHello = await run(["bun", "run", "publish", "hello"]);
  const newHello = idsOf(publishedHello.out).hello;
  const allowed = await run([
    "bun",
    "run",
    "promote",
    CHANNEL,
    "--shell",
    newShell!,
    "--app",
    `hello=${newHello}`,
  ]);
  check("the same promote is allowed once hello no longer needs it", allowed.code === 0, allowed.said.slice(-300));
} finally {
  console.log(`\nrestoring the tree and ${CHANNEL}`);
  await restore();
  await rm(`contracts/${MINT_NAME}`, { recursive: true, force: true });
  const rebuilt = await run(["bun", "run", "build"]);
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
