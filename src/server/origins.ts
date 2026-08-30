// Host -> channel, and Fly region -> manifest region.
//
// Two lookups, two opposite failure rules, both deliberate:
//
//   Host   fails CLOSED. Host parsing is the only thing separating prod from
//          qa, so an unrecognised host must be refused, never defaulted.
//   Region fails OPEN.   The machine is running somewhere; refusing all
//                        traffic is worse than one wrong region. The miss is
//                        logged instead.
//
// Pure. No I/O, no clock. The unit test is the point of this file.

export type Channel = "prod" | "qa" | "test-prod" | "test-qa";

/**
 * Every manifest region there is.
 *
 * A server reads exactly one of these - the one its own Fly region maps to -
 * and an operator writes all of them, because a channel names one composition
 * wherever it is served. The list lives here rather than in the scripts so that
 * the two readings cannot drift: a region this server would resolve to and a
 * region no promote writes is a machine that answers 503.
 */
export const REGIONS = ["eu", "us"] as const;
export type Region = (typeof REGIONS)[number];

export type Target = { region: Region; channel: Channel };

const DEPLOYED: Record<string, Channel> = {
  "pointer-deploy.fly.dev": "qa",
  // Fly gives one free hostname per app and .fly.dev is its namespace, so a
  // second channel cannot have a resolvable name until a real domain points
  // here. Fly forwards the Host header untouched, so the channel works today
  // for anything that can set one. .test is IANA-reserved and never resolves,
  // which keeps it obvious that no browser can reach this yet.
  "prod.pointer-deploy.test": "prod",
  // The live acceptance suite's own channels. It publishes throwaway builds
  // and promotes them, so pointing it at qa or prod deployed them: every run
  // left the real channels serving whatever the last scenario had published.
  // These are reachable the same way prod is - by a Host header, which no
  // browser can be made to send - and nothing but the suite writes them.
  "test-qa.pointer-deploy.test": "test-qa",
  "test-prod.pointer-deploy.test": "test-prod",
  // With a domain, replace the line above and add:
  // "qa.EXAMPLE.COM": "qa",
  // "app.EXAMPLE.COM": "prod",
};

// *.localhost resolves to the loopback address in browsers and on macOS, so
// two channels are reachable in development with no hosts-file entry. Kept out
// of production because Host is attacker-controlled.
const LOCAL: Record<string, Channel> = {
  localhost: "qa",
  "qa.localhost": "qa",
  "prod.localhost": "prod",
  "127.0.0.1": "qa",
  // The suite's own channels, reachable by a browser.
  //
  // Live, they are reached by a Host header, which no browser can be made to
  // send - Host is forbidden to setExtraHTTPHeaders, and Fly routes on SNI, so
  // a resolver override cannot supply it either. scripts/e2e-independent-deploy
  // therefore runs this same server locally against the real store and drives
  // Chrome at these names. Development only, like everything else here.
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

export function hostTable(isProduction: boolean): Record<string, Channel> {
  return isProduction ? DEPLOYED : { ...DEPLOYED, ...LOCAL };
}

export function resolveRegion(flyRegion: string | undefined): Region {
  // Stryker disable next-line StringLiteral: no input reaches it. "" is here to
  // give the index a string, and no key of FLY_TO_REGION is the empty string,
  // so every miss lands on the same fallback whatever this default is.
  const region = FLY_TO_REGION[flyRegion ?? ""];
  if (region) return region;
  // Not an error path worth refusing traffic over, but it must be visible:
  // a new Fly region silently serving the wrong manifest is the failure.
  console.warn(
    `[origins] unknown FLY_REGION ${JSON.stringify(flyRegion ?? null)}, falling back to "eu"`,
  );
  return "eu";
}

/** Returns null for an unrecognised host. Never falls back to a channel. */
export function resolveChannel(
  host: string | null | undefined,
  table: Record<string, Channel>,
): Channel | null {
  if (!host) return null;
  // Strip the port, lowercase, and drop a trailing dot (a fully qualified
  // "example.com." is the same host).
  //
  // Stryker disable next-line OptionalChaining,StringLiteral: no input reaches
  // either. String.prototype.split always returns at least one element, so
  // index 0 is never undefined; both exist to satisfy noUncheckedIndexedAccess.
  // They are kept rather than rewritten because this parser is the only thing
  // separating prod from qa, and its semantics are not worth changing for a
  // score.
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
