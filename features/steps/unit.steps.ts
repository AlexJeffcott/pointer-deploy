import { Given, Then, When } from "../support/bdd.ts";
import { expect } from "@playwright/test";
import {
  CACHE_IMMUTABLE,
  configFromEnv,
  contentTypeFor,
  putObject,
} from "../../scripts/store.ts";
import {
  type Channel,
  PointerWorld,
  PROPAGATION_WINDOW_MS,
  appScriptUrls,
  run,
  unitIdsInShell,
} from "../support/world.ts";
import { APPS, UNITS, type Unit } from "../../scripts/contract.ts";

const BUDGET_MS = PROPAGATION_WINDOW_MS + 15_000;

/** The id each "a new <app> unit is published" step produced, by app. */
export const fresh = new Map<string, string>();

export const RUN = Date.now().toString(36);

export async function publishOneApp(world: PointerWorld, app: string, marker: string) {
  const built = await run(["bun", "run", "build"], {
    BUILD_MARKER: "one",
    [`BUILD_MARKER_${app.toUpperCase()}`]: marker,
  });
  if (built.code !== 0) throw new Error(`build failed:\n${built.stderr}`);

  const published = await run(["bun", "run", "--silent", "scripts/publish.ts"]);
  if (published.code !== 0) throw new Error(`publish failed:\n${published.stderr}`);
  world.lastRun = published;
  return JSON.parse(published.stdout) as Record<Unit, string>;
}

Given("a new {string} unit is published", async function (this: PointerWorld, app: string) {
  const ids = await publishOneApp(this, app, `${app}-v2`);
  const id = ids[app as Unit];
  const baseline = this.unitIdOf("one", app as Unit);
  expect(id).not.toBe(baseline);
  fresh.set(app, id);
});

When("the operator promotes that {string} unit to the {word} channel", async function (this: PointerWorld, app: string, channel: string) {
  const id = fresh.get(app);
  if (!id) throw new Error(`no fresh ${app} unit was published`);
  this.lastRun = await this.promoteUnit(channel as Channel, app as Unit, id);
});

Given("that {string} unit is already deployed to the {word} channel", async function (this: PointerWorld, app: string, channel: string) {
  const id = fresh.get(app);
  if (!id) throw new Error(`no fresh ${app} unit was published`);
  this.lastRun = await this.promoteUnit(channel as Channel, app as Unit, id);
  expect(this.lastRun.code).toBe(0);
  await this.awaitUnit(channel as Channel, app as Unit, id, BUDGET_MS);
});

When("the operator promotes build {string}'s {string} unit to the {word} channel", async function (this: PointerWorld, name: string, app: string, channel: string) {
  this.lastRun = await this.promoteUnit(channel as Channel, app as Unit, this.unitIdOf(name, app as Unit));
});

When("the operator promotes an {string} unit that was never published", async function (this: PointerWorld, app: string) {
  this.lastRun = await this.promoteUnit("qa", app as Unit, "0000dead");
});

When("the operator builds and publishes with only {string} changed", async function (this: PointerWorld, app: string) {
  await publishOneApp(this, app, `${app}-${RUN}`);
});

Then("visitors to the {word} origin receive the new {string} unit within the propagation window", async function (this: PointerWorld, channel: string, app: string) {
  const id = fresh.get(app)!;
  this.elapsedMs = await this.awaitUnit(channel as Channel, app as Unit, id, BUDGET_MS);
});

Then("visitors to the {word} origin receive build {string}'s {string} unit within the propagation window", async function (this: PointerWorld, channel: string, name: string, app: string) {
  const id = this.unitIdOf(name, app as Unit);
  this.elapsedMs = await this.awaitUnit(channel as Channel, app as Unit, id, BUDGET_MS);
});

Then("the {word} channel still serves the new {string} unit", async function (this: PointerWorld, channel: string, app: string) {
  await this.visit(channel as Channel);
  expect(unitIdsInShell(this.lastBody)[app as Unit]).toBe(fresh.get(app));
});

Then("the {word} channel still serves build {string} for bravo, charlie, delta and the shell", async function (this: PointerWorld, channel: string, name: string) {
  await this.visit(channel as Channel);
  const served = unitIdsInShell(this.lastBody);
  for (const unit of UNITS.filter((u) => u !== "alpha")) {
    expect(`${unit}=${served[unit]}`).toBe(`${unit}=${this.unitIdOf(name, unit)}`);
  }
});

