// Where the service keeps what it holds, `PLAN.md` step 6.
//
// The service itself holds NOTHING between requests. This module is the bucket
// in front of it, and the reason the bucket is a second one is the whole
// security argument of that step: the asset bucket's key can write the files
// the origin executes, so a service holding it would turn a service compromise
// into an origin compromise. `bun run verify:keys` measures that this key
// cannot - 403 on a write and on a delete against `pointer-deploy-assets`.
//
// `Bun.S3Client` and not the signer in `scripts/store.ts`, because the image
// this runs in copies `api/` and nothing else (see `api/Dockerfile`, and the
// sentence there about why the two deploys are separate). Importing the
// signer would mean either copying more into the image or writing SigV4 a
// second time, and a second copy of a signing rule is a second reading that
// can disagree with the first. Measured on 2026-09-13: write, read, exists and
// delete all work against Tigris, and a missing key throws `S3Error`.
//
// The `Store` type is what `handle` takes, so the service's own tests run with
// no bucket at all. That matters: `api/Dockerfile` runs `bun test api` inside
// the build, where no credential exists and none should.

/** What the service does to a bucket, and the whole of it. */
export type Store = {
  /** The bytes at `key`, or null when there is nothing there. */
  read(key: string): Promise<string | null>;
  /** Writes `body` at `key`. Overwrites, so a caller that must not says so. */
  write(key: string, body: string): Promise<void>;
  /** Whether anything is at `key`. */
  has(key: string): Promise<boolean>;
};

export type BucketConfig = {
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  endpoint: string;
  region: string;
  /**
   * Every key this store touches begins with it.
   *
   * TODO §29. The live suite writes to the deployed service, and the channels
   * were already handled - the suite owns `test-qa` and `test-prod` and a
   * tripwire fails a run that moved a real one - while the service had no
   * equivalent. `API_KEY_PREFIX=test/` gives the suite its own keyspace in the
   * same bucket, so a sweep can find what a run wrote and nothing it wrote can
   * be read by a visitor's slot id.
   */
  prefix: string;
};

export function configFromEnv(): BucketConfig | null {
  const id = Bun.env.AWS_ACCESS_KEY_ID;
  const secret = Bun.env.AWS_SECRET_ACCESS_KEY;
  const bucket = Bun.env.BUCKET_NAME;
  // All three or none. A service holding two of them would answer some
  // requests and fail others, which is worse than answering none: a page would
  // push a planner, be told it was kept, and find nothing there.
  if (!id || !secret || !bucket) return null;
  return {
    accessKeyId: id,
    secretAccessKey: secret,
    bucket,
    endpoint: Bun.env.AWS_ENDPOINT_URL_S3 ?? "https://fly.storage.tigris.dev",
    region: Bun.env.AWS_REGION || "auto",
    prefix: Bun.env.API_KEY_PREFIX ?? "",
  };
}

/**
 * The bucket, as a `Store`.
 *
 * A missing key is `null` and not a throw, because "nobody has pushed that
 * snapshot" is an answer a route gives a person - 404 - rather than a fault.
 * Every other S3 error is rethrown: a bucket that is refusing writes is not a
 * missing object, and answering 404 for it would tell a visitor their planner
 * was never there.
 */
export function bucketStore(config: BucketConfig): Store {
  const client = new Bun.S3Client({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    bucket: config.bucket,
    endpoint: config.endpoint,
    region: config.region,
  });
  const at = (key: string) => `${config.prefix}${key}`;

  return {
    async read(key) {
      try {
        return await client.file(at(key)).text();
      } catch (e) {
        if (isMissing(e)) return null;
        throw e;
      }
    },
    async write(key, body) {
      await client.write(at(key), body, { type: "application/json" });
    },
    async has(key) {
      return client.exists(at(key));
    },
  };
}

/**
 * Whether an S3 error means "there is nothing there".
 *
 * Read off the shape rather than off the message. Bun raises `S3Error` with a
 * `code` for both a missing key and a refused request, and the two must not be
 * confused: one is an answer and the other is a fault.
 */
function isMissing(e: unknown): boolean {
  if (typeof e !== "object" || e === null) return false;
  const code = (e as { code?: unknown }).code;
  return code === "NoSuchKey" || code === "ENOENT" || code === "NotFound";
}

/**
 * A store that holds what is put in it, for the service's own tests.
 *
 * `api/Dockerfile` runs `bun test api` inside the image build, where there is
 * no credential and there should not be one. Every route is testable against
 * this, and what it does NOT test is the bucket - `bun run e2e:snapshots` is
 * where the real one is read.
 */
export function memoryStore(initial: Record<string, string> = {}): Store & {
  keys(): string[];
} {
  const held = new Map<string, string>(Object.entries(initial));
  return {
    read: async (key) => held.get(key) ?? null,
    write: async (key, body) => void held.set(key, body),
    has: async (key) => held.has(key),
    keys: () => [...held.keys()].sort(),
  };
}
