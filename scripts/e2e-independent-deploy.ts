// Does per-unit deploy and rollback actually work, from a browser's point of
// view?
//
//   bun run e2e
//
// It cannot, on this slate, and this file says so rather than passing.
//
// The check drove the documented commands end to end - build, publish, promote
// one unit, roll that one unit back - and then read the RENDERED PAGE, because
// the marker each unit painted into the DOM is the only place "hello moved and
// the shell did not" is a fact about the application rather than a fact about a
// JSON file. Every one of those sentences needs two units. `PLAN.md` step 0
// takes the tree to one: the shell draws five views and none of them places a
// sub-app, so there is nothing to move independently of anything.
//
// It comes back at `PLAN.md` step 1, against `list`. The full script is at
// commit ff196d5 and is restored from there rather than rewritten.
//
// This exits NON-ZERO on purpose. `~/projects/CLAUDE.md` is explicit that a
// green check is never sufficient evidence, and a command that exited 0 while
// measuring nothing is worse than one that refuses: `bun run e2e` is named in
// CLAUDE.md as the check that catches what every other check can be green
// through, so it must not be readable as having run.

import { APPS } from "./contract.ts";

if (APPS.length === 0) {
  console.error(
    "bun run e2e proves that one unit deploys and rolls back without moving the " +
      "others. This tree builds one unit - the shell - so there is no second unit " +
      "to hold still, and nothing here would be evidence.\n\n" +
      "  Restored at PLAN.md step 1, from the version at commit ff196d5.\n" +
      "  Until then: TODO.md §31 records what this claim has instead, which is nothing.",
  );
  process.exit(1);
}

throw new Error(
  "a sub-app exists again. Restore scripts/e2e-independent-deploy.ts from ff196d5 " +
    "rather than writing a new one.",
);
