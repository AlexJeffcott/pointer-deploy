// Arranges the state TODO §42 is about, and reads what the check says.
//
//   bun run verify:split
//
// A `verify:live` run killed by a signal never runs the `After` hook that puts
// a moved region back, so the next run meets `regionDrift`'s refusal in every
// Background. Measured on 2026-09-11: 41 of 46, and a person reads 41 red
// scenarios as a code failure.
//
// `refuseSplitChannels` in `features/support/hooks.ts` reads both regions of
// both test channels once and throws one message naming the channel, the units
// that differ and the promote that puts it back. A mutation removing that hook
// turns nothing red, because no channel is split while the suite is healthy.
// So the state is ARRANGED here - which is what `~/projects/CLAUDE.md` asks
// for, and what this item had only as prose until 2026-09-13.
//
// It writes `test-prod`, which the suite owns, and puts it back in a `finally`.
// If it is killed anyway it leaves exactly the state it is about, and the check
// it just proved will name the command that fixes it.

import { compositionOf, BASE_REGION } from "../features/support/world.ts";
import { REGIONS, splitChannelReport } from "./regions.ts";
import { run } from "../features/support/http.ts";

const CHANNEL = "test-prod";

const checks: Array<{ ok: boolean; said: string }> = [];
const check = (ok: boolean, said: string) => {
  checks.push({ ok, said });
  console.error(`  ${ok ? "ok  " : "FAIL"}   ${said}`);
};

const other = REGIONS.find((r) => r !== BASE_REGION);
if (!other) throw new Error(`there is only one region, so nothing can be split`);

const read = async (channel: string) =>
  Object.fromEntries(
    await Promise.all(REGIONS.map(async (r) => [r, await compositionOf(channel, r)] as const)),
  ) as Record<string, Record<string, string> | null>;

/**
 * The manifest read, polled until it says what the promote just wrote.
 *
 * A pointer PUT and the next read of it are two requests to an object store,
 * and the second can still be serving the first's predecessor. Reading once
 * after a promote reported the pre-split composition on the first run of this
 * script, which read as "the check does not report a split" - a false failure
 * about the check rather than about the store.
 */
async function readWhen(
  channel: string,
  holds: (now: Record<string, Record<string, string> | null>) => boolean,
  what: string,
): Promise<Record<string, Record<string, string> | null>> {
  const deadline = Date.now() + 30_000;
  let now = await read(channel);
  while (!holds(now) && Date.now() < deadline) {
    await Bun.sleep(1_000);
    now = await read(channel);
  }
  if (!holds(now)) throw new Error(`${channel} never ${what} within 30 s: ${JSON.stringify(now)}`);
  return now;
}

const reportFor = (now: Record<string, Record<string, string> | null>) =>
  splitChannelReport(
    CHANNEL,
    REGIONS.map((r) => ({ region: r, ids: now[r] ?? null })),
    BASE_REGION,
  );

const flagsFor = (ids: Record<string, string>) =>
  Object.entries(ids)
    .sort(([a], [b]) => (a === "shell" ? -1 : b === "shell" ? 1 : a < b ? -1 : a > b ? 1 : 0))
    .flatMap(([unit, id]) => (unit === "shell" ? ["--shell", id] : ["--app", `${unit}=${id}`]));

console.error(`arranging a split ${CHANNEL}, base region ${BASE_REGION}\n`);

const before = await read(CHANNEL);
const base = before[BASE_REGION];

if (!base) {
  console.error(
    `${CHANNEL} names nothing in ${BASE_REGION}, so there is no whole channel to split and ` +
      `nothing to put back. Promote it first.`,
  );
  process.exit(1);
}

/**
 * The unit taken off one region to make the split.
 *
 * Built from the channel's OWN composition rather than borrowed from another
 * channel. The first version of this script copied `test-qa`'s ids, and on
 * 2026-09-13 both test channels happened to serve the same composition - so
 * the "split" promoted identical ids, nothing differed, and the script failed
 * saying the check does not report a split. A split made by REMOVING a unit
 * cannot be a no-op: `unitsThatDiffer` counts a one-sided unit.
 */
