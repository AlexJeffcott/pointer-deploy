// Running a command, and a GET whose Host may differ from the address.
//
// Apart from world.ts so a unit test can reach curlGet without importing a
// module that registers cucumber hooks, opens a browser and reads store
// credentials. Nothing here knows what a channel or a manifest is.

export type Run = { code: number; stdout: string; stderr: string };

/**
 * What a child process is told about colour.
 *
 * Everything this harness spawns is a process whose output it then PARSES -
 * which unit publish uploaded, which port the server bound, what promote
 * refused. Colour makes that output unparseable at the first character:
 * `"\u001b[0m\u001b[31m  alpha ... uploaded"` trims to an escape sequence, and
 * a step reading the first word gets the escape rather than "alpha".
 *
 * It matters because the runner decides it. Playwright sets FORCE_COLOR for its
 * workers, `run` passed process.env straight through, and Bun colours
 * console.error when it sees it - so moving runners silently changed the shape
 * of every command output the suite reads. One assertion broke, because it read
 * by POSITION. The rest read with `includes` and went on passing, which is the
 * worse half of the same fault.
 */
const PLAIN_OUTPUT = { FORCE_COLOR: "0", NO_COLOR: "1" } as const;

export async function run(cmd: string[], env: Record<string, string> = {}): Promise<Run> {
  const proc = Bun.spawn(cmd, {
    env: { ...process.env, ...PLAIN_OUTPUT, ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
}

/** Attempts a request gets when nothing comes back at all. */
const CURL_ATTEMPTS = 3;

/**
 * A GET whose Host may differ from the address it connects to.
 *
 * `-D -` writes the response headers to stdout ahead of the body. Without them
 * the returned Response carries a status and nothing else, and a scenario
 * about a response header - "A shell is never stored by an intermediary" - has
 * nothing to read.
 *
 * A NON-ZERO EXIT IS RETRIED, AND NOTHING ELSE IS. curl runs without `-f`, so
 * it exits 0 for every response the server sends, a 503 included. A non-zero
 * exit therefore means no complete response arrived, which is not a reading of
 * this system at all - and a scenario that fails on it reports the server as
 * misbehaving when nothing was measured. Every assertion downstream is made on
 * a Response, and a Response only exists when curl exited 0, so this cannot
 * retry a behaviour away.
 *
 * The fault it is for: fly.toml sets `auto_stop_machines = "suspend"` over one
 * machine, so a request landing during a resume has its stream dropped -
 * `curl: (16) Error in the HTTP2 framing layer`, or no reply at all.
 *
 * Every retry is printed, beside the propagation budgets. A flake retried in
 * silence reads afterwards as a run that worked first time, which is the
 * reason to have a suite at all.
 */
export async function curlGet(url: string, host: string): Promise<Response> {
  const what = `${url} (Host: ${host})`;
  let last = "";
  for (let attempt = 1; attempt <= CURL_ATTEMPTS; attempt++) {
    const r = await run(["curl", "-sS", "-D", "-", "-o", "-", "-H", `Host: ${host}`, url]);
    if (r.code === 0) {
      if (attempt > 1) console.log(`    curl ${what}: answered on attempt ${attempt}`);
      return responseFromCurl(r.stdout, what);
    }
    last = `exit ${r.code}: ${r.stderr}`;
    console.log(
      `    curl ${what}: no response on attempt ${attempt} of ${CURL_ATTEMPTS} - ${last}`,
    );
    if (attempt < CURL_ATTEMPTS) await Bun.sleep(attempt * 1_000);
  }
  throw new Error(`curl ${what} got no response in ${CURL_ATTEMPTS} attempts, last ${last}`);
}

/** Header block, blank line, body. Header lines end CRLF; the body does not. */
function responseFromCurl(raw: string, what: string): Response {
  const cut = raw.indexOf("\r\n\r\n");
  if (cut === -1) throw new Error(`curl ${what} returned no header block:\n${raw.slice(0, 200)}`);
  const lines = raw.slice(0, cut).split("\r\n");
  const status = Number(/^HTTP\/[\d.]+\s+(\d{3})/.exec(lines[0] ?? "")?.[1]);
  if (!status) {
    throw new Error(`curl ${what} returned no status line: ${JSON.stringify(lines[0] ?? "")}`);
  }

  const headers = new Headers();
  for (const line of lines.slice(1)) {
    const colon = line.indexOf(":");
    if (colon > 0) headers.append(line.slice(0, colon).trim(), line.slice(colon + 1).trim());
  }

  // 204, 205 and 304 may carry no body, and Response throws if given one.
  const bodyless = status === 204 || status === 205 || status === 304;
  return new Response(bodyless ? null : raw.slice(cut + 4), { status, headers });
}
