// What THIS server writes into its three JSON blocks, §11.
//
// Read from a committed file beside this one, because the runtime image has no
// tsc and no tsconfig: `scripts/blocks-record.ts` derives it from
// `src/server/blocks.ts` and `build.ts` refuses a build whose committed copy
// has gone stale.
//
// Resolved against this module's own URL rather than the working directory. The
// image runs `bun src/server/index.ts` from `/app`, and the acceptance harness
// runs the same file from the repository root; both find it this way.

const FILE = new URL("./blocks.provides.json", import.meta.url);

/**
 * Member path to the digest of its declaration, or nothing.
 *
 * Empty is a reading and not a failure: a server whose file is missing judges
 * no shell, which is the same answer it gave before any of this existed.
 */
export async function blocksWritten(): Promise<Record<string, string>> {
  return (
    ((await Bun.file(FILE)
      .json()
      .catch(() => null)) as Record<string, string> | null) ?? {}
  );
}
