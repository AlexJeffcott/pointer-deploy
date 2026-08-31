import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import { PointerWorld, PROPAGATION_WINDOW_MS } from "../support/world.ts";
import { configFromEnv, getObjectText } from "../../scripts/store.ts";

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

Then("every sub-app the shell can import carries one too", function (this: PointerWorld) {
  const map = importMapIn(this.lastBody);
  const apps = JSON.parse(/id="__APPS__">(.*?)<\/script>/s.exec(this.lastBody)![1]!) as Record<
    string,
    { js: string; css?: string; cssIntegrity?: string }
  >;

  expect(Object.keys(apps).length).toBeGreaterThan(0);
  const digested: string[] = [];
  for (const a of Object.values(apps)) {
    digested.push(map.integrity?.[a.js] ?? "none");
    if (a.css) digested.push(a.cssIntegrity ?? "none");
  }
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
    await this.awaitShellContaining("qa", WRONG, PROPAGATION_WINDOW_MS + 15_000);
  },
);

When("a visitor navigates to the counters view", async function (this: PointerWorld) {
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
    expect(await page.$$eval(`[data-app="${app}"]`, (n) => n.length)).toBe(0);
  },
);

Then("every panel on the page is styled by its own stylesheet", async function (this: PointerWorld) {
  const page = this.browserPage;

  const accent = await page.evaluate(() =>
    getComputedStyle(document.documentElement).getPropertyValue("--accent").trim(),
  );
  expect(accent).not.toBe("");

  const borders = await page.$$eval("[data-app] section", (nodes) =>
    nodes.map((n) => getComputedStyle(n).borderTopWidth),
  );
  expect(borders.length).toBeGreaterThan(1);
  expect(borders).toEqual(borders.map(() => "3px"));
});

Then("the browser refused nothing the page asked for", async function (this: PointerWorld) {
  expect(await this.policyRefusals()).toEqual([]);
});
