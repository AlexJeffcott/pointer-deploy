// Steps about promote refusing a build the test harness made.
//
// @local, and the conventions allow it here: this failure cannot be forced on
// the real store, because forcing it means naming a real channel, and a removed
// refusal would then deploy to visitors.
//
// Nothing is stubbed. Each step runs the real scripts/promote.ts. Two things
// make that safe:
//
//   1. The working directory is a temporary one holding only the
//      dist/build.json under test. Bun loads no .env.local from there, so the
//      real credentials are never in play.
//   2. The store endpoint is store.invalid. RFC 2606 reserves .invalid and DNS
//      never resolves it, so a run that gets past the refusal fails at
//      getaddrinfo rather than writing anything.
//
// That second point is what makes the assertions positive rather than
// absence-based. A run either refuses for a marker or reaches the store, never
// both, and removing the refusal swaps which one happens.

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { After, Given, Then, When } from "@cucumber/cucumber";
import { expect } from "bun:test";
import { PointerWorld } from "../support/world.ts";

/** Absolute, because the script runs from a temporary working directory. */
const PROMOTE = resolve("scripts/promote.ts");

/** A host DNS cannot resolve. RFC 2606 reserves the .invalid TLD. */
const DEAD_STORE = "https://store.invalid";
const DEAD_BUCKET = "refusing-a-harness-build";

/** Proof a run got as far as the store. */
const REACHED_STORE = /store\.invalid/;
/** Proof a run was stopped by the marker check. */
const REFUSED_FOR_MARKER = /harness build/;

const dirs: string[] = [];

/**
 * A build.json shaped like the real one, with one unit per name.
 *
 * Only the fields the refusal reads have to be right. Everything downstream of
 * it is unreachable in these scenarios: the run either stops at the refusal or
 * stops at DNS.
 */
function buildJson(marker: string): string {
  const unit = (name: string) => ({
    id: `${name}0000`,
    js: `${name}-aaaaaaaa.js`,
    css: null,
    files: [`${name}-aaaaaaaa.js`],
    contracts: ["9e79879"],
    shared: {},
    marker,
  });
  return JSON.stringify({
    schema: 3,
    contract: "9e79879",
    units: Object.fromEntries(
      ["shell", "alpha", "bravo", "charlie", "delta"].map((n) => [n, unit(n)]),
    ),
  });
}

async function writeBuild(marker: string): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), "pointer-guard-"));
  dirs.push(dir);
  await mkdir(join(dir, "dist"), { recursive: true });
  await writeFile(join(dir, "dist", "build.json"), buildJson(marker));
  return dir;
}

Given("a build the test harness made", async function (this: PointerWorld) {
  // What BUILD_MARKER or BUILD_MARKER_<UNIT> stamps, and nothing else does.
  this.guardDir = await writeBuild("harness");
});

Given("a build made the ordinary way", async function (this: PointerWorld) {
  this.guardDir = await writeBuild("");
});

When(
  "the operator promotes it to the {string} channel",
  async function (this: PointerWorld, channel: string) {
    const proc = Bun.spawn(["bun", "run", PROMOTE, channel, "--from-build"], {
      cwd: this.guardDir!,
      env: {
        ...process.env,
        AWS_ENDPOINT_URL_S3: DEAD_STORE,
        BUCKET_NAME: DEAD_BUCKET,
        AWS_ACCESS_KEY_ID: "unusable",
        AWS_SECRET_ACCESS_KEY: "unusable",
      },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [stdout, stderr] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
    ]);
    this.lastRun = { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
  },
);

Then(
  "the promotion is refused because the build came from the harness",
  function (this: PointerWorld) {
    const runResult = this.lastRun!;
    expect(runResult.code).not.toBe(0);
    expect(runResult.stderr).toMatch(REFUSED_FOR_MARKER);
    // The refusal has to name what it found, or an operator cannot tell a
    // stale dist/ from a broken script.
    expect(runResult.stderr).toMatch(/"harness"/);
  },
);

Then("the promotion is not refused for carrying a marker", function (this: PointerWorld) {
  expect(this.lastRun!.stderr).not.toMatch(REFUSED_FOR_MARKER);
});

Then("the store was never contacted", function (this: PointerWorld) {
  const runResult = this.lastRun!;
  expect(`${runResult.stdout}\n${runResult.stderr}`).not.toMatch(REACHED_STORE);
});

Then("the store was contacted", function (this: PointerWorld) {
  // The positive half. Without it "not refused" would also pass on a script
  // that exited early for some unrelated reason.
  expect(`${this.lastRun!.stdout}\n${this.lastRun!.stderr}`).toMatch(REACHED_STORE);
});

After(async function () {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
