// Which member of the shell's surface each sub-app actually uses.
//
//   bun run contract:members
//
// The reading `build.ts` records on every unit and `promote` refuses on. This
// is the command that shows it to a person: a member no column marks is one the
// shell could drop today without refusing anything.

import { APPS, emitSurface } from "./contract.ts";
import { readMembers, renderMembers } from "./members.ts";

const reading = await readMembers(await emitSurface(), [...APPS]);
console.error(renderMembers(reading, [...APPS]));
console.error(`\n${Object.keys(reading.provides).length} members read in ${reading.ms} ms`);

// With no sub-app the answer is every member, and that is not a finding: a
// member "used by no sub-app" is a member the shell could drop without refusing
// anything, which is only worth reading when there is something to refuse.
if (APPS.length === 0) {
  console.error(
    "no sub-app is built on this slate, so nothing uses any of these members. " +
      "The reading comes back when PLAN.md step 1 lands.",
  );
} else {
  const unused = Object.keys(reading.provides).filter(
    (path) => !(APPS as string[]).some((app) => (reading.uses[app] ?? {})[path]),
  );
  console.error(
    unused.length
      ? `${unused.length} used by no sub-app: ${unused.join(", ")}`
      : "every member is used by at least one sub-app",
  );
}

// stdout carries the machine-readable result and nothing else.
console.log(JSON.stringify({ provides: reading.provides, uses: reading.uses }, null, 2));
