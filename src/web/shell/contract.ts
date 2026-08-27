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
import * as actual from "./api.ts";

/** Extra exports are fine. Missing or narrowed ones are not. */
export const provides: typeof Contract = actual;
