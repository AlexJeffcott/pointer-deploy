// The version switcher's data and its one action.
//
// Deliberately NOT exported from api.ts or subapp.ts. Those two files are the
// contract surface: `scripts/contract.ts` hashes the declarations emitted from
// them, so one export added there mints a new contract and every unit has to be
// rebuilt before it can claim the new one. A shell-internal module costs none
// of that.
//
// What it does NOT cost was measured on 2026-08-28, and it is less than this
// comment used to claim. An ADDITIVE export does not force a republish and does
// not make any id already in a channel's history unselectable: the shell goes
// on compiling against the retained contract, every published unit keeps the
// set it was built with, and the intersection stays non-empty. REMOVING or
// narrowing an export is what costs that, and it is a different change. See the
// TODO, section 15, for the table the measurement produced.
//
// The price that is real: a sub-app cannot draw its own control yet. The shell
// draws all of them instead, which makes every unit selectable, and handing the
// data through to a sub-app is a contract change and its own decision.

// Declared once, in the file that holds the whole server-to-shell surface. It
// used to be declared here AND in `composition.ts`; renaming a field in one of
// them is exactly what §11 demonstrated, and is now a compile error.
export type { VersionOption, VersionsBlock } from "@pointer/blocks";

import type { VersionOption, VersionsBlock } from "@pointer/blocks";

/**
 * The options the server rendered, or none.
 *
 * Absent is the ordinary case: the switcher is off unless the channel is named
 * in VERSION_SWITCHER_CHANNELS. Absent and unreadable are the same answer, so a
 * malformed block costs the control and never the page.
 */
export function readVersions(): VersionsBlock {
  const tag = document.getElementById("__VERSIONS__");
  if (!tag?.textContent) return {};
  try {
    return JSON.parse(tag.textContent) as VersionsBlock;
  } catch {
    return {};
  }
}

/**
 * Point this page at one unit id, by reloading with it named.
 *
 * A query string and a full load, not a client-side swap. The composition
 * decides the import map, the content policy and every digest on the page, and
 * all three are written into the document by the server - so a new composition
 * is a new document. Choosing what the channel already serves REMOVES the
 * parameter, so a link copied from this page keeps following the channel
 * instead of freezing at today's build.
 */
export function chooseVersion(unit: string, option: VersionOption): void {
  const url = new URL(window.location.href);
  if (option.live) url.searchParams.delete(unit);
  else url.searchParams.set(unit, option.unitId);
  window.location.assign(url.toString());
}
