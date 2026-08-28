// The working directory a promote-guard scenario runs `scripts/promote.ts` in.
//
// Nothing is stubbed. Every guard scenario runs the real script. Three things
// make that safe, and deterministic on any machine:
//
//   1. The working directory is a temporary git REPOSITORY holding a
//      .gitignore and the dist/build.json under test. So the commit, the
//      cleanliness of the tree and the source the build records are all set by
//      the scenario, rather than read off whatever the developer's own tree
//      happens to be at.
//   2. Bun loads no .env.local from there, so the real credentials are never
//      in play.
//   3. The store endpoint is store.invalid. RFC 2606 reserves the .invalid TLD
//      and DNS never resolves it, so a run that gets past every guard fails at
//      getaddrinfo rather than writing anything.
//
// That third point is what makes the assertions positive rather than
// absence-based. A run either refuses or reaches the store, never both, and
// removing a guard swaps which one happens.

import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { After } from "./bdd.ts";
import { UNITS } from "../../scripts/contract.ts";
import type { Source } from "../../scripts/source.ts";

/** Absolute, because the script runs from a temporary working directory. */
export const PROMOTE = resolve("scripts/promote.ts");

/** A host DNS cannot resolve. RFC 2606 reserves the .invalid TLD. */
const DEAD_STORE = "https://store.invalid";
const DEAD_BUCKET = "promote-guard";

/** Proof a run got as far as the store. */
export const REACHED_STORE = /store\.invalid/;

/**
 * git, with the developer's own configuration out of the way.
 *
 * A global config can change what `status --porcelain` reports, and a scenario
 * whose reading of "clean" depended on the machine it ran on would be evidence
 * about that machine.
 */
const GIT_ENV = { GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_SYSTEM: "/dev/null" };

const git = (dir: string, args: string[]): string => {
  const r = Bun.spawnSync(["git", "-C", dir, ...args], {
    env: { ...process.env, ...GIT_ENV },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (r.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed in ${dir}:\n${new TextDecoder().decode(r.stderr)}`);
  }
  return new TextDecoder().decode(r.stdout).trim();
};

const dirs: string[] = [];

export type Repo = {
  dir: string;
  /** The commit the tree is checked out at. */
  head: string;
  /** A commit before it, so a scenario can record a source this tree has moved past. */
  older: string;
};

/**
 * A temporary repository with two commits and a clean tree.
 *
 * `dist/` is ignored, exactly as it is here, so writing the build record into
 * it leaves `git status --porcelain` empty. Without that every scenario's tree
 * would read as dirty and every one of them would refuse for the wrong reason.
 */
export async function makeRepo(): Promise<Repo> {
  const dir = await mkdtemp(join(tmpdir(), "pointer-guard-"));
  dirs.push(dir);

  git(dir, ["-c", "init.defaultBranch=main", "init", "-q"]);
  await writeFile(join(dir, ".gitignore"), "dist/\n");
  git(dir, ["add", ".gitignore"]);

  const commit = (message: string) =>
    git(dir, [
      "-c", "user.email=guard@example.invalid",
      "-c", "user.name=guard",
      "-c", "commit.gpgsign=false",
      "commit", "-q", "--allow-empty", "-m", message,
    ]);

  commit("the commit a stale build was made at");
  const older = git(dir, ["rev-parse", "HEAD"]);
  commit("the commit this tree is at");
  const head = git(dir, ["rev-parse", "HEAD"]);

  await mkdir(join(dir, "dist"), { recursive: true });
  return { dir, head, older };
}

/**
 * A build.json shaped like the real one, with one unit per name.
 *
 * Only the fields the guards read have to be right. Everything downstream of
 * them is unreachable in these scenarios: a run either stops at a guard or
 * stops at DNS.
 */
export async function writeBuild(
  dir: string,
  opts: { marker?: string; source: Source },
): Promise<void> {
  const unit = (name: string) => ({
    id: `${name}0000`,
    js: `${name}-aaaaaaaa.js`,
    css: null,
    files: [`${name}-aaaaaaaa.js`],
    contracts: ["9e79879"],
    shared: {},
    marker: opts.marker ?? "",
  });
  const record = {
    schema: 3,
    contract: "9e79879",
    source: opts.source,
    units: Object.fromEntries(UNITS.map((n) => [n, unit(n)])),
  };
  await writeFile(join(dir, "dist", "build.json"), JSON.stringify(record, null, 2));
}

export type Run = { code: number; stdout: string; stderr: string };

/** Run the real promote from the scenario's repository, against a dead store. */
export async function runPromote(dir: string, args: string[]): Promise<Run> {
  const proc = Bun.spawn(["bun", "run", PROMOTE, ...args], {
    cwd: dir,
    env: {
      ...process.env,
      ...GIT_ENV,
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
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}

After(async function () {
  await Promise.all(dirs.splice(0).map((d) => rm(d, { recursive: true, force: true })));
});
