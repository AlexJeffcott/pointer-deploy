// The direction reading, §8. Build-time code, so it has no test home in
// `bun test src/server` - the `test` script names `scripts` for this.
//
// Every case here is a tsc run against a generated pair of surfaces. It is the
// slowest test file in the project and it is the only thing that proves the
// probes read the direction they claim to read.

import { describe, expect, test } from "bun:test";
import { directionFrom, readRegistry, readSurface, type Surface } from "./contract.ts";

/** Long enough for two tsc runs per comparison on a cold cache. */
const SLOW = 30_000;

const base: Surface = {
  "shell.d.ts": `export declare const buildMarker: string;
export type User = { name: string };
export type ShellStore = { user(): User; increment(ns: string, by?: number): void };
export declare function createStore(): ShellStore;
export declare function setColour(colour: string): void;
`,
  "subapp.d.ts": `import type { ShellStore } from "@pointer/shell";
export type SubAppProps = { store: ShellStore };
export type SubApp = (props: SubAppProps) => unknown;
`,
};

const shell = (text: string): Surface => ({ ...base, "shell.d.ts": text });
const subapp = (text: string): Surface => ({ ...base, "subapp.d.ts": text });

const broken = (d: Awaited<ReturnType<typeof directionFrom>>): string[] =>
  d.halves.filter((h) => !h.ok).map((h) => h.half);

describe("the direction of a surface change", () => {
  test(
    "a surface is additive over itself",
    async () => {
      expect(await directionFrom(base, base)).toMatchObject({ additive: true });
    },
    SLOW,
  );

  test(
    "an added export is additive",
    async () => {
      const d = await directionFrom(base, shell(`${base["shell.d.ts"]}export declare function reset(ns: string): void;\n`));
      expect(d.additive).toBe(true);
    },
    SLOW,
  );

  test(
    "a removed export breaks the shell half",
    async () => {
      const d = await directionFrom(
        base,
        shell(base["shell.d.ts"].replace("export declare const buildMarker: string;\n", "")),
      );
      expect(broken(d)).toEqual(["shell"]);
      expect(d.halves[0]?.output).toContain("buildMarker");
    },
    SLOW,
  );

  test(
    "a narrowed parameter breaks the shell half",
    async () => {
      const d = await directionFrom(
        base,
        shell(base["shell.d.ts"].replace("setColour(colour: string)", 'setColour(colour: "red" | "blue")')),
      );
      expect(broken(d)).toEqual(["shell"]);
      expect(d.halves[0]?.output).toContain("setColour");
    },
    SLOW,
  );

  // The trap the item named. A module-level probe passes here, because
  // subapp.d.ts exports no value and its module shape is empty.
  test(
    "a required member added to SubApp breaks the sub-app half",
    async () => {
      const d = await directionFrom(
        base,
        subapp(
          base["subapp.d.ts"].replace(
            "export type SubApp = (props: SubAppProps) => unknown;",
            "export type SubApp = ((props: SubAppProps) => unknown) & { displayName: string };",
          ),
        ),
      );
      expect(broken(d)).toEqual(["subapp"]);
    },
    SLOW,
  );

  // A module shape carries values only, so this half of the surface is
  // invisible unless the probes check declaration files. It is reported
  // against the sub-app half: subapp.d.ts is the file that imports the type.
  test(
    "a renamed type export breaks the sub-app half",
    async () => {
      const d = await directionFrom(base, shell(base["shell.d.ts"].replace(/ShellStore/g, "Store")));
      expect(broken(d)).toEqual(["subapp"]);
      expect(d.halves[1]?.output).toContain("ShellStore");
    },
    SLOW,
  );

  // A sub-app is handed ONE prop and reads what it needs. A second is the
  // cheap change api.ts claims it is.
  test(
    "a second prop is additive",
    async () => {
      const d = await directionFrom(
        base,
        subapp(base["subapp.d.ts"].replace("{ store: ShellStore }", "{ store: ShellStore; theme: string }")),
      );
      expect(d.additive).toBe(true);
    },
    SLOW,
  );

  // Not a fixture. The two surfaces this repository has actually published,
  // and the change between them - a mount() function became a component - is
  // the one every published sub-app had to be rebuilt for.
  test(
    "the published pair reads as not additive",
    async () => {
      const registry = await readRegistry();
      const older = registry.contracts.find((c) => c.name === "counters-2026-08");
      const newer = registry.contracts.find((c) => c.name === "injected-store-2026-08");
      if (!older || !newer) throw new Error("the registry no longer holds the pair this reads");

      const d = await directionFrom(await readSurface(older), await readSurface(newer));
      expect(d.additive).toBe(false);
      expect(broken(d).length).toBeGreaterThan(0);
    },
    SLOW,
  );
});
