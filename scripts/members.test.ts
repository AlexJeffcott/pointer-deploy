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

      // The claim the whole gate rests on: two of ShellStore's members are
      // called by no sub-app, so removing either must cost nothing.
      expect(Object.keys(reading.uses.alpha!)).not.toContain("ShellStore.setName");
      expect(Object.keys(reading.uses.bravo!)).not.toContain("ShellStore.setName");
      expect(Object.keys(reading.uses.charlie!)).not.toContain("ShellStore.setColour");
      expect(Object.keys(reading.uses.delta!)).not.toContain("ShellStore.setColour");

      // And one that exactly one app calls.
      expect(Object.keys(reading.uses.bravo!)).toContain("ShellStore.reset");
      expect(Object.keys(reading.uses.alpha!)).not.toContain("ShellStore.reset");
      expect(Object.keys(reading.uses.charlie!)).not.toContain("ShellStore.reset");

      // Every app reads the store and the user, so these are universal.
      for (const app of APPS) {
        expect(Object.keys(reading.uses[app]!)).toContain("ShellStore.increment");
        expect(Object.keys(reading.uses[app]!)).toContain("User.name");
      }

      // A member nothing can be asked about, because cutting it stops the
      // surface being a surface. Reported, never counted as provided.
      expect(reading.structural).toContain("ShellStore");
      expect(Object.keys(reading.provides)).not.toContain("ShellStore");
      expect(Object.keys(reading.provides)).toContain("ShellStore.reset");

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
