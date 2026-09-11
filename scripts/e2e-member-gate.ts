// Proves the member gate, §9, against the real store and the real scripts.
//
//   bun run e2e:members
//
// It cannot, on this slate, and this file says so rather than passing.
//
// The check removed one member from `ShellStore` - one a sub-app called -
// published only the shell, and promoted; the refusal had to name the sub-app
// and the member. Then it rebuilt the sub-app without the call and the same
// promote had to succeed. The gate is measured by what a SUB-APP uses, so both
// halves need one. `PLAN.md` step 0 takes the tree to the shell alone, and the
// shell is not asked: it is the provider, and `scripts/members.ts` says why.
//
// It comes back at `PLAN.md` step 1, against `list`, and step 10 is where it
// gets the half it never had - "and nothing else" - because that is the first
// step with two sub-apps and a member only one of them calls. The full script
// is at commit ff196d5 and is restored from there rather than rewritten.
//
// This exits NON-ZERO on purpose, for the reason
// `scripts/e2e-independent-deploy.ts` gives.

import { APPS } from "./contract.ts";

if (APPS.length === 0) {
  console.error(
    "bun run e2e:members proves that dropping a member of the shell's surface " +
      "refuses the sub-apps that called it. This tree builds no sub-app, so there " +
      "is nothing that uses any member and nothing to refuse.\n\n" +
      "  Restored at PLAN.md step 1, from the version at commit ff196d5.\n" +
      "  TODO.md §31 records what the claim has instead.",
  );
  process.exit(1);
}

throw new Error(
  "a sub-app exists again. Restore scripts/e2e-member-gate.ts from ff196d5 rather " +
    "than writing a new one.",
);
