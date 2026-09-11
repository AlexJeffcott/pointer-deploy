import { Then } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld } from "../support/world.ts";

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
 *
 * This used to read the sub-app list as well. `PLAN.md` step 0 builds none, and
 * the import-map half is the half that survives a slate with one unit on it.
 */
Then("every module the import map names carries one too", function (this: PointerWorld) {
  const map = importMapIn(this.lastBody);
  const named = Object.values(map.imports);
  expect(named.length).toBeGreaterThan(0);

  const digested = named.map((url) => `${url} ${map.integrity?.[url] ?? "none"}`);
  expect(digested.filter((d) => !/ sha384-/.test(d))).toEqual([]);
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
