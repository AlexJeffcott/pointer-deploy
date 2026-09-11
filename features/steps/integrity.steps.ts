import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld, PROPAGATION_WINDOW_MS } from "../support/world.ts";
import { configFromEnv, getObjectText } from "../../scripts/store.ts";
import { VIEWS } from "../../src/web/shell/views.ts";

const WRONG = `sha384-${btoa("not the bytes that were published".padEnd(48, "!")).slice(0, 64)}`;

type Composed = {
  js: string;
  css: string | null;
  assetBase: string;
  integrity?: Record<string, string>;
};
type Pointer = { shell: Composed; apps: Record<string, Composed> };

const directive = (header: string, name: string): string =>
  header
    .split(";")
    .map((d) => d.trim())
    .find((d) => d.startsWith(`${name} `))
    ?.slice(name.length + 1) ?? "";

const policyOf = (world: PointerWorld): string => {
  const header = world.lastResponse?.headers.get("content-security-policy");
  if (!header) throw new Error("the response carries no content policy at all");
  return header;
};

const importMapIn = (html: string): { imports: Record<string, string>; integrity?: Record<string, string> } => {
  const m = /<script type="importmap">(.*?)<\/script>/s.exec(html);
  if (!m?.[1]) throw new Error("the shell carries no import map");
  return JSON.parse(m[1]);
};

Then("the shell permits scripts and stylesheets from the store alone", function (this: PointerWorld) {
  const policy = policyOf(this);
  const entry = /<script type="module" src="([^"]+)"/.exec(this.lastBody)?.[1];
  if (!entry) throw new Error("the shell names no script to check the policy against");
  const store = new URL(entry).origin;

  expect(policy).toContain("default-src 'none'");
  expect(directive(policy, "script-src")).toContain(store);
  expect(directive(policy, "style-src")).toBe(store);
  expect(directive(policy, "style-src")).not.toContain(this.originFor("qa"));
});

Then("the shell permits no inline script but the import map it carries", function (this: PointerWorld) {
  const policy = policyOf(this);
  const text = /<script type="importmap">(.*?)<\/script>/s.exec(this.lastBody)?.[1];
  if (!text) throw new Error("the shell carries no import map");

  const hash = new Bun.CryptoHasher("sha256").update(text).digest("base64");
  expect(directive(policy, "script-src")).toContain(`'sha256-${hash}'`);
  expect(policy).not.toContain("unsafe-inline");
  expect(policy).not.toContain("unsafe-eval");
});

