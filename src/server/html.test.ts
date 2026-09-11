import { describe, expect, test } from "bun:test";
import {
  buildInfo,
  contentSecurityPolicy,
  moduleIntegrity,
  renderShell,
  shellResponse,
} from "./html.ts";
import type { Manifest, ManifestV3 } from "./manifest.ts";
import type { Target } from "./origins.ts";

const TARGET: Target = { region: "eu", channel: "qa" };
const BASE = "https://store.test/builds/b1/";

const policyOf = (m: Manifest) =>
  shellResponse(m, TARGET).headers.get("content-security-policy") ?? "";

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
  apps: { hello: { js: "apps/hello-e.js", css: "apps/hello-f.css" } },
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

  test("puts the import map before the module script", () => {
    expect(html.indexOf('type="importmap"')).toBeLessThan(html.indexOf('type="module"'));
  });

  test("tells the shell where each sub-app lives", () => {
    const apps = JSON.parse(/id="__APPS__">(.*?)<\/script>/s.exec(html)![1]!);
    expect(apps).toEqual({
      hello: { js: `${BASE}apps/hello-e.js`, css: `${BASE}apps/hello-f.css` },
    });
  });

  test("identifies the build", () => {
    const build = JSON.parse(/id="__BUILD__">(.*?)<\/script>/s.exec(html)![1]!);
    expect(build).toMatchObject({ buildId: "b1", channel: "qa", region: "eu" });
  });
});

describe("where the page is told the service is", () => {
  const buildBlock = (page: string) =>
    JSON.parse(/id="__BUILD__">(.*?)<\/script>/s.exec(page)![1]!) as Record<string, unknown>;

  test("a server with no service configured writes no field", () => {
    expect(buildBlock(renderShell(v2, TARGET))).not.toHaveProperty("apiBase");
    expect(buildBlock(renderShell(v1, TARGET))).not.toHaveProperty("apiBase");
    expect(buildInfo(v2, TARGET)).not.toHaveProperty("apiBase");
  });

  test("a server that names one writes it, under both schemas", () => {
    expect(buildBlock(renderShell(v2, TARGET, "https://api.test"))).toMatchObject({
      apiBase: "https://api.test",
    });
    expect(buildBlock(renderShell(v1, TARGET, "https://api.test"))).toMatchObject({
      apiBase: "https://api.test",
    });
  });

  test("the response carries what the page was rendered with", async () => {
    const page = await shellResponse(v2, TARGET, "https://api.test").text();
    expect(buildBlock(page)).toMatchObject({ apiBase: "https://api.test" });
    expect(buildBlock(await shellResponse(v2, TARGET).text())).not.toHaveProperty("apiBase");
  });
});

describe("a single-bundle manifest", () => {
  const html = renderShell(v1, TARGET);

  test("still renders", () => {
    expect(html).toContain(`src="${BASE}index-a.js"`);
    expect(html).toContain('id="__BUILD__"');
  });

  test("carries no import map and no app list", () => {
    expect(html).not.toContain("importmap");
    expect(html).not.toContain("__APPS__");
  });

  test("puts nothing at all where it names nothing", () => {
    expect(html).toContain(`<link rel="stylesheet" href="${BASE}index-b.css" />\n  </head>`);
    expect(html).toContain(
      `</script>\n    <script type="module" src="${BASE}index-a.js"></script>`,
    );
  });

  test("its policy names the store and allows no inline script", () => {
    const csp = policyOf(v1);
    expect(directiveOf(csp, "script-src")).toBe("https://store.test");
    expect(directiveOf(csp, "style-src")).toBe("https://store.test");
  });
});

test("a manifest older than digests names no module digests", () => {
  expect(moduleIntegrity(v1)).toEqual({});
  expect(moduleIntegrity(v2)).toEqual({});
});

test("a manifest naming no origin this server can parse allows nothing", () => {
  const csp = policyOf({ ...v1, assetBase: "not a url/" });
  expect(directiveOf(csp, "style-src")).toBe("'none'");
  expect(directiveOf(csp, "script-src")).toBe("'none'");
});

