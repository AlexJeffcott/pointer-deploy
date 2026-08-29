// The committed reading of what the server writes into its three JSON blocks.
//
// Read by `build.ts`, which refuses a stale one, and by the SERVER, which
// cannot derive it: the runtime image carries `src/server` and a Bun, and
// nothing that could run tsc. See scripts/blocks-record.ts.

export const PROVIDES_FILE = "src/server/blocks.provides.json";

/**
 * Member path to the digest of its declaration. Empty when nothing is recorded.
 *
 * The server reads the same file through `src/server/provides.ts`, which
 * resolves it against its own module URL - the image has no working directory
 * to rely on. This one is for the scripts, which always run from the root.
 */
export async function blocksProvided(): Promise<Record<string, string>> {
  return ((await Bun.file(PROVIDES_FILE)
    .json()
    .catch(() => null)) as Record<string, string> | null) ?? {};
}

export async function writeProvided(provides: Record<string, string>): Promise<void> {
  const sorted = Object.fromEntries(
    Object.entries(provides).sort(([a], [b]) => a.localeCompare(b)),
  );
  await Bun.write(PROVIDES_FILE, `${JSON.stringify(sorted, null, 2)}\n`);
}

/** Whether two readings are the same set with the same digests. */
export function sameProvided(a: Record<string, string>, b: Record<string, string>): boolean {
  const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])];
  return keys.every((k) => a[k] === b[k]);
}
