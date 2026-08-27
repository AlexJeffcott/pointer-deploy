import { describe, expect, test } from "bun:test";
import { renderShell, shellResponse } from "./html.ts";
import type { Manifest } from "./manifest.ts";
import type { Target } from "./origins.ts";

const TARGET: Target = { region: "eu", channel: "qa" };
const BASE = "https://store.test/builds/b1/";

const v2: Manifest = {
  schema: 2,
  buildId: "b1",
  commit: "c".repeat(40),
  publishedAt: "2026-08-26T20:14:02.000Z",
  assetBase: BASE,
  shell: { js: "index-a.js", css: "index-b.css" },
  imports: { preact: "preact-c.js", "@pointer/shell": "api-d.js" },
  apps: { alpha: { js: "apps/alpha-e.js", css: "apps/alpha-f.css" } },
};

const v1: Manifest = {
  schema: 1,
  buildId: "b0",
  commit: "d".repeat(40),
  publishedAt: "2026-08-26T20:14:02.000Z",
  assetBase: BASE,
  entry: { js: "index-a.js", css: "index-b.css" },
};

describe("a shell manifest", () => {
  const html = renderShell(v2, TARGET);

  test("loads the shell's own script and stylesheet from the store", () => {
    expect(html).toContain(`src="${BASE}index-a.js"`);
    expect(html).toContain(`href="${BASE}index-b.css"`);
  });

  test("names every shared specifier in an import map, as absolute URLs", () => {
    const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(html)![1]!);
    expect(map.imports).toEqual({
      preact: `${BASE}preact-c.js`,
      "@pointer/shell": `${BASE}api-d.js`,
    });
  });

  // A module script that runs before the map is parsed resolves nothing.
  test("puts the import map before the module script", () => {
    expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'));
  });

  test("tells the shell where each sub-app lives", () => {
    const apps = JSON.parse(/id="__APPS__">(.*?)<\/script>/s.exec(html)![1]!);
    expect(apps).toEqual({
      alpha: { js: `${BASE}apps/alpha-e.js`, css: `${BASE}apps/alpha-f.css` },
    });
  });

  test("identifies the build", () => {
    const build = JSON.parse(/id="__BUILD__">(.*?)<\/script>/s.exec(html)![1]!);
    expect(build).toMatchObject({ buildId: "b1", channel: "qa", region: "eu" });
  });
});

describe("a single-bundle manifest", () => {
  const html = renderShell(v1, TARGET);

  test("still renders", () => {
    expect(html).toContain(`src="${BASE}index-a.js"`);
    expect(html).toContain('id="__BUILD__"');
  });

  // It names no sub-apps and no shared specifiers, so emitting either would be
  // a lie the browser then has to resolve.
  test("carries no import map and no app list", () => {
    expect(html).not.toContain("importmap");
    expect(html).not.toContain("__APPS__");
  });
});

// Schema 3. Three separately published units, on three different bases,
// assembled into one page. The discriminating detail is that alpha's script
// comes from alpha's base while the import map still comes from the shell's:
// a version of this that joined everything against one base would pass every
// schema 2 test above and serve a page whose sub-apps 404.
describe("a composition of independently published units", () => {
  const SHELL_BASE = "https://store.test/units/shell/s1/";
  const ALPHA_BASE = "https://store.test/units/alpha/a9/";
  const BRAVO_BASE = "https://store.test/units/bravo/b7/";

  const v3: Manifest = {
    schema: 3,
    composedAt: "2026-08-27T10:00:00.000Z",
    contract: "9e79879",
    shell: {
      unitId: "s1",
      commit: "c".repeat(40),
      assetBase: SHELL_BASE,
      js: "index-a.js",
      css: "index-b.css",
      imports: { preact: "preact-c.js", "@pointer/shell": "api-d.js" },
      marker: "",
    },
    apps: {
      alpha: { unitId: "a9", commit: "a".repeat(40), assetBase: ALPHA_BASE, js: "alpha-e.js", css: "alpha-f.css", marker: "v2" },
      bravo: { unitId: "b7", commit: "b".repeat(40), assetBase: BRAVO_BASE, js: "bravo-g.js", css: null, marker: "" },
    },
  };

  const html = renderShell(v3, TARGET);

  test("loads the shell from the shell unit's base", () => {
    expect(html).toContain(`src="${SHELL_BASE}index-a.js"`);
    expect(html).toContain(`href="${SHELL_BASE}index-b.css"`);
  });

  test("loads each sub-app from its own unit's base", () => {
    const apps = JSON.parse(/id="__APPS__">(.*?)<\/script>/s.exec(html)![1]!);
    expect(apps).toEqual({
      alpha: { js: `${ALPHA_BASE}alpha-e.js`, css: `${ALPHA_BASE}alpha-f.css` },
      bravo: { js: `${BRAVO_BASE}bravo-g.js` },
    });
  });

  // The shared runtime must stay one instance whichever unit a sub-app came
  // from, so the map resolves against the shell and never against an app.
  test("resolves the import map against the shell's base", () => {
    const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(html)![1]!);
    expect(map.imports).toEqual({
      preact: `${SHELL_BASE}preact-c.js`,
      "@pointer/shell": `${SHELL_BASE}api-d.js`,
    });
  });

  test("identifies every unit and the contract they agreed on", () => {
    const build = JSON.parse(/id="__BUILD__">(.*?)<\/script>/s.exec(html)![1]!);
    expect(build).toMatchObject({
      buildId: "s1",
      commit: "c".repeat(40),
      contract: "9e79879",
      units: {
        shell: { unitId: "s1", commit: "c".repeat(40), marker: "" },
        alpha: { unitId: "a9", commit: "a".repeat(40), marker: "v2" },
        bravo: { unitId: "b7", commit: "b".repeat(40), marker: "" },
      },
      channel: "qa",
      region: "eu",
    });
  });
});

test("a value containing a closing script tag cannot end the JSON block", () => {
  const nasty: Manifest = { ...v2, buildId: '</script><script>alert(1)</script>' };
  const html = renderShell(nasty, TARGET);
  expect(html).not.toContain("<script>alert(1)");
  expect(html).toContain("\\u003c/script");
});

test("the shell response is never stored by a cache", () => {
  const headers = shellResponse(v2, TARGET).headers;
  expect(headers.get("cache-control")).toContain("no-store");
  expect(headers.get("content-type")).toContain("text/html");
});