describe("a composition of independently published units", () => {
  const SHELL_BASE = "https://store.test/units/shell/s1/";
  const HELLO_BASE = "https://store.test/units/hello/a9/";
  const SECOND_BASE = "https://store.test/units/second/b7/";

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
      hello: { unitId: "a9", commit: "a".repeat(40), assetBase: HELLO_BASE, js: "hello-e.js", css: "hello-f.css", marker: "v2" },
      second: { unitId: "b7", commit: "b".repeat(40), assetBase: SECOND_BASE, js: "second-g.js", css: null, marker: "" },
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
      hello: { js: `${HELLO_BASE}hello-e.js`, css: `${HELLO_BASE}hello-f.css` },
      second: { js: `${SECOND_BASE}second-g.js` },
    });
  });

  test("resolves the import map against the shell's base", () => {
    const map = JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(html)![1]!);
    expect(map.imports).toEqual({
      preact: `${SHELL_BASE}preact-c.js`,
      "@pointer/shell": `${SHELL_BASE}api-d.js`,
    });
  });

  test("a shell unit with no stylesheet links no stylesheet at all", () => {
    const bare: Manifest = { ...v3, shell: { ...v3.shell, css: null } };
    const page = renderShell(bare, TARGET);
    expect(page).not.toContain('rel="stylesheet"');
    expect(page).not.toContain(`"${SHELL_BASE}"`);
    expect(page).toContain('<title>pointer-deploy</title>\n    <script type="importmap">');
    expect(page).toContain(`<script type="module" src="${SHELL_BASE}index-a.js"`);
  });

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
        hello: { unitId: "a9", commit: "a".repeat(40), marker: "v2" },
        second: { unitId: "b7", commit: "b".repeat(40), marker: "" },
      },
      channel: "qa",
      region: "eu",
    });
  });
});

test("escapes what an attribute cannot carry, in the order that keeps it escaped", () => {
  const awkward: Manifest = { ...v2, shell: { js: 'index&"a.js', css: "index<b.css" } };
  const html = renderShell(awkward, TARGET);
  expect(html).toContain(`src="${BASE}index&amp;&quot;a.js"`);
  expect(html).toContain(`href="${BASE}index&lt;b.css"`);
});

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

