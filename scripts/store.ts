// A minimal S3 client for the three things this project does: put an object
// with the headers it needs, check whether one exists, and read one back.
//
// Bun's built-in S3Client cannot set Cache-Control at upload, and the cache
// headers here are load-bearing: `units/*` must be immutable so a visitor
// never refetches a file whose name already names its contents, and
// `manifests/*` must be short so a promotion reaches everyone inside the
// propagation window. So the PUT is signed here instead. No SDK, no aws CLI.

const enc = new TextEncoder();

export type StoreConfig = {
  endpoint: string; // https://fly.storage.tigris.dev
  bucket: string;
  region: string; // Tigris uses "auto"
  accessKeyId: string;
  secretAccessKey: string;
};

export function configFromEnv(): StoreConfig {
  const missing: string[] = [];
  const need = (name: string): string => {
    const v = Bun.env[name];
    if (!v) missing.push(name);
    return v ?? "";
  };
  const cfg: StoreConfig = {
    endpoint: Bun.env.AWS_ENDPOINT_URL_S3 ?? "https://fly.storage.tigris.dev",
    bucket: need("BUCKET_NAME"),
    region: Bun.env.AWS_REGION || "auto",
    accessKeyId: need("AWS_ACCESS_KEY_ID"),
    secretAccessKey: need("AWS_SECRET_ACCESS_KEY"),
  };
  if (missing.length) {
    throw new Error(
      `missing ${missing.join(", ")}. Copy .env.example to .env.local and fill it in ` +
        `from \`fly storage create\`.`,
    );
  }
  return cfg;
}

/** The public https origin objects are readable at. */
export function publicOrigin(cfg: StoreConfig): string {
  const host = new URL(cfg.endpoint).host;
  return `https://${cfg.bucket}.${host}`;
}

export function publicUrl(cfg: StoreConfig, key: string): string {
  return `${publicOrigin(cfg)}/${key}`;
}

const hex = (buf: Uint8Array) =>
  Array.from(buf, (b) => b.toString(16).padStart(2, "0")).join("");

const sha256 = (data: Uint8Array | string) =>
  new Bun.CryptoHasher("sha256").update(data).digest("hex");

async function hmac(key: Uint8Array, data: string): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey(
    "raw",
    key as unknown as BufferSource,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, enc.encode(data)));
}

const encodeKey = (key: string) =>
  key.split("/").map(encodeURIComponent).join("/");

async function signedRequest(
  cfg: StoreConfig,
  method: "PUT" | "GET" | "HEAD",
  key: string,
  body: Uint8Array,
  extraHeaders: Record<string, string> = {},
  /** A sub-resource such as "cors". Signed as `name=` with an empty value. */
  subresource?: string,
): Promise<Request> {
  const host = `${cfg.bucket}.${new URL(cfg.endpoint).host}`;
  const path = `/${encodeKey(key)}`;
  const canonicalQuery = subresource ? `${subresource}=` : "";
  const payloadHash = sha256(body);

  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, ""); // 20260826T201402Z
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = {
    host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...Object.fromEntries(
      Object.entries(extraHeaders).map(([k, v]) => [k.toLowerCase(), v]),
    ),
  };

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${headers[n]!.trim()}\n`).join("");
  const signedHeaders = sortedNames.join(";");

  const canonicalRequest = [
    method,
    path,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${dateStamp}/${cfg.region}/s3/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join("\n");

  let signingKey = await hmac(enc.encode(`AWS4${cfg.secretAccessKey}`), dateStamp);
  signingKey = await hmac(signingKey, cfg.region);
  signingKey = await hmac(signingKey, "s3");
  signingKey = await hmac(signingKey, "aws4_request");
  const signature = hex(await hmac(signingKey, stringToSign));

  headers.authorization =
    `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  // `host` is set by fetch itself and must not be passed through.
  delete (headers as Record<string, string | undefined>).host;

  const query = subresource ? `?${subresource}` : "";
  return new Request(`https://${host}${path}${query}`, {
    method,
    headers,
    body: method === "PUT" ? (body as unknown as BodyInit) : undefined,
  });
}

/**
 * Allows a browser to load the build's script.
 *
 * A cross-origin `<script type="module">` is fetched in CORS mode, so without
 * this the bundle is blocked and the page renders empty - while curl, the unit
 * tests and every server-side check stay green. Tigris does not set it by
 * default and flyctl has no flag for it, so it is set here through the S3 API.
 */
