import { SERVES, handle } from "./service.ts";
import { bucketStore, configFromEnv, memoryStore } from "./store.ts";

const PORT = Number(Bun.env.PORT ?? 3100);

/**
 * The bucket, or memory when no key is set.
 *
 * A deploy with no credential answers every route and keeps nothing past a
 * restart, and it SAYS so on startup. Refusing to start instead would take the
 * discovery document down with it, and `/versions` is what an operator reads
 * to find out what is wrong. `PLAN.md` step 6.
 */
const config = configFromEnv();
const store = config ? bucketStore(config) : memoryStore();

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: (req) => handle(req, store),
  error(err) {
    console.error(err);
    return new Response("internal server error", { status: 500 });
  },
});

console.log(
  `pointer-deploy-api listening on http://${server.hostname}:${server.port} ` +
    `serves=${SERVES.join(",")} ` +
    (config
      ? `bucket=${config.bucket}${config.prefix ? ` prefix=${config.prefix}` : ""}`
      : `bucket=NONE - snapshots are in memory and go when this machine does`),
);
