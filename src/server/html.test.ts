import { describe, expect, test } from "bun:test";
import { contentSecurityPolicy, moduleIntegrity, renderShell, shellResponse } from "./html.ts";
import type { Manifest, ManifestV3 } from "./manifest.ts";
import type { Target } from "./origins.ts";

const TARGET: Target = { region: "eu", channel: "qa" };
const BASE = "https://store.test/builds/b1/";

const policyOf = (m: Manifest) =>
  shellResponse(m, TARGET).headers.get("content-security-policy") ?? "";

/** One directive's value, so a test compares that and not the whole header. */
const directiveOf = (csp: string, name: string) =>
  csp.split("; ").find((d) => d.startsWith(`${name} `))?.slice(name.length + 1) ?? "";

const importMapOf = (html: string) =>
  JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(html)![1]!);

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

  // The four places that render nothing when there is nothing to say: the
  // import map tag, the app list tag, and the two digest attributes. A stray
  // character in any of them is a malformed tag, and not.toContain() above
  // cannot see one - it only knows the text it was told to look for is absent.
  test("puts nothing at all where it names nothing", () => {
    expect(html).toContain(`<link rel="stylesheet" href="${BASE}index-b.css" />\n  </head>`);
    expect(html).toContain(
      `</script>\n    <script type="module" src="${BASE}index-a.js"></script>`,
    );
  });

  // Reached only through this schema: the policy asks for the digests and the
  // hash of an import map that does not exist.
  test("its policy names the store and allows no inline script", () => {
    const csp = policyOf(v1);
    expect(directiveOf(csp, "script-src")).toBe("https://store.test");
    expect(directiveOf(csp, "style-src")).toBe("https://store.test");
  });
});

// moduleIntegrity is exported and answers for any schema, and only schema 3
// carries the units it reads. Through renderShell the older schemas never reach
// it - the import map is empty, so the document is null before the digests are
// asked for - which leaves this the only caller that can tell the guard is
// there. Without it the two older schemas throw on a field they do not have.
test("a manifest older than digests names no module digests", () => {
  expect(moduleIntegrity(v1)).toEqual({});
  expect(moduleIntegrity(v2)).toEqual({});
});

