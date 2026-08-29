// Proves the member gate, §9, against the real store and the real scripts.
//
//   bun run scripts/e2e-member-gate.ts
//
// The claim: a shell that drops a member refuses exactly the sub-apps that
// called it, and nothing else. The old rule refused the whole composition,
// because a published app's contract set was fixed at its build time and cannot
// name a contract minted after it.
//
// So this removes `reset` from `ShellStore` - bravo calls it, and alpha,
// charlie and delta do not - publishes only the shell, and promotes. The
// refusal must name bravo and `ShellStore.reset`, and must not name the other
// three. Then bravo is rebuilt without the call and the same promote succeeds.
//
// It writes to `test-qa` and NEVER to a real channel. It edits `api.ts`, one
// sub-app and the contract registry, and restores all three - including after a
// failure, which is what the `finally` is for. `dist/` is left holding a
// restored build.

import { rm } from "node:fs/promises";

const CHANNEL = "test-qa";

const API = "src/web/shell/api.ts";
const BRAVO = "src/web/apps/bravo/index.tsx";
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
  await save(BRAVO);
  await save(REGISTRY);

  console.log(`${CHANNEL} - a baseline every unit was built together for`);
  const built = await run(["bun", "run", "build"]);
  if (built.code !== 0) throw new Error(`the baseline build failed:\n${built.said}`);
  await run(["bun", "run", "publish"]);
  const promoted = await run(["bun", "run", "promote", CHANNEL, "--from-build"]);
  if (promoted.code !== 0) throw new Error(`the baseline promote failed:\n${promoted.said}`);
  baseline = idsOf(promoted.out);
  check("a baseline composition is serving", Object.keys(baseline).length === 5, JSON.stringify(baseline));
  console.log(`  ${JSON.stringify(baseline)}`);

  // --- the change: one member goes, and one app used it --------------------

  console.log(`\nremoving ShellStore.reset, which bravo calls and the others do not`);
  const api = saved.get(API)!;
  const withoutReset = api
    .replace("  reset(ns: string): void;\n", "")
    .replace("    reset: (ns) => {\n      counters.value = { ...counters.value, [ns]: 0 };\n    },\n", "");
  if (withoutReset === api) throw new Error(`${API} no longer declares reset the way this expects`);
  await Bun.write(API, withoutReset);

  // bravo has to stop calling it or nothing can be built at all: the member
  // reading refuses to guess for a consumer that does not compile.
  const bravo = saved.get(BRAVO)!;
  const bravoKeeps = bravo.includes("store.reset(");
  check("bravo calls reset in the baseline", bravoKeeps, "no call to patch");

  const minted = await run(["bun", "run", "contract:mint", "--name", MINT_NAME]);
  console.log(minted.said.trim().split("\n").map((l) => `  ${l}`).join("\n"));
  check("the smaller surface mints a contract", minted.code === 0, `exit ${minted.code}`);
  check(
    "and the direction reading calls it not additive",
    minted.said.includes("NOT additive"),
    "no direction reading",
  );

  // Build with bravo still calling reset: the reading must refuse to guess.
  const blocked = await run(["bun", "run", "build"]);
  check(
    "a build refuses while a sub-app still calls the member",
    blocked.code !== 0 && blocked.said.includes("do not compile against the surface at HEAD"),
    `exit ${blocked.code}`,
  );

  await Bun.write(BRAVO, bravo.replaceAll("store.reset(", "store.register("));
  const rebuilt = await run(["bun", "run", "build"]);
  if (rebuilt.code !== 0) throw new Error(`the smaller build failed:\n${rebuilt.said}`);
  check(
    "with the call gone, the build reads bravo as no longer using it",
    !/ShellStore\.reset\s+\S/.test(rebuilt.said),
    "bravo still reads as using it",
  );

  // Only the shell is published. The four apps in the channel keep the
  // unit.json they already have, which is the state the gate is for.
  const publishedShell = await run(["bun", "run", "publish", "shell"]);
  const newShell = idsOf(publishedShell.out).shell;
  check("a new shell is published alone", Boolean(newShell), publishedShell.said.slice(-200));

  // --- the reading ---------------------------------------------------------

  console.log(`\npromoting the smaller shell over the untouched apps`);
  const refused = await run(["bun", "run", "promote", CHANNEL, "--shell", newShell!]);
  console.log(refused.said.trim().split("\n").map((l) => `  ${l}`).join("\n"));
  check("the promote is refused", refused.code !== 0, `exit ${refused.code}`);
  check("it names bravo", refused.said.includes("bravo uses ShellStore.reset"), "no mention of bravo");
  for (const app of ["alpha", "charlie", "delta"]) {
    check(
      `it does not refuse ${app}, which never called it`,
      !refused.said.includes(`${app} uses ShellStore.reset`),
      `${app} was refused too`,
    );
  }

  // What the rule this replaced would have said. The apps were published
  // against e0160a6 and the smaller shell satisfies only the contract just
  // minted, so the sets are disjoint: the old rule refused the composition
  // whole, alpha and charlie and delta with it.
  const setOf = async (unit: string, id: string): Promise<string[]> => {
    const base = "https://pointer-deploy-assets.fly.storage.tigris.dev";
    const doc = (await fetch(`${base}/units/${unit}/${id}/unit.json`).then((r) => r.json())) as {
      contracts?: string[];
    };
    return doc.contracts ?? [];
  };
  const shellSet = await setOf("shell", newShell!);
  const alphaSet = await setOf("alpha", baseline.alpha!);
  console.log(`  contract sets: shell ${shellSet.join(",")} / alpha ${alphaSet.join(",")}`);
  check(
    "the contract sets share nothing, so the old rule refused all four",
    shellSet.length > 0 && alphaSet.length > 0 && !shellSet.some((c) => alphaSet.includes(c)),
    `${shellSet.join(",")} vs ${alphaSet.join(",")}`,
  );

  console.log(`\npublishing the rebuilt bravo, and promoting the pair`);
  const publishedBravo = await run(["bun", "run", "publish", "bravo"]);
  const newBravo = idsOf(publishedBravo.out).bravo;
  const allowed = await run([
    "bun",
    "run",
    "promote",
    CHANNEL,
    "--shell",
    newShell!,
    "--app",
    `bravo=${newBravo}`,
  ]);
  check("the same promote is allowed once bravo no longer needs it", allowed.code === 0, allowed.said.slice(-300));
  check(
    "and alpha, charlie and delta were never rebuilt",
    ["alpha", "charlie", "delta"].every((a) => idsOf(allowed.out)[a] === baseline[a]),
    JSON.stringify(idsOf(allowed.out)),
  );
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
    : "\nSUCCESS: a dropped member refuses the app that used it, and only that app.",
);
process.exit(failures.length ? 1 : 0);
