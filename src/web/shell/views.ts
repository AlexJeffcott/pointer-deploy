export type View = {
  title: string;
  apps: readonly string[];
  note: string;
};

export const VIEWS: Record<string, View> = {
  "/": {
    title: "Counters",
    apps: ["alpha", "bravo"],
    note: "Two sub-apps, each its own bundle. Both write to the shell's store.",
  },
  "/totals": {
    title: "Totals",
    apps: ["charlie", "delta"],
    note: "Two more bundles. Neither created a counter on this page, and both read the ones that did.",
  },
};

export const DEFAULT_ROUTE = "/";

export function placedApps(views: Record<string, View> = VIEWS): string[] {
  const seen = new Set<string>();
  for (const view of Object.values(views)) {
    for (const app of view.apps) seen.add(app);
  }
  return [...seen];
}

export function placementProblems(
  apps: readonly string[],
  views: Record<string, View> = VIEWS,
): string[] {
  const placed = placedApps(views);
  const problems: string[] = [];

  for (const app of apps) {
    if (!placed.includes(app)) {
      problems.push(`${app} is built and published, and no view places it, so nothing ever fetches it`);
    }
  }
  for (const app of placed) {
    if (!apps.includes(app)) {
      const where = Object.entries(views)
        .filter(([, v]) => v.apps.includes(app))
        .map(([path]) => path)
        .join(", ");
      problems.push(`${app} is placed on ${where}, and nothing builds it, so that panel reports a missing bundle`);
    }
  }
  return problems;
}
