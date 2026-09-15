// What the snapshot bucket's key can reach, and what it cannot.
//
//   bun run verify:keys
//
// `PLAN.md` step 6 puts a bucket key in the SERVICE, and its whole security
// argument is that the key is not the one that can write the files the origin
// executes: "a service that held it would turn a service compromise into an
// origin compromise". TODO §4 says the same thing from the CI side.
//
// That `fly storage create` issues a key pair per bucket does not measure it.
// A second key pair that happened to carry org-wide permission would satisfy
// "two keys" and defeat the reason for two. This is the reading.
//
// THE CONTROL IS THE POINT, on the read. `pointer-deploy-assets` is public
// because browsers fetch unit files from it, so an unsigned GET returns the
// object to anyone. A signed read succeeding says nothing the control does not
// already give, and this script prints both rather than quoting the signed one
// as though it meant something. What discriminates is the WRITE and the
// DELETE, which no public bucket grants to a stranger.
//
// It writes one object to the snapshot bucket and deletes it. It attempts a
// write to the asset bucket that must be refused; if that attempt ever
// SUCCEEDS the object is removed again immediately and the script fails.

import {
  CACHE_POINTER,
  deleteObject,
  getObjectText,
  publicUrl,
  putObject,
  type StoreConfig,
} from "./store.ts";

/** The asset bucket key's own name for a thing, and the snapshot key's. */
const ASSET_BUCKET = Bun.env.BUCKET_NAME ?? "pointer-deploy-assets";
/** A key the asset bucket holds, for the read control. Any public one does. */
const ASSET_OBJECT = "manifests/eu/qa.json";

const need = (name: string): string => {
  const v = Bun.env[name];
  if (!v) {
    console.error(
      `missing ${name}. The snapshot bucket's key goes in .env.local under the DATA_ names; ` +
        `\`fly storage create\` prints them and .env.example lists them.`,
    );
    process.exit(1);
  }
  return v;
};

const snapshots: StoreConfig = {
  endpoint: Bun.env.AWS_ENDPOINT_URL_S3 ?? "https://fly.storage.tigris.dev",
  bucket: need("DATA_BUCKET_NAME"),
  region: Bun.env.DATA_AWS_REGION || "auto",
  accessKeyId: need("DATA_AWS_ACCESS_KEY_ID"),
  secretAccessKey: need("DATA_AWS_SECRET_ACCESS_KEY"),
};
/** The same key, aimed at the bucket it must not be able to write. */
const atAssets: StoreConfig = { ...snapshots, bucket: ASSET_BUCKET };

if (snapshots.bucket === ASSET_BUCKET) {
  console.error(
    `DATA_BUCKET_NAME and BUCKET_NAME are both ${ASSET_BUCKET}. There is one bucket here, ` +
      `so there is nothing to measure and step 6's argument does not hold.`,
  );
  process.exit(1);
}

const results: boolean[] = [];
const check = (ok: boolean, said: string) => {
  results.push(ok);
  console.error(`  ${ok ? "ok  " : "FAIL"}   ${said}`);
};
const bytes = (s: string) => new TextEncoder().encode(s);
const why = (e: unknown) => (e instanceof Error ? e.message.replace(/\s+/g, " ").slice(0, 110) : String(e));

console.error(`the snapshot key is for ${snapshots.bucket}; aiming it at ${ASSET_BUCKET}\n`);

// Its own bucket. If this fails nothing below means anything.
const probe = `scope-probe-${Date.now()}.json`;
try {
  await putObject(snapshots, probe, bytes('{"probe":true}'), {
    contentType: "application/json",
    cacheControl: CACHE_POINTER,
    acl: "private",
  });
  const back = await getObjectText(snapshots, probe);
  check(back === '{"probe":true}', `the key writes ${snapshots.bucket} and reads back what it wrote`);
  await deleteObject(snapshots, probe);
} catch (e) {
  check(false, `the key cannot use its own bucket: ${why(e)}`);
}

// The read control, and then the read. Printed together on purpose.
let publicBytes = 0;
try {
  const res = await fetch(publicUrl(atAssets, ASSET_OBJECT));
  publicBytes = res.ok ? (await res.text()).length : 0;
} catch {
  publicBytes = 0;
}
check(publicBytes > 0, `unsigned, ${ASSET_OBJECT} reads ${publicBytes} bytes - ${ASSET_BUCKET} is public`);
try {
  const text = await getObjectText(atAssets, ASSET_OBJECT);
  check(true, `signed with the snapshot key it reads ${text?.length ?? 0} bytes, which the control already gives`);
} catch (e) {
  check(true, `signed with the snapshot key the read is refused: ${why(e)}`);
}

// The one that matters.
const intruder = `scope-probe-DO-NOT-SERVE-${Date.now()}.json`;
try {
  await putObject(atAssets, intruder, bytes('{"probe":true}'), {
    contentType: "application/json",
    cacheControl: CACHE_POINTER,
    acl: "private",
  });
  check(false, `WRITING ${intruder} to ${ASSET_BUCKET} SUCCEEDED. The key is not scoped`);
  await deleteObject(atAssets, intruder).catch(() => {});
} catch (e) {
  check(true, `writing to ${ASSET_BUCKET} is refused: ${why(e)}`);
}

try {
  await deleteObject(atAssets, "manifests/eu/does-not-exist.json");
  check(false, `DELETE against ${ASSET_BUCKET} was accepted. The key is not scoped`);
} catch (e) {
  check(true, `deleting from ${ASSET_BUCKET} is refused: ${why(e)}`);
}

console.error("");
if (!results.every(Boolean)) {
  console.error(
    `NOT SCOPED: the snapshot key reaches ${ASSET_BUCKET}. A service holding it turns a ` +
      `service compromise into an origin compromise, which is the one thing PLAN.md step 6 ` +
      `says the second bucket exists to prevent.`,
  );
  process.exit(1);
}
console.error(
  `SCOPED: ${results.length} readings held. The key uses ${snapshots.bucket} and cannot write ` +
    `or delete in ${ASSET_BUCKET}. The READ is not scoped and cannot be - that bucket is ` +
    `public by design, which the control above says rather than leaving implied.`,
);
