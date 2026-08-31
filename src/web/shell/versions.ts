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

export function chooseVersion(unit: string, option: VersionOption): void {
  const url = new URL(window.location.href);
  if (option.live) url.searchParams.delete(unit);
  else url.searchParams.set(unit, option.unitId);
  window.location.assign(url.toString());
}
