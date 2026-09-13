// The removal prober, §9. Build-time code, so it lives in the `scripts` home
// the test script names.
//
// `readMembers` compiles the real units, so it costs real tsc runs. One call,
// and everything measurable is read off it.

import { describe, expect, test } from "bun:test";
import { APPS, emitSurface, type Surface } from "./contract.ts";
import { membersOf, readMembers } from "./members.ts";

const SLOW = 60_000;

const surface = (shell: string): Surface => ({
  "shell.d.ts": shell,
  "subapp.d.ts": "export type SubApp = () => unknown;\n",
});

describe("membersOf", () => {
  test("names a top-level declaration and every member of a type literal in it", () => {
    const found = membersOf(
      surface(`export type User = {
    name: string;
};
export type Store = {
    user(): User;
    reset(ns: string): void;
};
export declare function createStore(): Store;
`),
    );
    expect(found.map((m) => m.path)).toEqual([
      "createStore",
      "Store",
      "Store.reset",
      "Store.user",
      "User",
      "User.name",
    ]);
  });

  test("reaches a type literal nested inside another", () => {
    const found = membersOf(surface("export type A = { b: { c: string } };\n"));
    expect(found.map((m) => m.path)).toContain("A.b.c");
  });

  // A VariableStatement carries its names on its declarators and has none of
  // its own, so the reader skipped every exported constant in the surface -
  // `NO_SERVICE` today, `DEFAULT_GREETING` in the contract before it. A member
  // nothing probes is a member the gate can never refuse anything for, while
  // `build.ts` says `provides` is every removable member there is.
  test("names an exported const, which has no name of its own to read", () => {
    const found = membersOf(surface("export declare const NO_SERVICE: Report;\n"));
    expect(found.map((m) => m.path)).toEqual(["NO_SERVICE"]);
  });

  // The cut has to leave a file that still parses. One declarator is the whole
  // statement; several means taking a separating comma with the one being cut,
  // or the surface stops being a surface and every unit reads as using it.
  test("cutting one of several declarators leaves the rest parseable", () => {
    const text = "export declare const A: X, B: Y;\n";
    const found = membersOf(surface(text));
    expect(found.map((m) => m.path)).toEqual(["A", "B"]);
    const cutOf = (path: string) => {
      const m = found.find((f) => f.path === path)!;
      return text.slice(0, m.start) + text.slice(m.end);
    };
    expect(cutOf("A")).toBe("export declare const B: Y;\n");
    expect(cutOf("B")).toBe("export declare const A: X;\n");
  });

  // The digest is what promote compares. The text it covers is what tsc EMITS,
  // so its formatting is already canonical; indentation and line endings are
  // all a surface can differ by, and those are normalised away.
  test("indentation does not move the digest and a narrowing does", () => {
    const one = membersOf(surface("export type S = {\n    f(a: string): void;\n};\n"));
    const indented = membersOf(surface("export type S = {\n\t\tf(a: string): void;   \n};\n"));
    const narrowed = membersOf(surface('export type S = {\n    f(a: "x"): void;\n};\n'));
    const digestOf = (ms: typeof one, path: string) => ms.find((m) => m.path === path)!.digest;
    expect(digestOf(indented, "S.f")).toBe(digestOf(one, "S.f"));
    expect(digestOf(narrowed, "S.f")).not.toBe(digestOf(one, "S.f"));
  });
});