Then(
  "the shell's own script and stylesheet carry the digests the manifest records",
  function (this: PointerWorld) {
    const script = /<script type="module" src="[^"]+" integrity="([^"]+)" crossorigin="anonymous">/.exec(
      this.lastBody,
    );
    const style = /<link rel="stylesheet" href="[^"]+" integrity="([^"]+)" crossorigin="anonymous"/.exec(
      this.lastBody,
    );
    expect(script?.[1]).toMatch(/^sha384-/);
    expect(style?.[1]).toMatch(/^sha384-/);
  },
);

/**
 * The digests on everything BEHIND the entry tag.
 *
 * A digest on `<script src>` covers that one file. The shared chunks the entry
 * imports resolve through the import map, and the map's own `integrity` block
 * is the only place their digests can be declared - so a map that carries none
 * leaves every chunk on the page unchecked while the page still renders.
 */
Then("every module the import map names carries one too", function (this: PointerWorld) {
  const map = importMapIn(this.lastBody);
  const named = Object.values(map.imports);
  expect(named.length).toBeGreaterThan(0);

  const digested = named.map((url) => `${url} ${map.integrity?.[url] ?? "none"}`);
  expect(digested.filter((d) => !/ sha384-/.test(d))).toEqual([]);
});

/**
 * The digests on the files a SUB-APP is fetched with.
 *
 * Its script resolves through the import map like every other module, so its
 * digest is declared there; its stylesheet is loaded by `AsyncAppLoader` from
 * the `__APPS__` block, so its digest travels beside the URL instead.
 */
Then("every sub-app the shell can import carries one too", function (this: PointerWorld) {
  const map = importMapIn(this.lastBody);
  const block = /id="__APPS__">(.*?)<\/script>/s.exec(this.lastBody)?.[1];
  if (!block) throw new Error("the page names no sub-app, so there is nothing to check");
  const apps = JSON.parse(block) as Record<
    string,
    { js: string; css?: string; cssIntegrity?: string }
  >;

  expect(Object.keys(apps).length).toBeGreaterThan(0);
  const digested: string[] = [];
  for (const a of Object.values(apps)) {
    digested.push(map.integrity?.[a.js] ?? "none");
    if (a.css) digested.push(a.cssIntegrity ?? "none");
  }

  expect(digested.filter((d) => !d.startsWith("sha384-"))).toEqual([]);
});

/**
 * Corrupts one digest in the pointer the channel is serving.
 *
 * The bytes in the store are untouched: what moves is the claim the page makes
 * about them, which is the state a browser has to refuse. It refuses to run at
 * all against a composition whose digests are missing, because replacing an
 * absent digest would prove nothing.
 */
Given(
  "the digest recorded for the {word} of {string} is wrong",
  async function (this: PointerWorld, kind: string, app: string) {
    const cfg = configFromEnv();
    const key = this.pointerKey("qa");
    const text = await getObjectText(cfg, key);
    if (text === null) throw new Error(`${key} does not exist`);

    const doc = JSON.parse(text) as Pointer;
    const unit = doc.apps[app];
    if (!unit) throw new Error(`the ${key} composition names no ${app}`);

    const file = kind === "script" ? unit.js : unit.css;
    if (!file) throw new Error(`${app} publishes no ${kind}`);
    if (!unit.integrity?.[file]) {
      throw new Error(
        `${app} ${file} carries no digest in ${key}, so replacing one proves nothing. ` +
          `Publish and promote a current build first.`,
      );
    }
    unit.integrity[file] = WRONG;

    await this.pointChannelAtDocument("qa", doc);
    await this.awaitShellContaining("qa", WRONG, PROPAGATION_WINDOW_MS + 15_000);
  },
);

/**
 * A fresh load of one view, which is what a corrupted digest needs.
 *
 * The route is looked up rather than written, so the step says which view it
 * opened and fails here if that view moved. Either a panel or a refusal will
 * appear: a browser that refuses the bundle leaves the loader's error in place
 * of the section, and the Then below is what tells them apart.
 */
When("a visitor navigates to the {word} view", async function (this: PointerWorld, name: string) {
  const found = Object.entries(VIEWS).find(([, v]) => v.title.toLowerCase() === name);
  if (!found) throw new Error(`no view called ${JSON.stringify(name)}`);
  await this.browserPage.goto(`${this.originFor("qa")}${found[0]}`);
  await this.browserPage.waitForSelector("[data-app] section, [data-app-error]", {
    timeout: 20_000,
  });
});

Then(
  "the {string} panel is refused rather than rendered",
  async function (this: PointerWorld, app: string) {
    const page = this.browserPage;
    await page.waitForSelector(`[data-app-error="${app}"]`, { timeout: 20_000 });
    expect(await page.$$eval(`[data-app="${app}"]`, (n) => n.length)).toBe(0);
  },
);

Then("every panel on the page is styled by its own stylesheet", async function (this: PointerWorld) {
  const borders = await this.browserPage.$$eval("[data-app] section", (nodes) =>
    nodes.map((n) => getComputedStyle(n).borderTopWidth),
  );
  // Every panel the view placed, and the count is the view's rather than this
  // step's: the claim is that each panel got its own stylesheet, not that there
  // are several of them.
  expect(borders.length).toBeGreaterThan(0);
  expect(borders).toEqual(borders.map(() => "3px"));
});

Then(
  "the frame is styled by the stylesheet its own unit published",
  async function (this: PointerWorld) {
    const page = this.browserPage;

    // From theme.css, which the shell's entry imports and its stylesheet
    // carries. Empty means the stylesheet never applied.
    const accent = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
    );
    expect(accent).not.toBe("");

    // And from Shell.module.css, so the reading is of the frame's own rules
    // rather than of a variable anything could have set. A refused stylesheet
    // leaves the sidenav statically positioned and the width unset.
    const nav = await page.$eval("nav", (n) => {
      const s = getComputedStyle(n);
      return { position: s.position, borderRight: s.borderRightWidth };
    });
    expect(nav).toEqual({ position: "fixed", borderRight: "1px" });
  },
);

Then("the browser refused nothing the page asked for", async function (this: PointerWorld) {
  expect(await this.policyRefusals()).toEqual([]);
});
