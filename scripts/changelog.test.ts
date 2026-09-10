// CHANGELOG.md cannot silently go stale.
//
// It is generated from `deploys/` and never written by hand, which is worth
// nothing on its own: a generated file whose generator nobody runs is a file
// that quietly stops describing its source, and the discovery comes months
// later when somebody reads an entry that is not there. So this renders the
// real archive under the ordinary `bun test` and fails when what is on disk
// differs. A record committed without running `bun run changelog` is a red test.
//
// The readings themselves are unit tested in scripts/record.test.ts, where each
// one can be put in the state that breaks it. These two tests need the
// filesystem, which is why they are not in that file.

import { expect, test } from "bun:test";
import { readArchive, CHANGELOG, ARCHIVE } from "./changelog.ts";
import { noteRefusal, renderChangelog } from "./record.ts";

test("CHANGELOG.md is what deploys/ renders to", async () => {
  const records = await readArchive();
  // A run that found no record would render an almost empty file and pass
  // against an almost empty file, which is a green test over an archive that
  // has been deleted.
  expect(records.length).toBeGreaterThan(0);

  const rendered = renderChangelog(records);
  const file = Bun.file(CHANGELOG);
  expect(await file.exists()).toBe(true);
  const onDisk = await file.text();
  if (onDisk !== rendered) {
    console.error(
      `\n  ${ARCHIVE} does not render to CHANGELOG.md. A record was committed without ` +
        "regenerating it, or the file was edited by hand. Run `bun run changelog` and commit it.\n",
    );
  }
  expect(onDisk).toBe(rendered);
});

// The one file in a record a person writes. `noteRefusal` carries which records
// are required to have one and which are not - a promote no browser could shoot
// never had a run that could write it - and what counts as having one: the line
// `shoot` writes when nobody passed `--note` is a first line that says nothing,
// and it is the reachable failure rather than an empty file.
test("every record that was shot carries a note somebody wrote", async () => {
  const records = await readArchive();
  const refusals = records.map((r) => noteRefusal(r)).filter((r): r is string => r !== null);
  expect(refusals).toEqual([]);
});
