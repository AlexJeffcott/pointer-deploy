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
 * `PLAN.md` step 1 places the first, step 4 the second and step 5 the third,
 * which is all of them. `/` names `list`, `/board` names `board` and `/week`
 * names `week`; `/service` and `/backup` never get one, because the frame
 * draws them from their own state, and the claim that a view naming no unit is
 * legitimate keeps its subject. `placementProblems` below refuses the two ways
 * placement and the build can disagree.
 *
 * The shell warms EVERY unit the composition carries - three of them - and two
 * of those are off the landing route, so four of the six warmed files are for a
 * view a visitor may never open. `list`'s pair buys nothing, because `/` is
 * about to import it anyway; that is the reading nothing could take until step
 * 4 put a unit somewhere else. `board` was the first, and is where the warm was
 * measured.
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
    apps: ["board"],
    // Where the tasks are KEPT is not said here either - the same reason `/`
    // gives. What this note can say is the placement fact, which is the one
    // thing about this view that does not change when a panel changes.
    note: "One panel per column, and a task moves between them.",
  },
  "/week": {
    title: "Week",
    apps: ["week"],
    // Where the tasks are kept is the PANEL's sentence, the same as `/` and
    // `/board`. What a note can say is the placement fact. This one said no
    // unit was placed here until step 5 landed, which is the mistake `/` made
    // at step 2 and `/board` at step 4: a note that goes on contradicting the
    // panel directly beneath it.
    note: "Seven days, Monday to Sunday, and every task that has a date.",
  },
  "/service": {
    title: "Service",
    apps: [],
    note: "Drawn by the shell from the one reading it took of the service. Nothing is fetched for this view.",
  },
  "/backup": {
    title: "Backup",
    apps: [],
    // Step 3 built the first two doors and step 6 the other two, so this note
    // no longer says a file is all there is - which is the mistake `/` made at
    // step 2, where the note went on contradicting the panel directly beneath
    // it. What the note can say is the placement fact and where the reading is
    // taken; which doors exist is the PANEL's sentence.
    //
    // "Nothing is fetched for this view" is still true and is about the same
    // thing it was: no UNIT is fetched, because none is placed here. Push and
    // pull reach the service when a person presses them, which is not a fetch
    // the view makes to draw itself.
    note: "Drawn by the shell. The planner out and back in: as a file, or as a snapshot the service keeps. No unit is fetched for this view.",
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
