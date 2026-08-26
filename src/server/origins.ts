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

export type Channel = "prod" | "qa";
export type Region = "eu" | "us";

export type Target = { region: Region; channel: Channel };

const DEPLOYED: Record<string, Channel> = {
  "pointer-deploy.fly.dev": "qa",
  // Fly gives one free hostname per app and .fly.dev is its namespace, so a
  // second channel cannot have a resolvable name until a real domain points
  // here. Fly forwards the Host header untouched, so the channel works today
  // for anything that can set one. .test is IANA-reserved and never resolves,
  // which keeps it obvious that no browser can reach this yet.
  "prod.pointer-deploy.test": "prod",
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
