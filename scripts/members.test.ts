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

      // Every app asks who the user is, and paints itself in their colour.
      for (const app of APPS) {
        expect(Object.keys(reading.uses[app]!)).toContain("ShellStore.user");
        expect(Object.keys(reading.uses[app]!)).toContain("User.colour");
      }

      // The counters are not universal. echo reports on the service and takes
      // no part in the shared state, so a member removed from the counting half
      // of the surface costs it nothing.
      for (const app of APPS.filter((a) => a !== "echo")) {
        expect(Object.keys(reading.uses[app]!)).toContain("ShellStore.increment");
        expect(Object.keys(reading.uses[app]!)).toContain("User.name");
      }
      expect(Object.keys(reading.uses.echo!)).not.toContain("ShellStore.increment");

      // The service half, §26, splits the apps the other way: two ask whether
      // one field is going away, three read the whole report, and each records
      // only what it asked for.
      for (const app of ["alpha", "bravo"]) {
        expect(Object.keys(reading.uses[app]!)).toContain("ShellStore.goingAway");
        expect(Object.keys(reading.uses[app]!)).not.toContain("ShellStore.service");
      }
      for (const app of ["charlie", "delta", "echo"]) {
        expect(Object.keys(reading.uses[app]!)).toContain("ShellStore.service");
        expect(Object.keys(reading.uses[app]!)).not.toContain("ShellStore.goingAway");
      }
      // Nothing but the shell writes it.
      for (const app of APPS) {
        expect(Object.keys(reading.uses[app]!)).not.toContain("ShellStore.setService");
        expect(Object.keys(reading.uses[app]!)).not.toContain("ShellStore.setSettings");
        expect(Object.keys(reading.uses[app]!)).not.toContain("ShellStore.setUser");
      }

      // §27, and the reading the whole widening was for: ownership at the
      // FIELD, not at the resource. Removing one field of `Limits` refuses
      // exactly the apps that draw with it, and `readMembers` says which.
      const owner: Record<string, string[]> = {
        "Limits.step": ["alpha"],
        "Limits.max": ["alpha", "bravo"],
        "Limits.allowNegative": ["bravo"],
        "Label.title": ["charlie", "delta"],
        "Label.emoji": ["delta"],
        "Flags.showTotals": ["charlie"],
        "Flags.showShares": ["delta"],
        "Stats.total": ["charlie"],
        "Stats.busiest": ["delta"],
        "Stats.updatedAt": ["echo"],
        "User.initials": ["charlie"],
      };
      for (const [member, expected] of Object.entries(owner)) {
        const actual = APPS.filter((a) => member in (reading.uses[a] ?? {}));
        expect(`${member}: ${actual.join(",")}`).toBe(`${member}: ${expected.join(",")}`);
      }

      // Two members of this surface hold the SAME TEXT, so they hold the same
      // digest: `colour: string;` is both `Theme.colour` and `User.colour`,
      // and `path: string;` is both `ServiceField.path` and `ServiceRoute.path`.
      // The probe used to name its scratch directory after the digest, so each
      // pair shared one directory, raced across lanes, and compiled against
      // whichever cut surface won - which read as "nobody uses this" for a
      // member every app calls. Named after the path now. Asserted here so the
      // pair stays a pair: if a rename ever pulls the digests apart, this fails
      // and says the guard is no longer exercised rather than passing quietly.
      for (const [a, b] of [
        ["Theme.colour", "User.colour"],
        ["ServiceField.path", "ServiceRoute.path"],
      ]) {
        expect(reading.provides[a!]).toBe(reading.provides[b!]!);
      }
      expect(APPS.filter((app) => "User.colour" in (reading.uses[app] ?? {}))).toEqual([...APPS]);
      expect(APPS.filter((app) => "Theme.colour" in (reading.uses[app] ?? {}))).toEqual([]);

      // Read by the frame alone, so no sub-app records them. They are still
      // provided, and a removal would still be refused by the compiler where
      // the shell reads them - which is a different check, in a different file.
      for (const member of ["Flags.compact", "Theme.dark", "ShellStore.motd"]) {
        expect(APPS.filter((a) => member in (reading.uses[a] ?? {}))).toEqual([]);
        expect(Object.keys(reading.provides)).toContain(member);
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
