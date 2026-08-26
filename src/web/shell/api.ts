// The shell's global state. Published as its own asset and reached by sub-apps
// as the bare specifier "@pointer/shell", resolved through the import map.
//
// Everything here is one instance shared by the shell and every sub-app, so a
// counter a sub-app increments is read by another sub-app on another view, and
// a name the frame edits reaches all of them.

import { computed, signal } from "@preact/signals";

/** A label baked in at build time. Empty unless BUILD_MARKER was set. */
export const buildMarker: string = __BUILD_MARKER__;

// -- who is using the app -------------------------------------------------

export type User = { name: string; colour: string };

export const user = signal<User>({ name: "Alex", colour: "#1f5fd0" });

export function setName(name: string): void {
  user.value = { ...user.value, name };
}

export function setColour(colour: string): void {
  user.value = { ...user.value, colour };
}

// -- namespaced counters --------------------------------------------------

// One signal holding the whole map, rather than a signal per namespace: a
// sub-app that wants to list every namespace it did not create needs the set of
// keys to be reactive too.
export const counters = signal<Record<string, number>>({});

/** Make a namespace visible at zero before anyone increments it. */
export function register(ns: string): void {
  if (ns in counters.value) return;
  counters.value = { ...counters.value, [ns]: 0 };
}

export function increment(ns: string, by = 1): void {
  counters.value = { ...counters.value, [ns]: (counters.value[ns] ?? 0) + by };
}

export function countOf(ns: string): number {
  return counters.value[ns] ?? 0;
}

/** Every namespace and its count, in a stable order. */
export const snapshot = computed(() =>
  Object.entries(counters.value).sort(([a], [b]) => a.localeCompare(b)),
);

// -- routing ---------------------------------------------------------------

export const route = signal<string>(
  typeof location === "undefined" ? "/" : location.pathname,
);

export function navigate(path: string): void {
  if (path === route.value) return;
  history.pushState(null, "", path);
  route.value = path;
}

if (typeof window !== "undefined") {
  addEventListener("popstate", () => {
    route.value = location.pathname;
  });
}
