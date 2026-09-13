// The service the units do not build alongside, §13.
//
// Two things are published here, and the difference between them is the whole
// point of §26:
//
//   SERVES        which versions this deploy answers. An operator's choice, in
//                 the environment, changed with `fly secrets set` and no build.
//   FIELDS        what is INSIDE a version. Declared here, beside the handlers
//                 that return them, because there is no compiler to measure it
//                 from - the shell reaches this service over HTTP and shares no
//                 type with it.
//
// A field can be marked as going away without any code change at all:
// API_DEPRECATED carries the decision, the discovery document reports it, and
// every response that would have carried that field says so in its headers.
// That is the same shape as `contract:deprecate` for the internal contract -
// a warning, never a refusal - and for the same reason: a page that stops
// working on the day a field is deprecated is worse than the fault it reports.
//
// TWO resources, `PLAN.md` step 6, and the machinery above is still what this
// service is for. `greeting` was the smallest thing it could carry while the
// slate had no data to move; snapshots and slots are what it carries now.
//
// **The service holds nothing between requests.** It holds a bucket key, and
// the bucket holds the snapshots. That is why `handle` takes a `Store` where
// it used to take an `ApiState`, and why `api/fly.toml` no longer has to keep
// a machine up to protect state in memory.
//
// The same mechanism as the pointer, applied twice:
//
//   a snapshot   written under the hash of its own bytes, never overwritten,
//                permanent. Like `units/<name>/<id>/`.
//   a slot       a small JSON file naming one snapshot. Like
//                `manifests/<region>/<channel>.json`.
//
// Two capabilities over one resource. Holding the SLOT ID grants read: the
// slot, and every snapshot it names. Holding the WRITE KEY grants the move.
// There is no account, no login and no user record anywhere, and a page that
// shares a planner says in those words that anyone holding the slot id can
// read it.

import type { Store } from "./store.ts";

export const SERVES: string[] = (Bun.env.API_SERVES ?? "v1")
  .split(",")
  .map((v) => v.trim())
  .filter(Boolean);

/**
 * A snapshot, as this version returns one.
 *
 * `snapshot` is the id and `digest` is what the id is - the same value twice,
 * and deliberately. The id is an ADDRESS a page holds and passes around; the
 * digest is a claim about the bytes. Step 8 restores an older snapshot by
 * naming a digest, and step 12 rolls a unit back by naming an id, which is the
 * same sentence about two things.
 *
 * `tasks` is the field step 13 retires in favour of `document`, because a
 * planner stores more than tasks once it stores anything. It is declared in
 * `FIELDS` so `API_DEPRECATED` can name it with no code change at all.
 */
export type ApiSnapshot = {
  snapshot: string;
  digest: string;
  createdAt: string;
  tasks: unknown;
};

/** A slot, as this version returns one. The write key is never in it. */
export type ApiSlot = {
  snapshot: string | null;
  /** Every snapshot this slot held before, newest first. */
  history: readonly string[];
};

/** What one version of this service returns. Declared, not measured. */
export type ApiField = { path: string; type: string };
export type ApiRoute = { method: string; path: string };

export const FIELDS: Record<string, ApiField[]> = {
  v1: [
    { path: "snapshot.snapshot", type: "string" },
    { path: "snapshot.digest", type: "string" },
    { path: "snapshot.createdAt", type: "string" },
    { path: "snapshot.tasks", type: "array" },
    { path: "slot.snapshot", type: "string" },
    { path: "slot.history", type: "array" },
  ],
};

export const ROUTES: Record<string, ApiRoute[]> = {
  v1: [
    { method: "POST", path: "/snapshots" },
    { method: "GET", path: "/snapshots/:digest" },
    { method: "POST", path: "/slots" },
    { method: "GET", path: "/slots/:slot" },
    { method: "PUT", path: "/slots/:slot" },
  ],
};

/**
 * A field that is going away.
 *
 * `since` is when the decision took effect and `sunset` is when the field
 * stops being answered. Both are dates rather than one, because RFC 9745
 * `Deprecation` and RFC 8594 `Sunset` are two separate readings and an
 * operator needs them apart: "it is deprecated" and "it is gone" are different
 * days, and the gap between them is the notice period.
 */
export type ApiDeprecation = {
  path: string;
  since: string;
  sunset: string;
  reason: string;
  instead: string | null;
};