describe("readMembers, against the surface this repository ships", () => {
  test(
    "measures which app uses what",
    async () => {
      const reading = await readMembers(await emitSurface(), [...APPS]);

      // §9's first half, and it has a subject again at `PLAN.md` step 1: use is
      // measured by REMOVAL, so this is the list of declarations whose absence
      // stops `list` compiling. The set is exactly what `PLAN.md`'s contract
      // table gives the unit, which is the point of that table being a
      // constraint rather than a description.
      expect(APPS).toEqual(["list", "board", "week"]);
      expect(Object.keys(reading.uses.list ?? {}).sort()).toEqual([
        "FieldSunset.instead",
        "FieldSunset.sunset",
        "PlannerReport.state",
        "ShellStore.addTask",
        "ShellStore.goingAway",
        "ShellStore.planner",
        "ShellStore.removeTask",
        "ShellStore.setTags",
        "ShellStore.tasks",
        "Task.id",
        "Task.tags",
        "Task.title",
      ]);

      // `PLAN.md` step 4's row of the same table. `Task.column` and `Task.due`
      // were in nobody's set on 2026-09-11 because nothing moved either; the
      // board moves one, so the reading picks it up without anybody declaring
      // it.
      expect(Object.keys(reading.uses.board ?? {}).sort()).toEqual([
        "Column.id",
        "Column.label",
        "PlannerReport.state",
        "ShellStore.columns",
        "ShellStore.moveTask",
        "ShellStore.planner",
        "ShellStore.tasks",
        "Task.column",
        "Task.id",
        "Task.title",
      ]);

      // `PLAN.md` step 5's row, and the one that takes `Task.due` out of
      // nobody's set. The days are NOT here: this unit computes its own week
      // from the clock, because nothing else has to agree with it, which is
      // exactly the argument that put `columns()` on the surface for `board`.
      expect(Object.keys(reading.uses.week ?? {}).sort()).toEqual([
        "PlannerReport.state",
        "ShellStore.planner",
        "ShellStore.setDue",
        "ShellStore.tasks",
        "Task.due",
        "Task.id",
        "Task.title",
      ]);

      // The whole of what step 10 demonstrates, measured here before the
      // promote can refuse on it: each unit holds at least one member NO other
      // unit calls, so dropping that member refuses THAT unit and no other.
      // Named per unit rather than looped over a pair, because the claim is
      // about each one against all the rest and there are three of them now.
      const uses = (app: string) => Object.keys(reading.uses[app] ?? {});
      const only: Record<string, string[]> = {
        list: ["ShellStore.addTask", "ShellStore.removeTask", "ShellStore.setTags"],
        board: ["ShellStore.columns", "ShellStore.moveTask"],
        week: ["ShellStore.setDue"],
      };
      for (const [app, members] of Object.entries(only)) {
        for (const member of members) {
          expect(uses(app)).toContain(member);
          for (const other of APPS.filter((a) => a !== app)) {
            expect(uses(other)).not.toContain(member);
          }
        }
      }

      // The other half of §9, and the one `promote` refuses on just as hard: a
      // member the shell PROVIDES that no app calls costs that app nothing.
      // `service` and `setService` are the frame's own, so a shell that dropped
      // them would refuse nothing here - which is the reading, not a gap.
      for (const member of ["ShellStore.service", "ShellStore.setService"]) {
        expect(Object.keys(reading.provides)).toContain(member);
        for (const app of APPS) expect(uses(app)).not.toContain(member);
      }

      // The exported constant, which no reading saw until 2026-09-11 because a
      // `const` statement has no name of its own. It is removable - nothing in
      // either declaration file names it - so it belongs in `provides`, and no
      // sub-app calls it, so it belongs in nobody's `uses`.
      expect(Object.keys(reading.provides)).toContain("NO_SERVICE");
      expect(Object.keys(reading.uses.list ?? {})).not.toContain("NO_SERVICE");

      // Every member of the store the shell hands a sub-app. A promote compares
      // a published app's `uses` against this, so an empty reading here would
      // admit any composition.
      for (const member of [
        "ShellStore.tasks",
        "ShellStore.addTask",
        "ShellStore.setTags",
        "ShellStore.removeTask",
        "ShellStore.goingAway",
        "ShellStore.columns",
        "ShellStore.moveTask",
        "ShellStore.setDue",
        "ShellStore.service",
        "ShellStore.setService",
        "Task.title",
        "Task.tags",
        "Task.due",
        "FieldSunset.sunset",
        "FieldSunset.instead",
        "ServiceReport.serves",
        "ServiceReport.readAt",
        "ServiceReport.error",
      ]) {
        expect(Object.keys(reading.provides)).toContain(member);
      }

      // Two members of this surface hold the SAME TEXT, so they hold the same
      // digest: `path: string;` is both `ServiceField.path` and
      // `ServiceRoute.path`. The probe used to name its scratch directory after
      // the digest, so each pair shared one directory, raced across lanes, and
      // compiled against whichever cut surface won - which read as "nobody uses
      // this" for a member every app calls. Named after the path now. Asserted
      // here so the pair stays a pair: if a rename ever pulls the digests
      // apart, this fails and says the guard is no longer exercised rather than
      // passing quietly.
      expect(reading.provides["ServiceField.path"]).toBe(reading.provides["ServiceRoute.path"]!);

      // A member nothing can be asked about, because cutting it stops the
      // surface being a surface. Reported, never counted as provided.
      expect(reading.structural).toContain("ShellStore");
      expect(Object.keys(reading.provides)).not.toContain("ShellStore");
    },
    SLOW,
  );
});
