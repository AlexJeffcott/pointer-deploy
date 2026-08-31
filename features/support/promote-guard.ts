import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { After } from "./bdd.ts";
import { UNITS } from "../../scripts/contract.ts";
import type { Source } from "../../scripts/source.ts";

export const PROMOTE = resolve("scripts/promote.ts");

const DEAD_STORE = "https://store.invalid";
const DEAD_BUCKET = "promote-guard";

export const REACHED_STORE = /store\.invalid/;

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
  head: string;
  older: string;
};

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
