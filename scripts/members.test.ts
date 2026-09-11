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

      // On this slate there is no app to measure. `PLAN.md` step 0 is the frame
      // alone, so `uses` is empty by construction and the half of §9 that says
      // "a dropped member refuses exactly the apps that called it" has nothing
      // to call it - TODO §31 carries that. What is still measured here is the
      // other half, which `promote` gates on just as hard: what the shell
      // PROVIDES, and which members cannot be asked about at all.
      expect(APPS).toEqual([]);
      expect(Object.values(reading.uses).flatMap((u) => Object.keys(u))).toEqual([]);

      // Every member of the store the shell hands a sub-app, whether or not one
      // exists to hand it to. A promote compares a published app's `uses`
      // against this, so an empty reading here would admit any composition.
      for (const member of [
        "ShellStore.greeting",
        "ShellStore.setGreeting",
        "ShellStore.goingAway",
        "ShellStore.service",
        "ShellStore.setService",
        "Greeting.text",
        "Greeting.audience",
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
