// The surface between the SERVER and the shell, §11.
//
// Three JSON blocks in the document - `__BUILD__`, `__APPS__`, `__VERSIONS__` -
// written by `html.ts` and parsed in the browser by `loader.ts` and
// `versions.ts`. The contract hash covers `api.ts` and `subapp.ts`, which is
// the shell's surface with its SUB-APPS. This is its surface with the server,
// and nothing covered it: the server is not a unit, so `promote` had nowhere to
// look.
//
// Demonstrated on 2026-08-28, not hypothetically. Renaming `deployed` to `live`
// in `__VERSIONS__` broke shell `606c1c3c`, which the switcher itself offers:
// it went on reading `deployed`, got undefined, and pinned the query parameter
// where it should have cleared it. The page rendered, the composition worked,
// and the control quietly did the wrong thing.
//
// The reason it could happen is here: each block's shape was DECLARED TWICE,
// once on the writing side and once on the reading side, and nothing compared
// the two. Counted on 2026-08-29 - `AppAssets` in `html.ts` and in `loader.ts`,
// `VersionOption` in `composition.ts` and in `versions.ts`, `BuildInfo` in
// `html.ts` and `ShellBuildInfo` in the harness's `world.ts`. Three blocks, six
// declarations, no two of them checked against each other.
//
// One declaration each, here, and both sides import it. A renamed field is now
// a compile error on whichever side did not move.
//
// It lives under `src/server` and not beside the shell because the runtime
// stage of the Dockerfile copies `src/server` and nothing else: the server
// cannot reach `src/web`, and the shell can reach here. That is the same
// direction `composition.ts` already travels.
//
// What one file cannot do: this holds while both sides are COMPILED TOGETHER. A
// shell unit published six weeks ago is bytes in a store, and the server it
// meets today is a different deploy. That question is answered by
// `readBlockMembers` in `scripts/members.ts`, which measures WHICH fields the
// shell reads, and by `blockRefusal` in `composition.ts`, which compares them
// against `blocks.provides.json` at serve time.
//
// This file is TYPES ONLY, and has to stay that way. Every import of it goes
// through the `@pointer/blocks` path mapping, and the runtime image carries no
// tsconfig - so a value export here would resolve at build time and fail in the
// image. What the server needs at runtime is in `provides.ts` beside it,
// reached by a relative path.

/**
 * `__BUILD__`. What the page says about itself.
 *
 * Read by a person, by the acceptance harness and by the e2e scripts - not by
 * the shell bundle, which needs none of it. That makes it the one block whose
 * consumer is not a published unit.
 */
export type BuildInfo = {
  /**
   * The shell's unit id under schema 3.
   *
   * The page no longer has one build id - it has five - but a single field
   * naming the frame the visitor is looking at is still the thing to report
   * first, and every unit id is beside it in `units`.
   */
  buildId: string;
  commit: string;
  publishedAt: string;
  channel: string;
  region: string;
  /** Schema 3 only. Every unit in the composition, and the contract it ran at. */
  units?: Record<string, { unitId: string; commit: string; marker: string }>;
  contract?: string;
};

/** What the shell's loader is told about one sub-app. */
export type AppAssets = {
  js: string;
  css?: string;
  /**
   * The stylesheet's digest, when the unit published one.
   *
   * Only the stylesheet: a sub-app's script is imported by URL, and a dynamic
   * import takes no integrity argument. That one is attached in the import map
   * instead, which is the only place a module fetched by specifier can carry a
   * digest at all.
   */
  cssIntegrity?: string;
};

/** `__APPS__`. Every sub-app's absolute URLs, for the shell to fetch on demand. */
export type AppMap = Record<string, AppAssets>;

/** One choice a visitor can make, and whether it can be made. */
export type VersionOption = {
  unitId: string;
  marker: string;
  /** What this page is showing. */
  current: boolean;
  /**
   * True when this is what the channel's pointer names RIGHT NOW.
   *
   * Not "deployed": every id in this list has been deployed to this channel,
   * which is exactly what put it here. Only one of them is live.
   *
   * Distinct from `current`, which is what the visitor is looking at. The shell
   * needs both: choosing the live id must CLEAR the override rather than pin
   * it, or a link shared from this page would freeze at today's build and stop
   * following the channel.
   */
  live: boolean;
  /**
   * The same value as `live`, for a shell published before it was renamed.
   *
   * Retained on 2026-08-28, and this is the lesson it carries. These blocks are
   * APPEND-ONLY: a field may be added, and a field may stop being read, and a
   * field may never be renamed or removed while a shell that reads it is still
   * in a channel's history.
   */
  deployed: boolean;
  /**
   * True when choosing it would make a composition the shell cannot serve.
   *
   * Disabled rather than absent, because "this build exists and cannot be run
   * beside the others" is the reading an operator wants. Hiding it would say
   * the build was never deployed here, which is false of everything in this
   * list.
   */
  disabled: boolean;
};

/** `__VERSIONS__`. Every unit's choices, by unit. */
export type VersionsBlock = Record<string, VersionOption[]>;
