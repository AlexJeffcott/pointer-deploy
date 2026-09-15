// A planner document the harness can hand to any of the four doors.
//
// One builder, four doors. `backing-up-the-planner.feature` writes this to a
// file input, `reading-what-the-service-holds.feature` pushes it to the service,
// and `PLAN.md` step 6's pull scenarios read one back. A second copy of the
// shape in a second steps file is a second reading that can disagree with the
// first, which is the argument this repository makes everywhere else.
//
// Built here rather than read out of `features/support/fixtures/`, because
// every refusing scenario needs a document that differs from this one in
// exactly one field, and a directory of near-identical files is a directory
// nobody reads.

import { DOCUMENT_FORMAT } from "../../src/web/shell/document.ts";
import { SCHEMA_VERSION } from "../../src/web/shell/planner.ts";

/**
 * A document a shell of this version accepts, holding the titles given.
 *
 * `createdAt` ascends, so the order the list draws them in is the order the
 * document names them. `exportedAt` is a fixed moment: the rule READS it from
 * `PLAN.md` step 6 - TODO §45 - so a document with no stamp is refused, and a
 * stamp that moved every time this was called would make two documents holding
 * the same tasks two different addresses when pushed.
 */
export const plannerDocument = (titles: readonly string[]): Record<string, unknown> => ({
  format: DOCUMENT_FORMAT,
  schemaVersion: SCHEMA_VERSION,
  exportedAt: "2026-01-01T00:00:00.000Z",
  tasks: titles.map((title, i) => ({
    id: `imported-${i}`,
    title,
    column: "todo",
    due: null,
    tags: [],
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, 0, i)).toISOString(),
  })),
});

/** The same document as bytes, indented the way an export writes one. */
export const plannerFile = (titles: readonly string[]): string =>
  `${JSON.stringify(plannerDocument(titles), null, 2)}\n`;

/** A comma-separated list of titles, as a scenario writes one. */
export const titleList = (text: string): string[] =>
  text
    .split(",")
    .map((t) => t.trim())
    .filter((t) => t !== "");
