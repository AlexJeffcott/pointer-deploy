// The service, listening. Everything it does is in `service.ts`.

import { SERVES, createState, handle } from "./service.ts";

const PORT = Number(Bun.env.PORT ?? 3100);
const state = createState();

const server = Bun.serve({
  port: PORT,
  hostname: "0.0.0.0",
  fetch: (req) => handle(req, state),
  error(err) {
    console.error(err);
    return new Response("internal server error", { status: 500 });
  },
});

console.log(
  `pointer-deploy-api listening on http://${server.hostname}:${server.port} ` +
    `serves=${SERVES.join(",")}`,
);