export async function putBucketCors(cfg: StoreConfig, origins: string[]): Promise<void> {
  const xml =
    `<CORSConfiguration><CORSRule>` +
    origins.map((o) => `<AllowedOrigin>${o}</AllowedOrigin>`).join("") +
    `<AllowedMethod>GET</AllowedMethod><AllowedMethod>HEAD</AllowedMethod>` +
    `<AllowedHeader>*</AllowedHeader><ExposeHeader>ETag</ExposeHeader>` +
    `<MaxAgeSeconds>3600</MaxAgeSeconds>` +
    `</CORSRule></CORSConfiguration>`;

  const body = new TextEncoder().encode(xml);
  const req = await signedRequest(cfg, "PUT", "", body, {
    "content-type": "application/xml",
  }, "cors");
  const res = await fetch(req);
  if (!res.ok) {
    throw new Error(`PUT ?cors responded ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
}

export type PutOptions = {
  contentType: string;
  cacheControl: string;
  acl?: string;
};

export async function putObject(
  cfg: StoreConfig,
  key: string,
  body: Uint8Array,
  options: PutOptions,
): Promise<void> {
  const req = await signedRequest(cfg, "PUT", key, body, {
    "content-type": options.contentType,
    "cache-control": options.cacheControl,
    "x-amz-acl": options.acl ?? "public-read",
  });
  const res = await fetch(req);
  if (!res.ok) {
    throw new Error(`PUT ${key} responded ${res.status}: ${(await res.text()).slice(0, 400)}`);
  }
}

export async function objectExists(cfg: StoreConfig, key: string): Promise<boolean> {
  const req = await signedRequest(cfg, "HEAD", key, new Uint8Array());
  const res = await fetch(req);
  if (res.status === 404) return false;
  if (!res.ok) throw new Error(`HEAD ${key} responded ${res.status}`);
  return true;
}

export async function getObjectText(cfg: StoreConfig, key: string): Promise<string | null> {
  const req = await signedRequest(cfg, "GET", key, new Uint8Array());
  const res = await fetch(req);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GET ${key} responded ${res.status}`);
  return res.text();
}

export const CACHE_IMMUTABLE = "public, max-age=31536000, immutable";
export const CACHE_POINTER = "public, max-age=5";

export function contentTypeFor(name: string): string {
  if (name.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (name.endsWith(".css")) return "text/css; charset=utf-8";
  if (name.endsWith(".json")) return "application/json; charset=utf-8";
  if (name.endsWith(".map")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

/**
 * Pulls every file a build names into the store's edge cache.
 *
 * Tigris fetches an object into an edge on first request, so the first visitor
 * after a deploy pays for that fill - measured once at over 30 s for a file
 * nobody had asked for. Doing it here makes the deploy responsible for its own
 * readiness instead of the first person through the door.
 *
 * Best effort per file, but the count comes back so the caller can say what it
 * managed.
 */
export async function warmUrls(urls: string[]): Promise<{ warmed: number; failed: string[] }> {
  const failed: string[] = [];
  await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
        if (!res.ok) failed.push(`${url} -> ${res.status}`);
        await res.arrayBuffer();
      } catch (err) {
        failed.push(`${url} -> ${err instanceof Error ? err.message : String(err)}`);
      }
    }),
  );
  return { warmed: urls.length - failed.length, failed };
}

/**
 * Warms, then tries the misses again.
 *
 * Filling several cold edges at once times one of them out often enough to
 * matter: the first publish of the schema 2 fixture lost two files of fifteen
 * that way, and both were there on the next attempt. Retrying is the
 * difference between reporting a fixture as incomplete and reporting it as
 * slow.
 */
export async function warmAll(
  urls: string[],
  attempts = 3,
): Promise<{ warmed: number; failed: string[] }> {
  let pending = urls;
  let failed: string[] = [];
  for (let attempt = 0; attempt < attempts && pending.length > 0; attempt++) {
    failed = (await warmUrls(pending)).failed;
    // warmUrls reports "<url> -> <reason>", and the URL is what to try again.
    pending = failed.map((f) => f.split(" -> ")[0]!);
  }
  return { warmed: urls.length - failed.length, failed };
}

/**
 * Every file a manifest names, as absolute URLs.
 *
 * Schema 3 has one base per unit, which is what lets a channel take its shell
 * from one build and its alpha from another. Schemas 1 and 2 share one base
 * across everything, so they are joined against that instead.
 */
export function urlsInManifest(manifest: unknown): string[] {
  const m = manifest as Record<string, any>;
  const urls: string[] = [];

  const join = (base: string, file: unknown) => {
    if (!file) return;
    urls.push(`${String(base).replace(/\/$/, "")}/${String(file).replace(/^\//, "")}`);
  };

  const unit = (u: Record<string, any> | null | undefined) => {
    if (!u) return;
    join(u.assetBase, u.js);
    join(u.assetBase, u.css);
    for (const file of Object.values(u.imports ?? {})) join(u.assetBase, file);
  };

  if (m.schema === 3) {
    unit(m.shell);
    for (const app of Object.values(m.apps ?? {}) as Array<Record<string, any>>) unit(app);
    return urls;
  }

  const base = String(m.assetBase ?? "");
  if (m.entry) { join(base, m.entry.js); join(base, m.entry.css); }
  if (m.shell) { join(base, m.shell.js); join(base, m.shell.css); }
  for (const file of Object.values(m.imports ?? {})) join(base, file);
  for (const app of Object.values(m.apps ?? {}) as Array<Record<string, string>>) {
    join(base, app.js);
    join(base, app.css);
  }
  return urls;
}
