import { computed, signal } from "@preact/signals";

export type BuildInfo = {
  buildId: string;
  commit: string;
  publishedAt: string;
  channel: string;
  region: string;
};

/** Written into the shell by the server, from the manifest the channel points at. */
export function readBuildInfo(): BuildInfo | null {
  const el = document.getElementById("__BUILD__");
  if (!el?.textContent) return null;
  try {
    return JSON.parse(el.textContent) as BuildInfo;
  } catch {
    return null;
  }
}

export const marker = __BUILD_MARKER__;

export const build = signal<BuildInfo | null>(null);
export const clicks = signal(0);

export const shortCommit = computed(() => build.value?.commit.slice(0, 7) ?? "unknown");
