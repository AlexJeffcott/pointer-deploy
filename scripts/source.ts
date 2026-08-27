// Which source a build came from, and whether any commit holds it.
//
// One definition, because three scripts ask the same question and a second
// answer to it is exactly how a unit comes to claim a commit that did not
// produce its bytes. `build.ts` records this beside the build, `publish.ts`
// copies it onto the unit rather than re-deriving it at publish time, and
// `promote.ts` compares it with the tree before it will touch a real channel.
//
// Read from the CURRENT DIRECTORY and not from this file's own location. The
// documented commands run from the repository root; a promote run from
// anywhere else has no source to compare against, which is a refusal rather
// than a value to invent.

export type Source = {
  /** The commit HEAD was at. 40 hex characters. */
  commit: string;
  /**
   * True when the tree carried uncommitted changes.
   *
   * The whole point of the flag: a dirty build's bytes came from source that
   * no commit holds, so its `commit` names where the work started and not what
   * it contains.
   */
  dirty: boolean;
};

const git = (args: string[]): string | null => {
  const r = Bun.spawnSync(["git", ...args], { stdout: "pipe", stderr: "pipe" });
  return r.exitCode === 0 ? new TextDecoder().decode(r.stdout).trim() : null;
};

/** What the working directory's source is right now, or null if git cannot say. */
export function currentSource(): Source | null {
  const commit = git(["rev-parse", "HEAD"]);
  if (commit === null) return null;
  const status = git(["status", "--porcelain"]);
  if (status === null) return null;
  return { commit, dirty: status !== "" };
}

/** `a1b2c3d4` or `a1b2c3d4 (dirty)`. For a message an operator has to act on. */
export function describeSource(s: Source): string {
  return `${s.commit.slice(0, 8)}${s.dirty ? " (dirty)" : ""}`;
}
