export type Channel = "prod" | "qa" | "test-prod" | "test-qa";

export const REGIONS = ["eu", "us"] as const;
export type Region = (typeof REGIONS)[number];

export type Target = { region: Region; channel: Channel };

const DEPLOYED: Record<string, Channel> = {
  "pointer-deploy.fly.dev": "qa",
  "prod.pointer-deploy.test": "prod",
  "test-qa.pointer-deploy.test": "test-qa",
  "test-prod.pointer-deploy.test": "test-prod",
};

const LOCAL: Record<string, Channel> = {
  localhost: "qa",
  "qa.localhost": "qa",
  "prod.localhost": "prod",
  "127.0.0.1": "qa",
  "test-qa.localhost": "test-qa",
  "test-prod.localhost": "test-prod",
};

const FLY_TO_REGION: Record<string, Region> = {
  ams: "eu",
  lhr: "eu",
  fra: "eu",
  cdg: "eu",
  arn: "eu",
  mad: "eu",
  iad: "us",
  ord: "us",
  sjc: "us",
  lax: "us",
};

/**
 * A build a pull request made, and the only marker a real channel will compose
 * from the catalogue. CI sets `BUILD_MARKER=pr-<number>`, §30.
 */
const PREVIEW = /^pr-\d+$/;

/**
 * Which markers this channel will take from the unit CATALOGUE, §30.
 *
 * Not from its own history: a channel that really served a marked unit keeps
 * it, because it really served it. This decides what a channel may reach for
 * that it has never served, which is the question a preview asks.
 *
 * `prod` is the fallthrough on purpose. A channel added later lands on the
 * strictest rule and has to be named here to get any other one.
 */
export function admitsMarker(channel: Channel): (marker: string) => boolean {
  if (channel.startsWith("test-")) return () => true;
  if (channel === "qa") return (marker) => marker === "" || PREVIEW.test(marker);
  return (marker) => marker === "";
}

export function hostTable(isProduction: boolean): Record<string, Channel> {
  return isProduction ? DEPLOYED : { ...DEPLOYED, ...LOCAL };
}

export function resolveRegion(flyRegion: string | undefined): Region {
  // Stryker disable next-line StringLiteral: no input reaches it.
  const region = FLY_TO_REGION[flyRegion ?? ""];
  if (region) return region;
  console.warn(
    `[origins] unknown FLY_REGION ${JSON.stringify(flyRegion ?? null)}, falling back to "eu"`,
  );
  return "eu";
}

export function resolveChannel(
  host: string | null | undefined,
  table: Record<string, Channel>,
): Channel | null {
  if (!host) return null;
  // Stryker disable next-line OptionalChaining,StringLiteral: no input reaches it.
  const name = host.toLowerCase().split(":")[0]?.replace(/\.$/, "") ?? "";
  return table[name] ?? null;
}

export function resolveTarget(
  host: string | null | undefined,
  table: Record<string, Channel>,
  region: Region,
): Target | null {
  const channel = resolveChannel(host, table);
  return channel ? { region, channel } : null;
}
