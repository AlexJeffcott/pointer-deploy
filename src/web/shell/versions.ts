export type { VersionOption, VersionsBlock } from "@pointer/blocks";

import type { VersionOption, VersionsBlock } from "@pointer/blocks";

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
 * How long the unit has been served, in the coarsest unit that still says
 * something.
 *
 * Read in the browser from an instant rather than served as a duration: the
 * page is stored by nobody but the manifest behind it is cached, so a number
 * counted on the server would be as old as the reading that carried it.
 */
export function servedFor(since: string, now: number = Date.now()): string {
  const ms = now - Date.parse(since);
  if (!Number.isFinite(ms)) return "";
  if (ms < 60_000) return "just now";
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours} h`;
  return `${Math.floor(hours / 24)} d`;
}

export function chooseVersion(unit: string, option: VersionOption): void {
  const url = new URL(window.location.href);
  if (option.live) url.searchParams.delete(unit);
  else url.searchParams.set(unit, option.unitId);
  window.location.assign(url.toString());
}
