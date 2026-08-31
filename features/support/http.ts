export type Run = { code: number; stdout: string; stderr: string };

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

const CURL_ATTEMPTS = 3;

export async function curlGet(
  url: string,
  host: string,
  extra: Record<string, string> = {},
): Promise<Response> {
  const headers = Object.entries(extra).flatMap(([name, value]) => ["-H", `${name}: ${value}`]);
  const what = `${url} (Host: ${host}${headers.length ? `, ${Object.keys(extra).join(", ")}` : ""})`;
  let last = "";
  for (let attempt = 1; attempt <= CURL_ATTEMPTS; attempt++) {
    const r = await run(["curl", "-sS", "-D", "-", "-o", "-", "-H", `Host: ${host}`, ...headers, url]);
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

  const bodyless = status === 204 || status === 205 || status === 304;
  return new Response(bodyless ? null : raw.slice(cut + 4), { status, headers });
}
