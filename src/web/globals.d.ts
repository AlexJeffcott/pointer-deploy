/** Replaced at build time by build.ts. Empty in a plain local build. */
declare const __BUILD_MARKER__: string;

/**
 * Replaced per unit at build time. Empty in a plain local build.
 *
 * Each unit is built separately, so this differs between the shell and each
 * sub-app. It is rendered into the DOM so that "alpha moved and bravo did not"
 * is something a browser can be asked, rather than something inferred from
 * two manifest ids.
 */
declare const __UNIT_MARKER__: string;
