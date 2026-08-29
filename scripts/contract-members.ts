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

const unused = Object.keys(reading.provides).filter(
  (path) => !APPS.some((app) => (reading.uses[app] ?? {})[path]),
);
console.error(
  unused.length
    ? `${unused.length} used by no sub-app: ${unused.join(", ")}`
    : "every member is used by at least one sub-app",
);

// stdout carries the machine-readable result and nothing else.
console.log(JSON.stringify({ provides: reading.provides, uses: reading.uses }, null, 2));