// A file this server cannot resolve to an origin is a file the page cannot be
// allowed to fetch, and an empty directive value allows everything instead.
test("a manifest naming no origin this server can parse allows nothing", () => {
  const csp = policyOf({ ...v1, assetBase: "not a url/" });
  expect(directiveOf(csp, "style-src")).toBe("'none'");
  expect(directiveOf(csp, "script-src")).toBe("'none'");
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

  const v3: ManifestV3 = {
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

  // A shell unit published without a stylesheet. Nothing build.ts emits looks
  // like this and no channel has ever served it, but `ComposedUnit.css` is
  // `string | null`, so a composition may say it. Joining the base against an
  // empty name produced the unit's own DIRECTORY, the page linked that as a
  // stylesheet, and the browser fetched a listing and parsed it as CSS.
  test("a shell unit with no stylesheet links no stylesheet at all", () => {
    const bare: Manifest = { ...v3, shell: { ...v3.shell, css: null } };
    const page = renderShell(bare, TARGET);
    expect(page).not.toContain("<link");
    expect(page).not.toContain(`"${SHELL_BASE}"`);
    // The two negatives above pass on a page that rendered nothing, and on one
    // that put anything at all where the tag was. The head is asserted as the
    // exact join instead, so the title runs straight into the import map.
    expect(page).toContain('<title>pointer-deploy</title>\n    <script type="importmap">');
    expect(page).toContain(`<script type="module" src="${SHELL_BASE}index-a.js"`);
  });

  // The policy is derived from the files the manifest names, so dropping the
  // tag must not drop the origin the script is still fetched from.
  test("a shell unit with no stylesheet still names its origin in the policy", () => {
    const bare: Manifest = { ...v3, shell: { ...v3.shell, css: null } };
    expect(contentSecurityPolicy(bare)).toContain("style-src https://store.test");
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

// Whoever writes a manifest names the files, so a file name is untrusted text
// arriving in an HTML attribute.
test("escapes what an attribute cannot carry, in the order that keeps it escaped", () => {
  // Both characters in one value on purpose. The ampersand has to be replaced
  // FIRST: escape the quote first and the ampersand it introduces is escaped
  // again, so the href reads &amp;quot; and the browser fetches another file.
  const awkward: Manifest = { ...v2, shell: { js: 'index&"a.js', css: "index<b.css" } };
  const html = renderShell(awkward, TARGET);
  expect(html).toContain(`src="${BASE}index&amp;&quot;a.js"`);
  expect(html).toContain(`href="${BASE}index&lt;b.css"`);
});

// One separator between a base and a file, whichever of them carries it.
test("joins a base and a file that both carry the separator", () => {
  const slashed: Manifest = { ...v2, shell: { js: "/index-a.js", css: "/index-b.css" } };
  const html = renderShell(slashed, TARGET);
  expect(html).toContain(`src="${BASE}index-a.js"`);
  expect(html).toContain(`href="${BASE}index-b.css"`);
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

// Subresource Integrity. Whoever can write a manifest can name any file on the
// store; the digests are what stops a named file being a file the build never
// produced.
describe("a composition carrying digests", () => {
  const SHELL_BASE = "https://store.test/units/shell/s1/";
  const ALPHA_BASE = "https://store.test/units/alpha/a9/";

  const D = {
    shellJs: "sha384-shellentry",
    shellCss: "sha384-shellstyle",
    shared: "sha384-sharedchunk",
    preact: "sha384-preactcopy",
    api: "sha384-storeapi",
    alphaJs: "sha384-alphaentry",
    alphaCss: "sha384-alphastyle",
  };

  const signed: ManifestV3 = {
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
      integrity: {
        "index-a.js": D.shellJs,
        "index-b.css": D.shellCss,
        "shared-e.js": D.shared,
        "preact-c.js": D.preact,
        "api-d.js": D.api,
      },
      marker: "",
    },
    apps: {
      alpha: {
        unitId: "a9",
        commit: "a".repeat(40),
        assetBase: ALPHA_BASE,
        js: "alpha-e.js",
        css: "alpha-f.css",
        integrity: { "alpha-e.js": D.alphaJs, "alpha-f.css": D.alphaCss },
        marker: "",
      },
    },
  };

  const html = renderShell(signed, TARGET);
  const map = () => JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(html)![1]!);

  test("the shell's own script and stylesheet carry theirs on the tag", () => {
    expect(html).toContain(`src="${SHELL_BASE}index-a.js" integrity="${D.shellJs}" crossorigin="anonymous"`);
    expect(html).toContain(`href="${SHELL_BASE}index-b.css" integrity="${D.shellCss}" crossorigin="anonymous"`);
  });

  // The chunk the entry imports and the sub-app the loader imports are fetched
  // by the module loader, which reads no tag. This section is the only place
  // they can be declared, so a page without it checks the entry and nothing
  // behind it.
  test("every module the page can import is named in the import map", () => {
    expect(map().integrity).toEqual({
      [`${SHELL_BASE}index-a.js`]: D.shellJs,
      [`${SHELL_BASE}shared-e.js`]: D.shared,
      [`${SHELL_BASE}preact-c.js`]: D.preact,
      [`${SHELL_BASE}api-d.js`]: D.api,
      [`${ALPHA_BASE}alpha-e.js`]: D.alphaJs,
    });
  });

  // A source map is fetched by devtools and never imported, and the integrity
  // section is read for modules alone. Matching ".js" anywhere in a name rather
  // than at its end puts one in, where it is at best ignored.
  test("only a module carries a digest in the import map", () => {
    const mapped: ManifestV3 = {
      ...signed,
      shell: {
        ...signed.shell,
        integrity: { ...signed.shell.integrity, "index-a.js.map": "sha384-sourcemap" },
      },
    };
    const digests = importMapOf(renderShell(mapped, TARGET)).integrity;
    expect(Object.keys(digests)).not.toContain(`${SHELL_BASE}index-a.js.map`);
    expect(digests[`${SHELL_BASE}index-a.js`]).toBe(D.shellJs);
  });

  // A stylesheet is not a module and never resolves through the map, so the
  // digest has to reach the loader instead.
  test("a sub-app's stylesheet digest is handed to the loader", () => {
    const apps = JSON.parse(/id="__APPS__">(.*?)<\/script>/s.exec(html)![1]!);
    expect(apps.alpha).toEqual({
      js: `${ALPHA_BASE}alpha-e.js`,
      css: `${ALPHA_BASE}alpha-f.css`,
      cssIntegrity: D.alphaCss,
    });
  });

  describe("and its content policy", () => {
    const csp = policyOf(signed);
    const directive = (name: string) => directiveOf(csp, name);

    test("permits nothing the manifest does not name", () => {
      expect(csp).toContain("default-src 'none'");
      expect(directive("script-src")).toContain("https://store.test");
      expect(directive("style-src")).toBe("https://store.test");
      expect(csp).toContain("base-uri 'none'");
      expect(csp).toContain("form-action 'none'");
      expect(csp).toContain("frame-ancestors 'none'");
    });

    // The whole point of a hash rather than 'unsafe-inline': the import map is
    // allowed, and a script injected beside it is not.
    test("allows the import map by the hash of its own bytes", () => {
      const text = /<script type="importmap">(.*?)<\/script>/s.exec(html)![1]!;
      const hash = new Bun.CryptoHasher("sha256").update(text).digest("base64");
      expect(directive("script-src")).toContain(`'sha256-${hash}'`);
      expect(csp).not.toContain("unsafe-inline");
    });

    // A file whose origin is not in the policy is fetched by nobody, whatever
    // digest sits beside it.
    test("names the origin of a sub-app published to another store", () => {
      const elsewhere: ManifestV3 = {
        ...signed,
        apps: {
          alpha: { ...signed.apps.alpha!, assetBase: "https://other.test/units/alpha/a9/" },
        },
      };
      const other = policyOf(elsewhere);
      // Sorted, and separated. The shell's origin is reached first and
      // other.test second, so an unsorted policy reads the other way round and
      // its text depends on what order the manifest happened to name things.
      // A header nothing can compare against is a header nothing checks.
      expect(directiveOf(other, "style-src")).toBe("https://other.test https://store.test");
      expect(directiveOf(other, "script-src")).toMatch(
        /^https:\/\/other\.test https:\/\/store\.test 'sha256-/,
      );
    });
  });
});

// A unit published before digests were recorded carries none. The page must
// still render: a composition naming one is what a rollback that far IS.
test("a composition with no digests renders and is still restricted", () => {
  const csp = shellResponse(v2, TARGET).headers.get("content-security-policy") ?? "";
  const html = renderShell(v2, TARGET);
  expect(html).not.toContain("integrity=");
  expect(JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(html)![1]!).integrity).toBeUndefined();
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("https://store.test");
});

// The version switcher's data. The server computes the options and the shell
// draws them, so what is asserted here is the block and never any markup.
describe("the versions block", () => {
  const options = {
    shell: [
      { unitId: "s1", marker: "", current: true, live: true, disabled: false },
      { unitId: "s0", marker: "beta", current: false, live: false, disabled: true },
    ],
  };

  test("carries every option the server computed", () => {
    const html = renderShell(v2, TARGET, options);
    const block = /id="__VERSIONS__">(.*?)<\/script>/s.exec(html)?.[1];
    expect(JSON.parse(block!)).toEqual(options);
  });

  // Absent is the ordinary case: the switcher is off unless a channel is named
  // in VERSION_SWITCHER_CHANNELS, and a visitor to any other channel must get
  // exactly the page they got before this existed.
  test("is absent when the server sent no options", () => {
    expect(renderShell(v2, TARGET)).not.toContain("__VERSIONS__");
  });

  test("is absent when the options are empty rather than missing", () => {
    expect(renderShell(v2, TARGET, {})).not.toContain("__VERSIONS__");
  });

  // It is data and not script, so it must not need an allowance - and it must
  // not accidentally get one either.
  test("does not change what the page is allowed to load", () => {
    expect(shellResponse(v2, TARGET, options).headers.get("content-security-policy")).toBe(
      shellResponse(v2, TARGET).headers.get("content-security-policy"),
    );
  });

  test("the response carries the block the render put there", () => {
    expect(shellResponse(v2, TARGET, options).headers.get("content-type")).toBe(
      "text/html; charset=utf-8",
    );
  });
});