const date = (label: string, value: unknown): string => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`API_DEPRECATED ${label} is not a YYYY-MM-DD date: ${JSON.stringify(value)}`);
  }
  // Round-tripped rather than parsed. `Date.parse` rolls an overflowing day
  // into the next month, so 2026-02-31 reads as 3 March and a typed date the
  // operator meant as the end of February would silently move.
  const when = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(when.getTime()) || when.toISOString().slice(0, 10) !== value) {
    throw new Error(`API_DEPRECATED ${label} is not a date that exists: ${value}`);
  }
  return value;
};

/**
 * Reads the operator's decision out of the environment.
 *
 * It THROWS, so a malformed value stops the process rather than being ignored.
 * A service that swallowed the error would publish "nothing is going away",
 * which is not silence - it is a false reading, and the operator who set the
 * variable has no way to tell it from a working one.
 *
 * `known` is checked for the same reason. `user.color` is a plausible thing to
 * type and names no field this service has, so it is refused here rather than
 * reported to every page as a deprecation nobody can act on.
 */
export function parseDeprecations(raw: string, known: readonly string[]): ApiDeprecation[] {
  const text = raw.trim();
  if (text === "") return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new Error(`API_DEPRECATED is not JSON: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!Array.isArray(parsed)) throw new Error("API_DEPRECATED is not an array");

  return parsed.map((entry, i) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new Error(`API_DEPRECATED[${i}] is not an object`);
    }
    const e = entry as Record<string, unknown>;
    const path = e.path;
    if (typeof path !== "string" || path.length === 0) {
      throw new Error(`API_DEPRECATED[${i}].path is not a non-empty string`);
    }
    if (!known.includes(path)) {
      throw new Error(
        `API_DEPRECATED[${i}].path names ${path}, which this service does not answer. ` +
          `It answers ${known.join(", ")}.`,
      );
    }
    const reason = e.reason;
    if (typeof reason !== "string" || reason.trim() === "") {
      throw new Error(`API_DEPRECATED[${i}].reason is missing. A deprecation has to say why.`);
    }
    if (!("instead" in e)) {
      throw new Error(
        `API_DEPRECATED[${i}].instead is missing. Name the field to move to, or null. ` +
          `Nothing to move to is a legitimate reading and has to be said out loud.`,
      );
    }
    const instead = e.instead;
    if (instead !== null && (typeof instead !== "string" || instead.length === 0)) {
      throw new Error(`API_DEPRECATED[${i}].instead is neither a field name nor null`);
    }
    const since = date(`[${i}].since`, e.since);
    const sunset = date(`[${i}].sunset`, e.sunset);
    if (Date.parse(`${sunset}T00:00:00Z`) < Date.parse(`${since}T00:00:00Z`)) {
      throw new Error(`API_DEPRECATED[${i}] sunsets ${sunset}, before it was deprecated ${since}`);
    }
    return { path, since, sunset, reason: reason.trim(), instead };
  });
}

/** Every field path this deploy answers, across every version it serves. */
export const answered = (serves: readonly string[] = SERVES): string[] => [
  ...new Set(serves.flatMap((v) => (FIELDS[v] ?? []).map((f) => f.path))),
];

export const DEPRECATED: ApiDeprecation[] = parseDeprecations(
  Bun.env.API_DEPRECATED ?? "",
  answered(),
);

/** The discovery document, §26. `serves` stays first and stays a list of strings. */
export function discovery(
  serves: readonly string[] = SERVES,
  deprecated: readonly ApiDeprecation[] = DEPRECATED,
): Record<string, unknown> {
  return {
    serves: [...serves],
    versions: Object.fromEntries(
      serves.map((v) => [
        v,
        {
          routes: (ROUTES[v] ?? []).map((r) => ({ ...r, path: `/${v}${r.path}` })),
          fields: (FIELDS[v] ?? []).map((f) => {
            const going = deprecated.find((d) => d.path === f.path);
            return going
              ? {
                  ...f,
                  deprecated: {
                    since: going.since,
                    sunset: going.sunset,
                    reason: going.reason,
                    instead: going.instead,
                  },
                }
              : f;
          }),
        },
      ]),
    ),
  };
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type",
  // Without this a cross-origin page can read the body and NOT the two headers
  // below it, so the deprecation would be published to everything except the
  // thing that has to act on it.
  "access-control-expose-headers": "deprecation, sunset, link",
  // Stryker disable next-line StringLiteral: cache duration, not behaviour.
  "access-control-max-age": "600",
};

const seconds = (day: string): number => Math.floor(Date.parse(`${day}T00:00:00Z`) / 1000);
const httpDate = (day: string): string => new Date(`${day}T00:00:00Z`).toUTCString();

/**
 * The deprecations a response carrying `top` has to declare.
 *
 * Matched on the first segment of the field path, because that is what a body
 * holds: `GET /v1/user` returns the object every `user.*` field lives in, so a
 * deprecation of `user.colour` is a fact about that response.
 */
export const deprecationsFor = (
  top: string,
  deprecated: readonly ApiDeprecation[] = DEPRECATED,
): ApiDeprecation[] => deprecated.filter((d) => d.path.split(".")[0] === top);

/**
 * RFC 9745 `Deprecation` and RFC 8594 `Sunset`, for the earliest of them.
 *
 * One response, one pair of headers, and two deprecated fields in the same
 * body cannot each have their own. The earliest sunset is the one an operator
 * has least time to act on, so that is the one reported; the discovery
 * document carries the rest, field by field.
 */
export function deprecationHeaders(
  matched: readonly ApiDeprecation[],
  origin: string,
): Record<string, string> {
  if (matched.length === 0) return {};
  const soonest = [...matched].sort((a, b) => a.sunset.localeCompare(b.sunset))[0]!;
  return {
    deprecation: `@${seconds(soonest.since)}`,
    sunset: httpDate(soonest.sunset),
    link: `<${origin}/versions>; rel="deprecation"`,
  };
}

const json = (body: unknown, status = 200, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      ...CORS,
      ...extra,
    },
  });

const refuse = (field: string, why: string) => json({ error: `${field} ${why}` }, 400);

/**
 * An address nobody can guess, in the alphabet a URL and a JSON string share.
 *
 * `crypto.getRandomValues` and not `Math.random`: a slot id is the ONLY thing
 * standing between a planner and a stranger, because holding it is what grants
 * read. 16 bytes for an id and 32 for a write key, base64url so neither needs
 * escaping anywhere it is carried.
 */
const secret = (bytes: number): string => {
  const raw = new Uint8Array(bytes);
  crypto.getRandomValues(raw);
  return Buffer.from(raw).toString("base64url");
};

/** The sha256 of some bytes, hex. What a snapshot is written under. */
const digestOf = (body: string): string =>
  new Bun.CryptoHasher("sha256").update(body).digest("hex");

/**
 * The write key, as the slot file holds it.
 *
 * The HASH and never the key. `GET /slots/:slot` returns the slot to anyone
 * holding the id - that is the read capability - so a slot file carrying its
 * own write key would hand the move to every reader and collapse the two
 * capabilities into one.
 */
const keyHash = (key: string): string =>
  new Bun.CryptoHasher("sha256").update(key).digest("hex");

/** What a slot file holds. Not what `GET` returns: that omits `writeKeyHash`. */
type StoredSlot = {
  snapshot: string | null;
  history: string[];
  writeKeyHash: string;
  createdAt: string;
};

const snapshotKey = (digest: string) => `snapshots/${digest}.json`;
const slotKey = (slot: string) => `slots/${slot}.json`;

/** Ids this service mints, and the only shape it will look up. */
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const DIGEST = /^[0-9a-f]{64}$/;

/**
 * A body, read once and no larger than a planner.
 *
 * A cap rather than none, because the bucket is written on the strength of one
 * unauthenticated POST. 1 MiB is far above any planner this application makes
 * and far below a payload worth sending.
 */
const MAX_BODY = 1024 * 1024;

export async function handle(req: Request, store: Store): Promise<Response> {
  const url = new URL(req.url);
  const { pathname } = url;

  // Stryker disable next-line ObjectLiteral: 200 is what an empty init means.
  if (pathname === "/healthz") return new Response("ok", { status: 200 });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  if (pathname === "/versions") return json(discovery());

  const route = /^\/([^/]+)\/(.*)$/.exec(pathname);
  if (!route || !SERVES.includes(route[1]!)) return json({ error: "not found" }, 404);
  const rest = `/${route[2]}`;

  const going = (top: string) => deprecationHeaders(deprecationsFor(top), url.origin);

  if (rest === "/snapshots" && req.method === "POST") {
    const raw = await req.text();
    if (raw.length > MAX_BODY) return refuse("body", `is longer than ${MAX_BODY} bytes`);
    const body = parseObject(raw);
    if (!body) return refuse("body", "is not a JSON object");

    // Written under the hash of its own bytes, so pushing the same planner
    // twice is the same address and costs one write. Never overwritten: the
    // bytes at a digest ARE that digest, so a second write of them changes
    // nothing and a write of anything else would be a different address.
    const digest = digestOf(raw);
    const created = new Date().toISOString();
    if (!(await store.has(snapshotKey(digest)))) {
      await store.write(snapshotKey(digest), JSON.stringify({ createdAt: created, body }));
    }
    const held = await readSnapshot(store, digest);
    if (!held) return json({ error: "the snapshot was not kept" }, 500, going("snapshot"));
    return json(held, 201, going("snapshot"));
  }

  const snapshot = /^\/snapshots\/(.+)$/.exec(rest);
  if (snapshot) {
    if (req.method !== "GET") return json({ error: "method not allowed" }, 405);
    const digest = snapshot[1]!;
    if (!DIGEST.test(digest)) return refuse("digest", "is not a sha256");
    const held = await readSnapshot(store, digest);
    if (!held) return json({ error: "not found" }, 404);
    return json(held, 200, going("snapshot"));
  }

  if (rest === "/slots" && req.method === "POST") {
    // No body. A slot is an empty address: it is minted, and then moved. That
    // keeps minting and moving two acts, so the write key exists before
    // anything is at the address it protects.
    const slot = secret(16);
    const writeKey = secret(32);
    const stored: StoredSlot = {
      snapshot: null,
      history: [],
      writeKeyHash: keyHash(writeKey),
      createdAt: new Date().toISOString(),
    };
    await store.write(slotKey(slot), JSON.stringify(stored));
    // The ONE response that carries the write key. It is not stored, it is not
    // in any GET, and it cannot be recovered - which is said on the page that
    // asks for it rather than left to be discovered.
    return json({ slot, writeKey }, 201, going("slot"));
  }

  const slotRoute = /^\/slots\/(.+)$/.exec(rest);
  if (slotRoute) {
    const slot = slotRoute[1]!;
    if (!ID.test(slot)) return refuse("slot", "is not a slot id");
    const stored = await readSlot(store, slot);
    if (!stored) return json({ error: "not found" }, 404);

    if (req.method === "GET") {
      // `writeKeyHash` and `createdAt` are not in it. Holding the id grants
      // read of the slot and of every snapshot it names, and nothing else.
      const seen: ApiSlot = { snapshot: stored.snapshot, history: [...stored.history] };
      return json(seen, 200, going("slot"));
    }

    if (req.method === "PUT") {
      const offered = req.headers.get("x-write-key") ?? "";
      // Compared as HASHES, and refused with 403 rather than 404. The slot's
      // existence is not the secret - the id already granted read - so
      // pretending it is missing would tell a holder of the id something
      // false about their own slot.
      if (!offered || keyHash(offered) !== stored.writeKeyHash) {
        return json({ error: "the write key does not move this slot" }, 403);
      }
      const body = parseObject(await req.text());
      if (!body) return refuse("body", "is not a JSON object");
      const named = typeof body.snapshot === "string" ? body.snapshot : "";
      if (!DIGEST.test(named)) return refuse("snapshot", "is not a sha256");
      if (!(await store.has(snapshotKey(named)))) {
        return refuse("snapshot", "names no snapshot this service holds");
      }

      // The id it held goes to the front of the history, and the history is
      // what step 8 restores from. A move to the snapshot it already names
      // writes no history entry: nothing moved.
      const history =
        stored.snapshot && stored.snapshot !== named
          ? [stored.snapshot, ...stored.history]
          : [...stored.history];
      const next: StoredSlot = { ...stored, snapshot: named, history };
      await store.write(slotKey(slot), JSON.stringify(next));
      const seen: ApiSlot = { snapshot: next.snapshot, history: [...next.history] };
      return json(seen, 200, going("slot"));
    }

    return json({ error: "method not allowed" }, 405);
  }

  return json({ error: "not found" }, 404);
}

/** One snapshot out of the bucket, as this version returns it. */
async function readSnapshot(store: Store, digest: string): Promise<ApiSnapshot | null> {
  const raw = await store.read(snapshotKey(digest));
  if (raw === null) return null;
  const held = parseObject(raw);
  if (!held) return null;
  const body = held.body as Record<string, unknown> | undefined;
  return {
    snapshot: digest,
    digest,
    createdAt: typeof held.createdAt === "string" ? held.createdAt : "",
    tasks: body?.tasks ?? [],
  };
}

async function readSlot(store: Store, slot: string): Promise<StoredSlot | null> {
  const raw = await store.read(slotKey(slot));
  if (raw === null) return null;
  const held = parseObject(raw);
  if (!held) return null;
  return {
    snapshot: typeof held.snapshot === "string" ? held.snapshot : null,
    history: Array.isArray(held.history) ? held.history.filter((h) => typeof h === "string") : [],
    writeKeyHash: typeof held.writeKeyHash === "string" ? held.writeKeyHash : "",
    createdAt: typeof held.createdAt === "string" ? held.createdAt : "",
  };
}

const parseObject = (raw: string): Record<string, unknown> | null => {
  try {
    const value = JSON.parse(raw) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
};
