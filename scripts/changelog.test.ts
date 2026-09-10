// The archive, read from the filesystem.
//
// `CHANGELOG.md` is not committed - it is in `.gitignore` - so there is no
// staleness to check and no file to compare against. What has to be right is
// the ARCHIVE and the loader that reads it, and this holds the loader: every
// decision `readArchive` makes about which directories are records and what an
// unreadable one means, against fixtures built here.
//
// It was the untested half, and it was wrong twice. `scripts/record.test.ts`
// holds what an entry SAYS; nothing held what the entries were made from.
//
// The readings themselves need no filesystem and are in scripts/record.test.ts.

import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile, chmod } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readArchive } from "./changelog.ts";
import { noteRefusal, renderChangelog } from "./record.ts";

let root = "";

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), "archive-"));
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

const record = async (
  name: string,
  files: Record<string, string>,
): Promise<void> => {
  await mkdir(join(root, name), { recursive: true });
  for (const [file, body] of Object.entries(files)) {
    await writeFile(join(root, name, file), body);
  }
};

const PROMOTE = JSON.stringify({
  schema: 1,
  kind: "promote",
  channel: "qa",
  regions: ["eu"],
  composedAt: "2026-09-10T12:00:00.000Z",
  units: { shell: { unitId: "s1", from: "s1", state: "carried" } },
  warnings: [],
});

test("an archive that does not exist is no records, not a throw", async () => {
  expect(await readArchive(join(root, "nothing-here"))).toEqual([]);
});

// Anything but ENOENT is a real fault. Swallowing it overwrote the document
// with "deploys/ holds no record" and exited 0.
test("an unreadable archive throws rather than reading as empty", async () => {
  const blocked = join(root, "blocked");
  await mkdir(blocked);
  await chmod(blocked, 0o000);
  try {
    await expect(readArchive(blocked)).rejects.toThrow();
  } finally {
    await chmod(blocked, 0o755);
  }
});

test("an empty archive is no records", async () => {
  expect(await readArchive(root)).toEqual([]);
});

test("a directory holding nothing this can read is skipped", async () => {
  await record("2026-09-10T12-00-00Z-qa", { "readme.txt": "not a record" });
  expect(await readArchive(root)).toEqual([]);
});

// THE RECORD THE ARCHIVE EXISTS FOR. `writeRecord` writes the manifests before
// promote.json and awaits neither, so a promote that moved a real pointer can
// leave exactly this. A loader that skips it drops the deploy, silently.
test("a directory with manifest bytes and neither JSON is a record", async () => {
  await record("2026-09-10T12-00-00Z-qa", { "manifest.eu.json": "{}" });
  const records = await readArchive(root);
  expect(records).toHaveLength(1);
  expect(records[0]!.promote).toBeNull();
  expect(records[0]!.shots).toBeNull();
  expect(records[0]!.manifestFiles).toEqual(["manifest.eu.json"]);
});

test("a record with a promote and no pictures", async () => {
  await record("2026-09-10T12-00-00Z-qa", { "promote.json": PROMOTE, "manifest.eu.json": "{}" });
  const records = await readArchive(root);
  expect(records).toHaveLength(1);
  expect(records[0]!.promote?.channel).toBe("qa");
  expect(records[0]!.shots).toBeNull();
});

test("a note is read as text, and its absence is null", async () => {
  await record("a-qa", { "promote.json": PROMOTE, "notes.md": "A line.\n" });
  await record("b-qa", { "promote.json": PROMOTE });
  const records = await readArchive(root);
  expect(records.find((r) => r.dir.endsWith("a-qa"))?.notes).toBe("A line.\n");
  expect(records.find((r) => r.dir.endsWith("b-qa"))?.notes).toBeNull();
});

// A bare `JSON Parse error` out of the one tool that can say which record is
// corrupt is not a reading.
test("unreadable JSON names the file it is in", async () => {
  await record("2026-09-10T12-00-00Z-qa", { "promote.json": "{ truncated" });
  await expect(readArchive(root)).rejects.toThrow("promote.json");
});

test("only manifest.<region>.json counts as pointer bytes", async () => {
  await record("2026-09-10T12-00-00Z-qa", {
    "promote.json": PROMOTE,
    "manifest.eu.json": "{}",
    "manifest.us.as-served.json": "{}",
    "manifesto.json": "{}",
    "shots.json.bak": "{}",
  });
  const records = await readArchive(root);
  expect(records[0]!.manifestFiles).toEqual(["manifest.eu.json", "manifest.us.as-served.json"]);
});

test("records come back sorted by directory", async () => {
  await record("2026-02-02T00-00-00Z-qa", { "promote.json": PROMOTE });
  await record("2026-01-01T00-00-00Z-qa", { "promote.json": PROMOTE });
  const records = await readArchive(root);
  expect(records.map((r) => r.dir.split("/").at(-1))).toEqual([
    "2026-01-01T00-00-00Z-qa",
    "2026-02-02T00-00-00Z-qa",
  ]);
});

// The seam was broken: `dir` was hardcoded to `deploys/${name}` whatever
// archive was read, so a fixture test rendered links to paths that do not
// exist - which is why there was no fixture test.
test("a record from another archive is labelled by that archive", async () => {
  await record("2026-09-10T12-00-00Z-qa", { "promote.json": PROMOTE });
  const records = await readArchive(root);
  // The assertion that catches the hardcoded path: a fixture record must not be
  // labelled `deploys/...`, or every link this renders points at a file that is
  // not there.
  expect(records[0]!.dir).toBe(`${root}/2026-09-10T12-00-00Z-qa`);
  expect(records[0]!.dir.startsWith("deploys/")).toBe(false);
  expect(renderChangelog(records)).toContain(records[0]!.dir);
});

test("the real archive is still labelled deploys/, so its links resolve", async () => {
  const records = await readArchive();
  expect(records.every((r) => r.dir.startsWith("deploys/"))).toBe(true);
});

test("a file where a record directory would be is not a record", async () => {
  await writeFile(join(root, "loose.json"), "{}");
  expect(await readArchive(root)).toEqual([]);
});

// The one file in a record a person writes. `noteRefusal` carries which records
// owe one - a promote no browser could shoot never had a run that could write
// it - and what counts as having one: the line `shoot` writes when nobody
// passed `--note` is a first line that says nothing.
test("every record in the real archive that was shot carries a note somebody wrote", async () => {
  const records = await readArchive();
  expect(records.length).toBeGreaterThan(0);
  expect(records.map((r) => noteRefusal(r)).filter((r): r is string => r !== null)).toEqual([]);
});
