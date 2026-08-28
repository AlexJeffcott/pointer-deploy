// Routing. Shell-internal on purpose: it is NOT part of the contract, because
// no sub-app navigates and every export in api.ts is hashed. Moving it out of
// api.ts makes the contract exactly what a sub-app is given, and nothing else.

import { signal } from "@preact/signals";

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
