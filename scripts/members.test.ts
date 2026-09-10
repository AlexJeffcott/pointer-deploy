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

      // The claim the whole gate rests on: members of ShellStore that no
      // sub-app calls, so removing any of them costs a sub-app nothing.
      for (const member of ["ShellStore.service", "ShellStore.setService"]) {
        expect(APPS.filter((a) => member in (reading.uses[a] ?? {}))).toEqual([]);
        expect(Object.keys(reading.provides)).toContain(member);
      }

      // And what the one app there is does call.
      for (const member of ["ShellStore.greeting", "ShellStore.setGreeting", "ShellStore.goingAway"]) {
        expect(Object.keys(reading.uses.hello!)).toContain(member);
      }

      // Ownership comes out at the FIELD and not at the type. The panel draws
      // both halves of the greeting, and reads two of the four dates and names
      // on a sunset - so a service retiring `reason` costs this panel nothing
      // and `readMembers` says so.
      const owner: Record<string, string[]> = {
        "Greeting.text": ["hello"],
        "Greeting.audience": ["hello"],
        "FieldSunset.sunset": ["hello"],
        "FieldSunset.instead": ["hello"],
        "FieldSunset.since": [],
        "FieldSunset.reason": [],
      };
      for (const [member, expected] of Object.entries(owner)) {
        const actual = APPS.filter((a) => member in (reading.uses[a] ?? {}));
        expect(`${member}: ${actual.join(",")}`).toBe(`${member}: ${expected.join(",")}`);
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

      // Read by the frame alone, so no sub-app records them. They are still
      // provided, and a removal would still be refused by the compiler where
      // the shell reads them - which is a different check, in a different file.
      for (const member of ["ServiceReport.serves", "ServiceReport.readAt", "ServiceReport.error"]) {
        expect(APPS.filter((a) => member in (reading.uses[a] ?? {}))).toEqual([]);
        expect(Object.keys(reading.provides)).toContain(member);
      }

      // A member nothing can be asked about, because cutting it stops the
      // surface being a surface. Reported, never counted as provided.
      expect(reading.structural).toContain("ShellStore");
      expect(Object.keys(reading.provides)).not.toContain("ShellStore");
      expect(Object.keys(reading.provides)).toContain("ShellStore.greeting");

      // Every member an app uses must be one the shell provides, or the gate
      // would refuse the composition this repository builds.
      for (const app of APPS) {
        for (const path of Object.keys(reading.uses[app] ?? {})) {
          expect(reading.provides[path]).toBe(reading.uses[app]![path]!);
        }
      }
    },
    SLOW,
  );
});