const dropped = Object.keys(base).find((unit) => unit !== "shell");
if (!dropped) {
  console.error(
    `${CHANNEL} serves the shell alone in ${BASE_REGION}. A split needs a unit to take off ` +
      `one region, and there is none.`,
  );
  process.exit(1);
}
if (reportFor(before)) {
  console.error(
    `${CHANNEL} is ALREADY split. This script would not be arranging the state, it would be ` +
      `adding to it. Put the channel back first - the check itself prints the command.`,
  );
  process.exit(1);
}
check(true, `${CHANNEL} agrees across ${REGIONS.join(" and ")} before anything is arranged`);

try {
  const kept = Object.fromEntries(Object.entries(base).filter(([unit]) => unit !== dropped));
  const split = await run([
    "bun", "run", "--silent", "scripts/promote.ts", CHANNEL,
    "--region", other, ...flagsFor(kept), "--drop", dropped, "--no-source-check",
  ]);
  if (split.code !== 0) throw new Error(`could not split ${CHANNEL}:\n${split.stderr}`);
  check(true, `${dropped} was taken off ${other} alone, so the channel is split`);

  // The reading, taken the way the hook takes it, once the store is serving
  // what was written rather than what it served before.
  const now = await readWhen(CHANNEL, (n) => reportFor(n) !== null, "read as split");
  const report = reportFor(now)!;
  check(true, "the check reports it");
  check(report.includes(CHANNEL), "and names the channel");
  check(report.includes("Nothing in this run caused it"), "and says the run did not cause it");
  check(report.includes(dropped), `and names ${dropped}, the unit that differs`);

  const command = report.split("\n").find((l) => l.includes("bun run promote"))?.trim();
  if (!command) throw new Error(`the report named no command:\n${report}`);
  check(true, `and prints one command: ${JSON.stringify(command)}`);

  // The whole point: the printed command, run as printed. `--no-source-check`
  // is this script's own addition - the arrangement names ids rather than
  // building, and a promote naming ids takes no source check anyway - so it is
  // appended rather than expected in the message.
  const recovery = await run([...command.split(" ").filter(Boolean), "--no-source-check"]);
  check(recovery.code === 0, `the printed command runs: exit ${recovery.code}`);

  const after = await readWhen(CHANNEL, (n) => reportFor(n) === null, "read as whole again");
  check(true, "and the channel is whole again, with nothing left to report");
  check(
    JSON.stringify(after[BASE_REGION]) === JSON.stringify(before[BASE_REGION]) &&
      JSON.stringify(after[other]) === JSON.stringify(before[BASE_REGION]),
    "and both regions serve what the base served before the split",
  );
} finally {
  // Whatever happened above. A script that left the channel split would leave
  // the state this item exists to report, which is a poor way to demonstrate it.
  const now = await read(CHANNEL);
  const stillWrong = JSON.stringify(now[other]) !== JSON.stringify(before[BASE_REGION]);
  if (stillWrong) {
    console.error(`\nputting ${other} back, because it is not what ${BASE_REGION} serves`);
    const back = await run([
      "bun", "run", "--silent", "scripts/promote.ts", CHANNEL,
      "--region", other, ...flagsFor(base), "--no-source-check",
    ]);
    if (back.code !== 0) {
      console.error(
        `FAILED to put ${other} back. ${CHANNEL} is split and every promote to it is refused.\n` +
          `${back.stderr}`,
      );
    }
  }
}

const failed = checks.filter((c) => !c.ok);
console.error("");
if (failed.length > 0) {
  console.error(
    `FAILURE: ${failed.length} of ${checks.length} readings did not hold. The check cannot ` +
      `reach the state it is for, or the command it prints does not fix it.`,
  );
  process.exit(1);
}
console.error(
  `SUCCESS: ${checks.length} readings held. A split channel is reported once with the command ` +
    `that fixes it, and running that command as printed put both regions back.`,
);
