// The retry in curlGet, held by a server that drops connections on purpose.
//
// Not in features/support itself: cucumber.mjs imports `features/support/*.ts`
// as support code, and a file calling test() at import time would run inside
// every cucumber run. One directory down is outside that glob.

import { expect, test } from "bun:test";
import { curlGet } from "../http.ts";

/**
 * A server that accepts the first `drops` connections and answers none of them.
 *
 * This is what a resume from suspend looks like to curl: the connection is
 * accepted, then goes away with no reply, and curl exits non-zero holding no
 * response at all. Closing the socket without writing reproduces it exactly,
 * and does it in milliseconds rather than by waiting for a real machine to
 * suspend.
 */
function droppingServer(drops: number) {
  let connections = 0;
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {
        connections++;
      },
      data(socket) {
        if (connections <= drops) {
          socket.end();
          return;
        }
        socket.end("HTTP/1.1 200 OK\r\ncontent-type: text/plain\r\ncontent-length: 2\r\n\r\nok");
      },
    },
  });
  return {
    url: `http://127.0.0.1:${server.port}/`,
    connections: () => connections,
    stop: () => server.stop(true),
  };
}

/** Runs fn with console.log captured, and always puts console.log back. */
async function withLog<T>(fn: () => Promise<T>): Promise<{ result: T; lines: string[] }> {
  const lines: string[] = [];
  const original = console.log;
  console.log = (...args: unknown[]) => void lines.push(args.join(" "));
  try {
    return { result: await fn(), lines };
  } finally {
    console.log = original;
  }
}

test(
  "a dropped connection is tried again, and the retry is announced",
  async () => {
    const s = droppingServer(1);
    try {
      const { result, lines } = await withLog(() => curlGet(s.url, "test-qa.pointer-deploy.test"));
      expect(result.status).toBe(200);
      expect(await result.text()).toBe("ok");
      expect(s.connections()).toBe(2);
      // A flake retried in silence reads afterwards as a run that worked first
      // time, which is the reason to have a suite at all.
      expect(lines.join("\n")).toContain("no response on attempt 1 of 3");
      expect(lines.join("\n")).toContain("answered on attempt 2");
    } finally {
      s.stop();
    }
  },
  20_000,
);

test(
  "a server that never answers fails the scenario, and says how often it was asked",
  async () => {
    const s = droppingServer(Number.MAX_SAFE_INTEGER);
    try {
      const { lines } = await withLog(async () => {
        await expect(curlGet(s.url, "test-qa.pointer-deploy.test")).rejects.toThrow(
          "got no response in 3 attempts",
        );
      });
      expect(s.connections()).toBe(3);
      expect(lines.join("\n")).toContain("no response on attempt 3 of 3");
    } finally {
      s.stop();
    }
  },
  20_000,
);

// The half that must NOT be retried. curl runs without -f, so a 503 is a
// response and exits 0 - and a suite that retried it would turn a server
// refusing to serve into a server that took a few goes.
test("a response is returned whatever its status, and asked for once", async () => {
  let connections = 0;
  const server = Bun.listen({
    hostname: "127.0.0.1",
    port: 0,
    socket: {
      open() {
        connections++;
      },
      data(socket) {
        socket.end("HTTP/1.1 503 Service Unavailable\r\ncontent-length: 4\r\n\r\nnope");
      },
    },
  });
  try {
    const res = await curlGet(`http://127.0.0.1:${server.port}/`, "test-qa.pointer-deploy.test");
    expect(res.status).toBe(503);
    expect(connections).toBe(1);
  } finally {
    server.stop(true);
  }
});
