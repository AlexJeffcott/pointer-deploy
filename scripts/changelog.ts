// Gathers `deploys/` into `CHANGELOG.md`.
//
//   bun run changelog              # write CHANGELOG.md
//
// The archive is one directory per deploy and nothing read it, so what a channel
// served on a date was a directory listing and the hand-written line in each
// `notes.md` was gathered nowhere. This is that archive as a document.
//
// IT IS NOT COMMITTED. `CHANGELOG.md` is in `.gitignore`, and every fact in it
// is already in `deploys/` - which IS committed, because the pointer is
// overwritten by the next promote and the store was rewritten whole once
// already. A generated copy of facts that are already in git earns nothing and
// costs three things: it goes stale between the record and the regeneration, it
// needs a check to catch that, and two branches that each land a deploy conflict
// on its counts. Run the command and read the file; delete it and nothing is
// lost. What has to be right is the ARCHIVE and the readings this renders from
// it, and `scripts/record.test.ts` is what holds those.
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
  const label = archive === ARCHIVE ? "deploys" : archive;
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
    // The path a reader follows. For the real archive that is `deploys/<name>`,
    // relative to the repository root rather than to wherever this was run
    // from - a link in the document has to resolve for somebody reading it in
    // the repository. For any other archive it is that archive's own path,
    // because a record labelled `deploys/...` when it came from somewhere else
    // is a link to a file that does not exist. Hardcoding the first case broke
    // the seam this function takes an argument for, which is why it had no test.
    records.push({ dir: `${label}/${name}`, promote, shots, notes, manifestFiles });
  }
  return records;
}

if (import.meta.main) {
  const records = await readArchive();
  const rendered = renderChangelog(records);
  await Bun.write(CHANGELOG, rendered);
  console.log(`CHANGELOG.md, from ${records.length} ${records.length === 1 ? "record" : "records"} in deploys/.`);
  console.log(`It is gitignored: every fact in it is already in deploys/, which is committed.`);
}
