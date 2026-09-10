// Gathers `deploys/` into `CHANGELOG.md`.
//
//   bun run changelog              # write CHANGELOG.md
//   bun run changelog --check      # exit 1 if the file on disk is not what this writes
//
// The archive is one directory per deploy and nothing read it, so what a channel
// served on a date was a directory listing and the hand-written line in each
// `notes.md` was gathered nowhere. This is that archive as a document.
//
// IT IS GENERATED, NEVER HAND-EDITED, and that is a check rather than a
// convention: `scripts/changelog.test.ts` renders `deploys/` again under the
// ordinary `bun test` and fails when the file differs, so a record committed
// without running this is a red test. There is no CI in this repository, so the
// check is as good as `CLAUDE.md`'s rule that `bun test` runs before a pull
// request - and that is a stronger thing than a convention about this file,
// because it is one rule covering every check rather than one more to remember.
//
// This file is the filesystem half only - which directories exist, and what is
// in them. Every decision about what an entry SAYS is in `scripts/record.ts`,
// where `scripts/record.test.ts` can put each one in the state that breaks it.
// `scripts/` is outside `stryker.config.json`'s mutate scope, so those unit
// tests are the only check these get.

import { readdir } from "node:fs/promises";
import {
  renderChangelog,
  type ArchiveRecord,
  type PromoteFile,
  type ShotsFile,
} from "./record.ts";

/** The repository root, not the working directory: `bun test` need not run from it. */
export const ROOT = `${import.meta.dir}/..`;
export const ARCHIVE = `${ROOT}/deploys`;
export const CHANGELOG = `${ROOT}/CHANGELOG.md`;

/**
 * One JSON file of a record, or null when there is no such file.
 *
 * The path is in the error because the alternative was a bare `JSON Parse
 * error` out of the one tool that could say which record is corrupt.
 */
async function readJson<T>(path: string): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  try {
    return (await file.json()) as T;
  } catch (err) {
    throw new Error(`${path} is not readable JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
}

async function readText(path: string): Promise<string | null> {
  const file = Bun.file(path);
  return (await file.exists()) ? await file.text() : null;
}

/**
 * Every record under `deploys/`.
 *
 * A directory and not a `shots.json`, which is the difference between this and
 * `newestDeploy` in `scripts/pr.ts`: a promote that wrote its record and was
 * never shot has no `shots.json` at all, and a scan for one walks straight past
 * a deploy that happened. The changelog holds it, and the entry says the
 * pictures are missing rather than the deploy being.
 *
 * A directory holding manifest bytes and neither JSON is a record too.
 * `writeRecord` in `scripts/promote.ts` writes the manifests before
 * `promote.json` and awaits neither, so that is a reachable state of a promote
 * that moved a real pointer - and it is exactly the record the archive exists
 * for. Only a directory holding nothing this can read is skipped.
 */
export async function readArchive(archive = ARCHIVE): Promise<ArchiveRecord[]> {
  let entries: string[];
  try {
    entries = (await readdir(archive, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch (err) {
    // No archive at all is an empty changelog. Anything else - a permission, a
    // sparse checkout, an unreadable mount - is not, and swallowing it would
    // overwrite the document with "deploys/ holds no record" and exit 0.
    if ((err as { code?: string }).code !== "ENOENT") throw err;
    return [];
  }
  const records: ArchiveRecord[] = [];
  for (const name of entries.sort()) {
    const dir = `${archive}/${name}`;
    const manifestFiles = (await readdir(dir))
      .filter((f) => /^manifest\..*\.json$/.test(f))
      .sort();
    const [promote, shots, notes] = await Promise.all([
      readJson<PromoteFile>(`${dir}/promote.json`),
      readJson<ShotsFile>(`${dir}/shots.json`),
      readText(`${dir}/notes.md`),
    ]);
    if (!promote && !shots && manifestFiles.length === 0) continue;
    // The path a reader follows, which is relative to the repository root
    // rather than to wherever this was run from.
    records.push({ dir: `deploys/${name}`, promote, shots, notes, manifestFiles });
  }
  return records;
}

export async function currentChangelog(path = CHANGELOG): Promise<string | null> {
  return readText(path);
}

if (import.meta.main) {
  const records = await readArchive();
  const rendered = renderChangelog(records);
  const onDisk = await currentChangelog();

  if (process.argv.includes("--check")) {
    if (onDisk === rendered) {
      console.log(`CHANGELOG.md is what ${records.length} records in deploys/ render to.`);
    } else {
      console.error(
        `\nFAILED CHANGELOG.md is not what deploys/ renders to. Run \`bun run changelog\` and commit it.`,
      );
      process.exit(1);
    }
  } else {
    await Bun.write(CHANGELOG, rendered);
    console.log(
      `CHANGELOG.md ${onDisk === rendered ? "unchanged" : "written"}: ${records.length} ${
        records.length === 1 ? "record" : "records"
      }.`,
    );
  }
}
