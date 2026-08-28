// Where each sub-app appears, and on which route.
//
// The shell owns placement. That was already true - `scripts/contract.ts` names
// the units, `build.ts` emits what that names, and this table decides which of
// them appear, on which route, in what order - and it had never been written
// down. Decided on 2026-08-28, TODO §14. The manifest names bundles and chooses
// nothing.
//
// Two consequences, and both are the price of that answer:
//
//   - a layout change is a shell publish and a promote, so alpha cannot be
//     moved from "/" to "/totals" by pointing a channel somewhere else;
//   - rolling the shell back rolls the layout back with it, because the layout
//     and the shell are one unit.
//
// This file is imported by `build.ts` and by the step definitions as well as by
// the shell, which is the third consequence and the one this file exists to
// remove: the layout used to be written down twice, here and in
// `features/steps/shared-state.steps.ts`, with nothing tying the copies
// together. So it holds no CSS, no JSX and nothing the browser alone provides.

export type View = {
  title: string;
  apps: readonly string[];
  note: string;
};

/** Route to what the shell draws there. The key is the pathname. */
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

/** The route the shell falls back to. A path no view names renders this one. */
export const DEFAULT_ROUTE = "/";

/** Every app some view places, once each, in the order the views place them. */
export function placedApps(views: Record<string, View> = VIEWS): string[] {
  const seen = new Set<string>();
  for (const view of Object.values(views)) {
    for (const app of view.apps) seen.add(app);
  }
  return [...seen];
}

/**
 * What the build must refuse: the table and the manifest disagreeing.
 *
 * Two directions, and only one of them has ever reported itself. An app a view
 * places that the build does not emit is caught at runtime by AsyncAppLoader,
 * which says the manifest names no bundle for it. An app the build DOES emit
 * that no view places is fetched never, rendered never, and reported by
 * nothing at all - it is published, promoted, paid for and invisible.
 *
 * What this does NOT cover, and cannot: the ROUTE. Moving charlie from
 * "/totals" to "/" leaves both sets identical, so only a scenario catches it.
 */
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
