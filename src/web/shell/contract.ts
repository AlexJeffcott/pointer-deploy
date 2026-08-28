// The shell's conformance, in one file.
//
// The shell is a conforming party, not the definition of the contract. Its
// call sites already typecheck against whatever api.ts happens to export, so
// they prove nothing about a contract minted six weeks ago. This file is what
// the matrix compiles against each retained contract in turn: when
// "@pointer/shell" is re-pointed at a contract's shell.d.ts, the assignment
// below fails if the shell no longer provides what that contract declared.
//
// Never bundled. It is not an entrypoint of any build.

import type * as Contract from "@pointer/shell";
import type { SubAppProps } from "@pointer/subapp";
import * as actual from "./api.ts";

/** Extra exports are fine. Missing or narrowed ones are not. */
export const provides: typeof Contract = actual;

/**
 * The other direction, and the whole of §16.
 *
 * The shell CONSUMES a sub-app: it constructs the props and renders the
 * component. Before this, no file in src/web/shell resolved "@pointer/subapp" -
 * loader.ts took SubApp from a relative path - so the matrix re-pointed a
 * specifier the shell never used, and the sub-app half was checked from the
 * sub-app side only. A required prop could be added, used by the shell, and
 * every published sub-app stayed promotable.
 *
 * loader.ts now imports the contract specifier too. This line covers the props.
 */
declare const store: Contract.ShellStore;
export const passes: SubAppProps = { store };
