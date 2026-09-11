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
      expect(APPS).toEqual(["list"]);
      expect(Object.keys(reading.uses.list ?? {}).sort()).toEqual([
        "FieldSunset.instead",
        "FieldSunset.sunset",
        "ShellStore.addTask",
        "ShellStore.goingAway",
        "ShellStore.removeTask",
        "ShellStore.setTags",
        "ShellStore.tasks",
        "Task.id",
        "Task.tags",
        "Task.title",
      ]);

      // The other half of §9, and the one `promote` refuses on just as hard: a
      // member the shell PROVIDES that no app calls costs that app nothing.
      // `service` and `setService` are the frame's own, so a shell that dropped
      // them would refuse nothing here - which is the reading, not a gap.
      for (const member of ["ShellStore.service", "ShellStore.setService"]) {
        expect(Object.keys(reading.provides)).toContain(member);
        expect(Object.keys(reading.uses.list ?? {})).not.toContain(member);
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
        "ShellStore.service",
        "ShellStore.setService",
        "Task.title",
        "Task.tags",
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
