// What this unit knows about a week, with no panel around it.
//
// A module of its own so `week.test.ts` can read it without a browser, a
// stylesheet or a JSX runtime. A cold read on 2026-09-13 asked why the Monday
// rule - the design claim of the whole unit - was checked only by a browser
// scenario running against the real clock, which is a check whose answer
// depends on the day it is run.
//
// None of this is on the contract surface. `columns()` is, because `board`
// draws one panel per column and a task moves between them, so two units have
// to agree on the set. Nothing has to agree with a week: a date is a date and
// `setDue` takes it.

const DAY_MS = 86_400_000;

/**
 * The names of the days and months, written out rather than formatted.
 *
 * `toLocaleDateString` reads the browser's locale, so two visitors would see
 * two different pages and two screenshots of one composition would differ for
 * a reason the deploy record cannot name. The set is fixed here instead.
 */
const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;
const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
] as const;

const iso = (at: number): string => new Date(at).toISOString().slice(0, 10);

/**
 * The seven days of the week `now` falls in, Monday first.
 *
 * Monday to Sunday and not "the next seven days": a week is a window two
 * people can agree on, and a rolling window means a task drawn today is on a
 * different panel tomorrow for no reason a person did anything about.
 *
 * The visitor's own midnight, read through the local getters and then held as
 * UTC. `new Date().toISOString()` alone would put a visitor east of Greenwich
 * on tomorrow's panel for part of every evening.
 *
 * This is the whole of what this unit knows about a week, and it is NOT on the
 * contract surface. The columns are, because `board` draws one panel per
 * column and a task moves between them, so two units have to agree on the set.
 * Nothing has to agree with this one: a date is a date, and `setDue` takes it.
 */
export function weekOf(now: Date): string[] {
  const midnight = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
  const weekday = (new Date(midnight).getUTCDay() + 6) % 7;
  const monday = midnight - weekday * DAY_MS;
  return Array.from({ length: 7 }, (_, i) => iso(monday + i * DAY_MS));
}

/**
 * `2026-09-14` reads `Mon 14 Sep`, and the weekday comes off the DATE.
 *
 * Not off the day's position in the row, which is what this did until a cold
 * read on 2026-09-13. `WEEKDAYS[index]` cannot disagree with the position, so a
 * week anchored on the wrong day drew `MON 6 SEP` - confidently wrong, visible
 * to nobody except a harness reading `data-day`, and invisible in the deploy
 * record's pictures. Read from the date, the heading contradicts itself on the
 * page and the picture shows it.
 */
export const label = (day: string): string => {
  const at = new Date(`${day}T00:00:00Z`);
  const weekday = (at.getUTCDay() + 6) % 7;
  return `${WEEKDAYS[weekday]} ${Number(day.slice(8, 10))} ${MONTHS[Number(day.slice(5, 7)) - 1]}`;
};
