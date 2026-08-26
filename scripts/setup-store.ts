// One-off store configuration. Re-running it is harmless.
//
//   bun run setup:store

import { configFromEnv, putBucketCors } from "./store.ts";

const cfg = configFromEnv();
await putBucketCors(cfg, ["*"]);
console.log(`CORS set on ${cfg.bucket}: GET and HEAD from any origin.`);
