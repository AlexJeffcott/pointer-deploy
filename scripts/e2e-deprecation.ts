// Proves the deprecation dynamic, §10, against the real scripts and the real
// store.
//
//   bun run e2e:deprecation
//
// The claim: a contract can be marked as going away AFTER it was minted, and
// the two commands an operator uses - `contract:matrix` and `promote` - both
// say so, without either of them refusing anything.
//
// It cannot be done from a unit test, and that is the whole reason this exists.
// A deprecation on the contract at HEAD is refused, so showing one needs a NEW
// contract minted first; and the promote warning needs published units whose
// contract set names the old one, which needs the store. So this mints, marks
// the previous contract, and reads what the two commands print.
//
// It writes to `test-qa` and NEVER to a real channel. It edits `api.ts` and the
// contract registry and restores both - including after a failure, which is
// what the `finally` is for.

import { rm } from "node:fs/promises";

const CHANNEL = "test-qa";
const API = "src/web/shell/api.ts";
const REGISTRY = "contracts/registry.json";
const MINT_NAME = "deprecation-probe";
const REASON = "the counters surface is superseded, e2e probe";

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

/** Runs a command and never throws on a refusal. */
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

const indented = (said: string) =>
  said.trim().split("\n").map((l) => `  ${l}`).join("\n");

let baseline: Record<string, string> = {};

try {
  await save(API);
  await save(REGISTRY);

  const before = JSON.parse(saved.get(REGISTRY)!) as { retained: string[] };
  const OLD = before.retained[before.retained.length - 1]!;

  console.log(`${CHANNEL} - a composition every unit was built for, at contract ${OLD}`);
  const built = await run(["bun", "run", "build"]);
  if (built.code !== 0) throw new Error(`the baseline build failed:\n${built.said}`);
  await run(["bun", "run", "publish"]);
  const promoted = await run(["bun", "run", "promote", CHANNEL, "--from-build"]);
  if (promoted.code !== 0) throw new Error(`the baseline promote failed:\n${promoted.said}`);
  baseline = idsOf(promoted.out);
  check("a baseline composition is serving", Object.keys(baseline).length === 5, JSON.stringify(baseline));
  check(
    "and its promote says nothing about a deprecation",
    !promoted.said.includes("deprecated"),
    "it already said something",
  );

  // --- the contract at HEAD cannot be the one going away -------------------

  console.log(`\ndeprecating the contract everything is built against`);
  const refusedHead = await run([
    "bun", "run", "contract:deprecate", "--hash", OLD, "--reason", REASON, "--instead", "none",
  ]);
  console.log(indented(refusedHead.said));
  check("it is refused while it is the surface at HEAD", refusedHead.code !== 0, `exit ${refusedHead.code}`);
  check(
    "and the refusal names the way out",
    refusedHead.said.includes("contract:mint"),
    "it named no next step",
  );
  check(
    "nothing was written",
    (await Bun.file(REGISTRY).text()) === saved.get(REGISTRY),
    "the registry moved",
  );

  // --- mint a successor, then mark the old one -----------------------------

  console.log(`\nadding an export, so HEAD becomes a contract of its own`);
  await Bun.write(API, `${saved.get(API)!}\n/** §10 e2e probe. Additive, so every unit still compiles. */\nexport function deprecationProbe(): string {\n  return "probe";\n}\n`);
  const minted = await run(["bun", "run", "contract:mint", "--name", MINT_NAME]);
  console.log(indented(minted.said));
  check("the larger surface mints a contract", minted.code === 0, `exit ${minted.code}`);
  const NEW = minted.out.trim().split("\n").pop() ?? "";
  check("and it is additive over the one being replaced", minted.said.includes("additive"), "no direction reading");

  console.log(`\nmarking ${OLD} as going away, in favour of ${NEW}`);
  const marked = await run([
    "bun", "run", "contract:deprecate", "--hash", OLD, "--reason", REASON, "--instead", NEW,
  ]);
  console.log(indented(marked.said));
  check("the previous contract is deprecated", marked.code === 0, `exit ${marked.code}`);
  check("it stays retained, so a rollback onto it still promotes", marked.said.includes("Still retained"), marked.said.slice(-200));

  const refusedChain = await run([
    "bun", "run", "contract:deprecate", "--hash", NEW, "--reason", REASON, "--instead", OLD,
  ]);
  check(
    "a move onto a deprecated contract is refused",
    refusedChain.code !== 0,
    `exit ${refusedChain.code}`,
  );

  // --- what the two commands say -------------------------------------------

  console.log(`\nwhat \`contract:matrix\` shows an operator`);
  const matrix = await run(["bun", "run", "contract:matrix"]);
  console.log(indented(matrix.said));
  check("the matrix still runs", matrix.code === 0, `exit ${matrix.code}`);
  check("it names the contract that is going away", matrix.said.includes(`${OLD} `) && matrix.said.includes("is deprecated as of"), "no deprecation line");
  check("with the reason it was given", matrix.said.includes(REASON), "no reason");
  check("and where to move to", matrix.said.includes(`Move to ${NEW}`), "no replacement named");

  console.log(`\nwhat \`promote\` tells an operator about the same composition`);
  const warned = await run(["bun", "run", "promote", CHANNEL, "--from-build"]);
  console.log(indented(warned.said));
  check("the promote is allowed, not refused", warned.code === 0, `exit ${warned.code}`);
  check(
    "and it says the contract it resolved at is going away",
    warned.said.includes(`WARNING contract ${OLD}`),
    "no warning",
  );
  check("with the reason", warned.said.includes(REASON), "no reason");
  check("and what to move to", warned.said.includes(`Move to ${NEW}`), "no replacement named");
  // The state the warning exists to prevent. These units were published against
  // the old contract alone, so the promote HAS no other option: the operator is
  // told that rather than left to work it out from a set nobody printed.
  check(
    "and that this promote has no other option",
    warned.said.includes("no other option"),
    "it did not say so",
  );
  check(
    "the composition is unchanged by the warning",
    Object.entries(baseline).every(([u, id]) => idsOf(warned.out)[u] === id),
    JSON.stringify(idsOf(warned.out)),
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
    : "\nSUCCESS: a contract can be marked as going away, and both commands say so without refusing anything.",
);
process.exit(failures.length ? 1 : 0);
