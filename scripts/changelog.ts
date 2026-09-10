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
// without running this is a red test and not a discovery months later.
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

async function readJson<T>(path: string): Promise<T | null> {
  const file = Bun.file(path);
  if (!(await file.exists())) return null;
  return (await file.json()) as T;
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
 * a deploy that happened. The changelog has to hold it, and the entry says the
 * pictures are missing rather than the deploy being.
 *
 * A directory holding neither file is not a record and is skipped: `deploys/`
 * is in git, and an empty directory left by a half-finished run is not
 * something to write an entry about.
 */
export async function readArchive(archive = ARCHIVE): Promise<ArchiveRecord[]> {
  let entries: string[];
  try {
    entries = (await readdir(archive, { withFileTypes: true }))
      .filter((e) => e.isDirectory())
      .map((e) => e.name);
  } catch {
    // No archive at all is an empty changelog, not a crash. The header still
    // says what the file is and how it is written.
    return [];
  }
  const records: ArchiveRecord[] = [];
  for (const name of entries.sort()) {
    const dir = `${archive}/${name}`;
    const [promote, shots, notes] = await Promise.all([
      readJson<PromoteFile>(`${dir}/promote.json`),
      readJson<ShotsFile>(`${dir}/shots.json`),
      readText(`${dir}/notes.md`),
    ]);
    if (!promote && !shots) continue;
    // The path a reader follows, which is relative to the repository root
    // rather than to wherever this was run from.
    records.push({ dir: `deploys/${name}`, promote, shots, notes });
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
