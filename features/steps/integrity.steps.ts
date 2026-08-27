// Steps about what the page is allowed to load, and what it is allowed to
// believe about the files it loads.
//
// Two of them read the served HTML, which is enough to say what the page CLAIMS
// it will check. Whether a browser then refuses a file is not observable to
// anything but a browser, so the rest drive one.

import { Given, Then, When } from "@cucumber/cucumber";
import { expect } from "bun:test";
import { PointerWorld, PROPAGATION_WINDOW_MS } from "../support/world.ts";
import { configFromEnv, getObjectText } from "../../scripts/store.ts";

/** Well-formed, and the digest of nothing. This is what a swapped file looks like. */
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
  // The origin the page really fetches from, not one the policy happens to name.
  expect(directive(policy, "script-src")).toContain(store);
  expect(directive(policy, "style-src")).toBe(store);
  // A page that names its own origin would let anyone who can write a manifest
  // point a script tag back at this server.
  expect(directive(policy, "style-src")).not.toContain(this.originFor("qa"));
});

Then("the shell permits no inline script but the import map it carries", function (this: PointerWorld) {
  const policy = policyOf(this);
  const text = /<script type="importmap">(.*?)<\/script>/s.exec(this.lastBody)?.[1];
  if (!text) throw new Error("the shell carries no import map");

  const hash = new Bun.CryptoHasher("sha256").update(text).digest("base64");
  expect(directive(policy, "script-src")).toContain(`'sha256-${hash}'`);
  // The whole reason for a hash. With this the map runs and nothing else does.
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
    // Without crossorigin the browser refuses a cross-origin stylesheet that
    // carries a digest rather than checking it, and the page renders unstyled.
    expect(style?.[1]).toMatch(/^sha384-/);
  },
);

Then("every sub-app the shell can import carries one too", function (this: PointerWorld) {
  const map = importMapIn(this.lastBody);
  const apps = JSON.parse(/id="__APPS__">(.*?)<\/script>/s.exec(this.lastBody)![1]!) as Record<
    string,
    { js: string; css?: string; cssIntegrity?: string }
  >;

  expect(Object.keys(apps).length).toBeGreaterThan(0);
  const digested: string[] = [];
  for (const a of Object.values(apps)) {
    // A sub-app's script is imported by URL, so the import map is the only
    // place its digest can be declared.
    digested.push(map.integrity?.[a.js] ?? "none");
    if (a.css) digested.push(a.cssIntegrity ?? "none");
  }
  // And the shared runtime, which no tag and no sub-app names.
  for (const url of Object.values(map.imports)) digested.push(map.integrity?.[url] ?? "none");

  expect(digested.filter((d) => !d.startsWith("sha384-"))).toEqual([]);
});

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
    // No unit id moved, so nothing else can tell this manifest from the one
    // before it. The digest itself is what the page has to be serving.
    await this.awaitShellContaining("qa", WRONG, PROPAGATION_WINDOW_MS + 15_000);
  },
);

When("a visitor navigates to the counters view", async function (this: PointerWorld) {
  // Not `openView`: that waits for every panel, and this scenario is about one
  // of them never arriving.
  await this.browserPage.goto(`${this.originFor("qa")}/`);
  await this.browserPage.waitForSelector("[data-app] section, [data-app-error]", {
    timeout: 20_000,
  });
});

Then("the {string} panel is on the page", async function (this: PointerWorld, app: string) {
  await this.browserPage.waitForSelector(`[data-app="${app}"] section`, { timeout: 20_000 });
});

Then(
  "the {string} panel is refused rather than rendered",
  async function (this: PointerWorld, app: string) {
    const page = this.browserPage;
    await page.waitForSelector(`[data-app-error="${app}"]`, { timeout: 20_000 });
    // The slot is replaced by the refusal, so nothing of the sub-app is on the
    // page: a check for the error alone would pass on a page showing both.
    expect(await page.$$eval(`[data-app="${app}"]`, (n) => n.length)).toBe(0);
  },
);

Then("every panel on the page is styled by its own stylesheet", async function (this: PointerWorld) {
  const page = this.browserPage;

  // The shell's stylesheet. Every panel border below is drawn in a variable it
  // defines, so without this the next check passes on a page with no theme.
  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  expect(accent).not.toBe("");

  // 3px comes from each sub-app's OWN app.module.css. An unstyled section has
  // no border at all.
  const borders = await page.$$eval("[data-app] section", (nodes) =>
    nodes.map((n) => getComputedStyle(n).borderTopWidth),
  );
  expect(borders.length).toBeGreaterThan(1);
  expect(borders).toEqual(borders.map(() => "3px"));
});

Then("the browser refused nothing the page asked for", async function (this: PointerWorld) {
  expect(await this.policyRefusals()).toEqual([]);
});
