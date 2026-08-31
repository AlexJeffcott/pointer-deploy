// Prints every published unit id, so a promote can name one without anybody
// having to remember it.
//
//   bun run units                 # every unit an operator may deploy
//   bun run units alpha           # one unit
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
const first = rows[0]!;
console.error(
  `\n${rows.length} published units` +
    (hidden ? `, and ${hidden} harness builds not shown. Add --all to see them` : "") +
    `. Promote one with:`,
);
console.error(
  first.unit === "shell"
    ? `  bun run promote qa --shell ${first.id}`
    : `  bun run promote qa --app ${first.unit}=${first.id}`,
);
