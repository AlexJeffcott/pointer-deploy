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
 * `PLAN.md` step 1 places the first one. `/` names `list`; `/board` and `/week`
 * are still waiting, for `board` at step 4 and `week` at step 5; `/service` and
 * `/backup` never get one, because the frame draws them from its own state.
 * `placementProblems` below refuses the two ways placement and the build can
 * disagree.
 */
export const VIEWS: Record<string, View> = {
  "/": {
    title: "Tasks",
    apps: ["list"],
    // Where the tasks are kept is the PANEL's sentence, drawn from what the
    // frame reports, because it is one of two and this note cannot know which.
    // It said "kept in this page alone until PLAN.md step 2" until step 2
    // landed, and then contradicted the line directly beneath it.
    note: "Every task the planner holds.",
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
    // `PLAN.md` step 3 built the first two doors, so this note stopped saying
    // that none of them was built - which is the mistake `/` made at step 2,
    // where the note went on contradicting the panel directly beneath it.
    // Which doors exist is the PANEL's sentence: it can say push and pull are
    // still missing, and a one-line note cannot say it without going stale.
    note: "Drawn by the shell. The planner as one file, out and back in. Nothing is fetched for this view.",
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
