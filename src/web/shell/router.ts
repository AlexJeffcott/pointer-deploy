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
