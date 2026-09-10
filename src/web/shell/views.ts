export type View = {
  title: string;
  /** The units placed on this view. Empty means the shell draws it alone. */
  apps: readonly string[];
  note: string;
};

/**
 * Where each unit appears, and what the shell draws by itself.
 *
 * The shell owns placement. A view naming no app is a legitimate view: the
 * frame draws it, nothing is fetched for it, and it is how a page exists
 * before a unit has been built for it.
 *
 * Every view here is one of those. `PLAN.md` step 0 is the frame on its own, so
 * the tree builds no sub-app and no view may place one - `placementProblems`
 * below is what refuses the two ways that can go wrong. Three of these five
 * routes are waiting for a unit: `/` at step 1, `/board` at step 4, `/week` at
 * step 5. The other two never get one; the frame draws them from its own state.
 */
export const VIEWS: Record<string, View> = {
  "/": {
    title: "Tasks",
    apps: [],
    note: "No unit is placed here yet. The frame drew this view, and nothing was fetched for it.",
  },
  "/board": {
    title: "Board",
    apps: [],
    note: "No unit is placed here yet. The frame drew this view, and nothing was fetched for it.",
  },
  "/week": {
    title: "Week",
    apps: [],
    note: "No unit is placed here yet. The frame drew this view, and nothing was fetched for it.",
  },
  "/service": {
    title: "Service",
    apps: [],
    note: "Drawn by the shell from the one reading it took of the service. Nothing is fetched for this view.",
  },
  "/backup": {
    title: "Backup",
    apps: [],
    note: "Drawn by the shell. It will hold export, import, push and pull; none of them is built yet.",
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