Then("the {word} channel still serves build {string} for every unit", async function (this: PointerWorld, channel: string, name: string) {
  await this.visit(channel as Channel);
  const served = unitIdsInShell(this.lastBody);
  for (const unit of UNITS) {
    expect(`${unit}=${served[unit]}`).toBe(`${unit}=${this.unitIdOf(name, unit)}`);
  }
});

Then("each sub-app on the {word} origin is fetched from its own unit's directory", async function (this: PointerWorld, channel: string) {
  await this.visit(channel as Channel);
  const served = unitIdsInShell(this.lastBody);
  const urls = appScriptUrls(this.lastBody);
  expect(Object.keys(urls).sort()).toEqual([...APPS].sort());
  for (const app of APPS) {
    expect(urls[app]).toContain(`/units/${app}/${served[app]}/`);
  }
});

Then("only the {word} unit is uploaded", function (this: PointerWorld, unit: string) {
  expect(this.lastRun?.code).toBe(0);
  const report = this.lastRun?.stderr ?? "";
  const uploaded = report
    .split("\n")
    .filter((l) => l.includes("uploaded"))
    .map((l) => l.trim().split(/\s+/)[0]);
  expect(uploaded, `publish reported:\n${report}`).toEqual([unit]);
});

async function publishIncompatible(
  world: PointerWorld,
  patch: (manifest: Record<string, unknown>) => Record<string, unknown>,
): Promise<void> {
  const cfg = configFromEnv();
  const id = `incompat-${Bun.hash(`${process.pid}`).toString(16)}`;
  const prefix = `units/alpha/${id}`;
  const baseline = world.unitIdOf("one", "alpha");

  const source = await fetch(
    `https://${cfg.bucket}.${new URL(cfg.endpoint).host}/units/alpha/${baseline}/unit.json`,
  );
  const manifest = (await source.json()) as Record<string, unknown> & { files: string[] };

  await putObject(cfg, `${prefix}/${manifest.js as string}`, new TextEncoder().encode("export function mount(){return()=>{}}\n"), {
    contentType: contentTypeFor("x.js"),
    cacheControl: CACHE_IMMUTABLE,
  });
  await putObject(
    cfg,
    `${prefix}/unit.json`,
    new TextEncoder().encode(
      `${JSON.stringify(
        patch({
          ...manifest,
          id,
          assetBase: `https://${cfg.bucket}.${new URL(cfg.endpoint).host}/${prefix}/`,
          css: null,
          files: [manifest.js as string],
        }),
        null,
        2,
      )}\n`,
    ),
    { contentType: "application/json; charset=utf-8", cacheControl: CACHE_IMMUTABLE },
  );
  fresh.set("incompatible", id);
}

Given(
  "a unit published against a contract the shell does not support",
  async function (this: PointerWorld) {
    await publishIncompatible(this, (m) => {
      const { uses: _uses, subapps: _subapps, ...rest } = m;
      return { ...rest, contracts: ["0000000"] };
    });
  },
);

Given(
  "a unit published needing a member the shell does not provide",
  async function (this: PointerWorld) {
    await publishIncompatible(this, (m) => ({
      ...m,
      uses: { ...((m.uses as Record<string, string>) ?? {}), "ShellStore.teleport": "0000000" },
    }));
  },
);

When("the operator promotes that unit to the {word} channel", async function (this: PointerWorld, channel: string) {
  this.lastRun = await this.promoteUnit(channel as Channel, "alpha", fresh.get("incompatible")!);
});

Then("the promotion is refused because no contract is shared", function (this: PointerWorld) {
  expect(this.lastRun?.code).not.toBe(0);
  expect(this.lastRun?.stderr).toContain("no contract is supported by every unit");
  expect(this.lastRun?.stderr).toContain("Nothing was changed");
});

Then(
  "the promotion is refused and names the member and the sub-app",
  function (this: PointerWorld) {
    expect(this.lastRun?.code).not.toBe(0);
    expect(this.lastRun?.stderr).toContain(
      "alpha uses ShellStore.teleport, which this shell does not have",
    );
    expect(this.lastRun?.stderr).toContain("Nothing was changed");
    expect(this.lastRun?.stderr).not.toContain("no contract is supported");
  },
);

Then("the promotion is refused because that unit is not published", function (this: PointerWorld) {
  expect(this.lastRun?.code).not.toBe(0);
  expect(this.lastRun?.stderr).toContain("not published");
});