describe("a composition carrying digests", () => {
  const SHELL_BASE = "https://store.test/units/shell/s1/";
  const HELLO_BASE = "https://store.test/units/hello/a9/";

  const D = {
    shellJs: "sha384-shellentry",
    shellCss: "sha384-shellstyle",
    shared: "sha384-sharedchunk",
    preact: "sha384-preactcopy",
    api: "sha384-storeapi",
    helloJs: "sha384-helloentry",
    helloCss: "sha384-hellostyle",
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
      hello: {
        unitId: "a9",
        commit: "a".repeat(40),
        assetBase: HELLO_BASE,
        js: "hello-e.js",
        css: "hello-f.css",
        integrity: { "hello-e.js": D.helloJs, "hello-f.css": D.helloCss },
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

  test("every module the page can import is named in the import map", () => {
    expect(map().integrity).toEqual({
      [`${SHELL_BASE}index-a.js`]: D.shellJs,
      [`${SHELL_BASE}shared-e.js`]: D.shared,
      [`${SHELL_BASE}preact-c.js`]: D.preact,
      [`${SHELL_BASE}api-d.js`]: D.api,
      [`${HELLO_BASE}hello-e.js`]: D.helloJs,
    });
  });

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

  test("a sub-app's stylesheet digest is handed to the loader", () => {
    const apps = JSON.parse(/id="__APPS__">(.*?)<\/script>/s.exec(html)![1]!);
    expect(apps.hello).toEqual({
      js: `${HELLO_BASE}hello-e.js`,
      css: `${HELLO_BASE}hello-f.css`,
      cssIntegrity: D.helloCss,
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

    test("lets the page reach nothing when no service is named", () => {
      expect(directive("connect-src")).toBe("'none'");
    });

    test("lets the page reach the service it is told to call, and no other", () => {
      const named = contentSecurityPolicy(signed, "https://api.test/v1");
      expect(directiveOf(named, "connect-src")).toBe("https://api.test");
      expect(directiveOf(named, "connect-src")).not.toContain("https://store.test");
    });

    test("names that service in the policy the response carries", () => {
      // The gap this closes: the policy was built from the manifest alone, so a
      // server that told the page where the service is forbade it in the same
      // breath. Every unit test passed and the browser refused the fetch.
      const header =
        shellResponse(signed, TARGET, "https://api.test").headers.get(
          "content-security-policy",
        ) ?? "";
      expect(directiveOf(header, "connect-src")).toBe("https://api.test");
    });

    test("allows the import map by the hash of its own bytes", () => {
      const text = /<script type="importmap">(.*?)<\/script>/s.exec(html)![1]!;
      const hash = new Bun.CryptoHasher("sha256").update(text).digest("base64");
      expect(directive("script-src")).toContain(`'sha256-${hash}'`);
      expect(csp).not.toContain("unsafe-inline");
    });

    test("names the origin of a sub-app published to another store", () => {
      const elsewhere: ManifestV3 = {
        ...signed,
        apps: {
          hello: { ...signed.apps.hello!, assetBase: "https://other.test/units/hello/a9/" },
        },
      };
      const other = policyOf(elsewhere);
      expect(directiveOf(other, "style-src")).toBe("https://other.test https://store.test");
      expect(directiveOf(other, "script-src")).toMatch(
        /^https:\/\/other\.test https:\/\/store\.test 'sha256-/,
      );
    });
  });
});

test("a composition with no digests renders and is still restricted", () => {
  const csp = shellResponse(v2, TARGET).headers.get("content-security-policy") ?? "";
  const html = renderShell(v2, TARGET);
  expect(html).not.toContain("integrity=");
  expect(JSON.parse(/<script type="importmap">(.*?)<\/script>/s.exec(html)![1]!).integrity).toBeUndefined();
  expect(csp).toContain("default-src 'none'");
  expect(csp).toContain("https://store.test");
});

describe("preloading the apps a navigation would need", () => {
  const SHELL_BASE = "https://store.test/units/shell/s1/";
  const HELLO_BASE = "https://store.test/units/hello/a9/";
  const SECOND_BASE = "https://store.test/units/second/b7/";

  const D = {
    shellJs: "sha384-shellentry",
    helloJs: "sha384-helloentry",
    helloCss: "sha384-hellostyle",
    secondJs: "sha384-secondentry",
  };

  const composed: ManifestV3 = {
    schema: 3,
    composedAt: "2026-08-28T10:00:00.000Z",
    contract: "e0160a6",
    shell: {
      unitId: "s1",
      commit: "c".repeat(40),
      assetBase: SHELL_BASE,
      js: "index-a.js",
      css: "index-b.css",
      imports: { preact: "preact-c.js" },
      integrity: { "index-a.js": D.shellJs },
      marker: "",
    },
    apps: {
      hello: {
        unitId: "a9",
        commit: "a".repeat(40),
        assetBase: HELLO_BASE,
        js: "hello-e.js",
        css: "hello-f.css",
        integrity: { "hello-e.js": D.helloJs, "hello-f.css": D.helloCss },
        marker: "",
      },
      second: {
        unitId: "b7",
        commit: "b".repeat(40),
        assetBase: SECOND_BASE,
        js: "second-g.js",
        css: null,
        integrity: { "second-g.js": D.secondJs },
        marker: "",
      },
    },
  };

  const html = renderShell(composed, TARGET);

  test("names every sub-app's script as a module preload", () => {
    expect(html).toContain(`<link rel="modulepreload" href="${HELLO_BASE}hello-e.js"`);
    expect(html).toContain(`<link rel="modulepreload" href="${SECOND_BASE}second-g.js"`);
  });

  test("evaluates nothing: no second module script appears", () => {
    expect(html.match(/<script type="module"/g)).toHaveLength(1);
  });

  test("a preload carries the digest the import map declares for that URL", () => {
    const declared = moduleIntegrity(composed);
    expect(declared[`${HELLO_BASE}hello-e.js`]).toBe(D.helloJs);
    expect(html).toContain(
      `<link rel="modulepreload" href="${HELLO_BASE}hello-e.js" ` +
        `integrity="${D.helloJs}" crossorigin="anonymous" />`,
    );
  });

  test("a preload without a digest still states its CORS mode", () => {
    const noDigests: ManifestV3 = {
      ...composed,
      apps: { second: { ...composed.apps.second!, integrity: {} } },
    };
    expect(renderShell(noDigests, TARGET)).toContain(
      `<link rel="modulepreload" href="${SECOND_BASE}second-g.js" crossorigin="anonymous" />`,
    );
  });

  test("a sub-app's stylesheet is preloaded as a stylesheet, with its digest", () => {
    expect(html).toContain(
      `<link rel="preload" as="style" href="${HELLO_BASE}hello-f.css" ` +
        `integrity="${D.helloCss}" crossorigin="anonymous" />`,
    );
  });

  test("a stylesheet with no digest is preloaded the way the loader will ask for it", () => {
    const unsigned: ManifestV3 = {
      ...composed,
      apps: { hello: { ...composed.apps.hello!, integrity: {} } },
    };
    expect(renderShell(unsigned, TARGET)).toContain(
      `<link rel="preload" as="style" href="${HELLO_BASE}hello-f.css" />`,
    );
  });

  test("a unit that published no stylesheet is preloaded as a script alone", () => {
    expect(html).not.toContain(`as="style" href="${SECOND_BASE}`);
  });

  test("preloads the composition being served, not another one", () => {
    const overridden: ManifestV3 = {
      ...composed,
      apps: {
        ...composed.apps,
        hello: { ...composed.apps.hello!, unitId: "a1", assetBase: "https://store.test/units/hello/a1/" },
      },
    };
    const served = renderShell(overridden, TARGET);
    expect(served).toContain(`<link rel="modulepreload" href="https://store.test/units/hello/a1/hello-e.js"`);
    expect(served).not.toContain(`<link rel="modulepreload" href="${HELLO_BASE}hello-e.js"`);
  });

  test("comes after the shell's own entry script", () => {
    expect(html.indexOf('type="module"')).toBeLessThan(html.indexOf("modulepreload"));
  });

  test("needs no change to what the page is allowed to load", () => {
    const csp = policyOf(composed);
    expect(directiveOf(csp, "script-src")).toContain("https://store.test");
    expect(directiveOf(csp, "style-src")).toContain("https://store.test");
  });

  test("a manifest with no sub-apps preloads nothing", () => {
    expect(renderShell(v1, TARGET)).not.toContain("modulepreload");
  });

  test("emits these tags, in this order, with nothing between them", () => {
    const after = html.lastIndexOf("</script>") + "</script>".length;
    const block = html.slice(after, html.indexOf("</body>"));

    expect(block).toBe(
      `\n    <link rel="modulepreload" href="${HELLO_BASE}hello-e.js" ` +
        `integrity="${D.helloJs}" crossorigin="anonymous" />` +
        `\n    <link rel="preload" as="style" href="${HELLO_BASE}hello-f.css" ` +
        `integrity="${D.helloCss}" crossorigin="anonymous" />` +
        `\n    <link rel="modulepreload" href="${SECOND_BASE}second-g.js" ` +
        `integrity="${D.secondJs}" crossorigin="anonymous" />` +
        "\n  ",
    );
  });
});

// THE PAGE THE LIVE ORIGIN NOW RENDERS, and nothing here held it.
//
// `PLAN.md` step 0 takes the application to one unit and five routes, none of
// which places a sub-app, so every shell served from now on is rendered from a
// schema-3 manifest whose `apps` is empty. The only coverage of that shape was
// through `v1` - schema 1, which returns `{}` from a different branch of
// `appUrls` - so the path the live page takes was exercised by one `@local`
// scenario and by none of `bun test`.
describe("a schema-3 manifest with no sub-app", () => {
  const empty: ManifestV3 = {
    schema: 3,
    composedAt: "2026-09-10T21:00:00.000Z",
    contract: "9d1b0a3",
    shell: {
      unitId: "s1",
      commit: "c".repeat(40),
      assetBase: "https://store.test/units/shell/s1/",
      js: "index-a.js",
      css: "index-b.css",
      imports: { preact: "preact-c.js", "@pointer/shell": "api-d.js" },
      marker: "",
    },
    apps: {},
  };

  test("it renders a page, rather than throwing on an empty apps", () => {
    const html = renderShell(empty, TARGET);
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("index-a.js");
  });

  test("__BUILD__ names the shell and no app", () => {
    const html = renderShell(empty, TARGET);
    const raw = /id="__BUILD__">(.*?)<\/script>/s.exec(html)?.[1] ?? "{}";
    const info = JSON.parse(raw) as { units: Record<string, unknown> };
    expect(Object.keys(info.units)).toEqual(["shell"]);
  });

  test("nothing is preloaded for a view that places no unit", () => {
    const html = renderShell(empty, TARGET);
    expect(html).not.toContain('rel="modulepreload"');
  });

  // The tag the loader reads to decide what to import. A page carrying an empty
  // one looks harmless and is the difference between "this composition has no
  // sub-app" and "this composition's sub-apps could not be read".
  test("no sub-app list is carried at all", () => {
    expect(renderShell(empty, TARGET)).not.toContain('id="__APPS__"');
  });

  // The policy still has to name the store the shell itself comes from, or the
  // page cannot load its own bundle.
  test("the policy still allows the shell's own origin", () => {
    expect(policyOf(empty)).toContain("https://store.test");
  });
});
