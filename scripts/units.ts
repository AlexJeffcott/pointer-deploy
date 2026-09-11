// Prints every published unit id, so a promote can name one without anybody
// having to remember it.
//
//   bun run units                 # every unit an operator may deploy
//   bun run units hello           # one unit
//   bun run units --all           # and the builds the harness made
//   bun run units --rebuild       # rebuild the catalogue from the store first
//   bun run units --json          # the catalogue itself, for a script
//
// The catalogue is written by `publish`, so the plain form costs one GET and
// needs no LIST. `--rebuild` is for the case where a publish died between
// writing a unit and writing the catalogue.
//
// A build the harness made is IN the catalogue and hidden here. `promote`
// refuses one on a real channel and the server offers one on a `test-*` channel
// alone, so an operator reading this table is reading builds they can deploy -
// 112 of the 129 units in the store on 2026-08-31 were the harness's.
//
// The tell is the marker, and a harness that forgets to set one publishes into
// this table as an ordinary build. That happened: `bun run e2e:members` cut
// `goingAway` out of `ShellStore` and published the result with no marker, and
// on 2026-09-11 a deliberately broken shell was the FIRST row here with a
// promote command printed under it. The probe sets a marker now. What this file
// does about the class of it is the last paragraph of the run: the command it
// suggests is never a unit built from a dirty tree, because such a build's bytes
// came from source no commit holds and naming an id is the one promote that
// takes no source check.

import { configFromEnv } from "./store.ts";
import { UNITS, type Unit } from "./contract.ts";
import { countOf, readCatalogue, rebuildCatalogue } from "./catalogue.ts";
import type { Catalogue } from "../src/server/composition.ts";

const argv = process.argv.slice(2);
const wantsJson = argv.includes("--json");
const wantsAll = argv.includes("--all");
const wantsRebuild = argv.includes("--rebuild");
// Ignores the catalogue that exists, so a rebuild cannot inherit anything wrong
// in it. `--rebuild` alone re-reads only the manifests the store says moved.
const wantsFull = argv.includes("--full");
const named = argv.filter((a) => !a.startsWith("-"));

for (const name of named) {
  if (!UNITS.includes(name as Unit)) {
    console.error(`unknown unit ${JSON.stringify(name)}. Expected one of ${UNITS.join(", ")}.`);
    process.exit(1);
  }
}

const cfg = configFromEnv();

let catalogue: Catalogue | null;
if (wantsRebuild) {
  const previous = wantsFull ? null : await readCatalogue(cfg).catch(() => null);
  const built = await rebuildCatalogue(cfg, previous);
  console.error(
    `rebuilt: ${countOf(built.catalogue)} units listed, ${built.marked} of them harness builds. ` +
      `Read ${built.scanned - built.reused} of ${built.scanned}` +
      (built.unreadable ? `, ${built.unreadable} unreadable` : ""),
  );
  catalogue = built.catalogue;
} else {
  catalogue = await readCatalogue(cfg).catch((err: unknown) => {
    console.error(`the catalogue could not be read: ${err instanceof Error ? err.message : String(err)}`);
    console.error("Run `bun run units --rebuild` to write it again from the store.");
    process.exit(1);
  });
}

if (catalogue === null) {
  console.error("no catalogue is in the store. Run `bun run units --rebuild` to write one.");
  process.exit(1);
}

if (wantsJson) {
  console.log(JSON.stringify(catalogue, null, 2));
  process.exit(0);
}

const shown = named.length ? named : Object.keys(catalogue.units);
let hidden = 0;
const rows = shown.flatMap((name) =>
  (catalogue.units[name] ?? [])
    .filter((e) => {
      if (wantsAll || (e.unit.marker ?? "") === "") return true;
      hidden++;
      return false;
    })
    .map((e) => ({
      unit: name,
      id: e.unit.unitId,
      published: (e.publishedAt ?? "").slice(0, 10) || "unknown",
      commit: e.dirty ? `${e.unit.commit.slice(0, 8)}+dirty` : e.unit.commit.slice(0, 8),
      dirty: Boolean(e.dirty),
      marker: e.unit.marker ?? "",
      surface:
        name === "shell"
          ? `${Object.keys(e.surface?.provides ?? {}).length} members provided`
          : Object.keys(e.surface?.uses ?? {}).length > 0
            ? `${Object.keys(e.surface!.uses!).length} members used`
            : e.contracts.join(", ") || "no contract",
    })),
);

if (rows.length === 0) {
  console.error(`the catalogue names no ${named.length ? named.join(", ") : "units"}.`);
  process.exit(1);
}

const width = (pick: (r: (typeof rows)[number]) => string) =>
  Math.max(...rows.map((r) => pick(r).length));
const w = {
  unit: width((r) => r.unit),
  id: width((r) => r.id),
  published: width((r) => r.published),
  commit: width((r) => r.commit),
};

for (const r of rows) {
  console.log(
    `${r.unit.padEnd(w.unit)}  ${r.id.padEnd(w.id)}  ${r.published.padEnd(w.published)}  ` +
      `${r.commit.padEnd(w.commit)}  ${r.marker ? `harness ${r.marker}, ` : ""}${r.surface}`,
  );
}
// The row the suggestion names is the newest one built from a COMMIT. A unit
// built from a dirty tree came from source no commit holds - `promote
// --from-build` refuses exactly that, and a promote naming an id takes no source
// check at all - so a table that offered one as the command to copy would be
// handing an operator the one build nothing else will stop. The dirty rows stay
// listed: rolling a channel back onto what it once served is what this table is
// for, and a channel has served a dirty build before.
const dirtyRows = rows.filter((r) => r.dirty).length;
const first = rows.find((r) => !r.dirty);
console.error(
  `\n${rows.length} published units` +
    (hidden ? `, ${hidden} harness builds not shown (add --all)` : "") +
    (dirtyRows ? `, ${dirtyRows} built from a tree no commit holds` : "") +
    (first ? `. Promote one with:` : `, and every one of them is +dirty. There is nothing here to suggest.`),
);
if (first) {
  console.error(
    first.unit === "shell"
      ? `  bun run promote qa --shell ${first.id}`
      : `  bun run promote qa --app ${first.unit}=${first.id}`,
  );
}
