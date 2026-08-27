// Does resuming a suspended machine leave the origin serving a composition the
// store has already replaced, and does its clock come back behind?
//
// The unrun half of TODO item 7. Everything else about that failure has been
// measured: the store answers with the new bytes in under half a second, from
// here and from inside the machine, and the origin follows a pointer within
// its own TTL over twenty consecutive rewrites. What has never been measured
// is the one state the suite cannot arrange for itself - a machine that was
// asleep while the pointer moved.
//
// The mechanism it is for, now guarded in src/server/manifest.ts: the TTL check
// is a subtraction over a WALL clock. A guest resumed from a snapshot can come
// back behind the world, `now() - checkedAt` is then negative, and a negative
// age is smaller than any TTL - so the entry reads as fresh, no refresh is ever
// attempted, and the origin serves a superseded composition with not one failed
// request to show for it.
//
//   I_WILL_SUSPEND=1 bun run scripts/probe-resume-skew.ts
//
// It SUSPENDS the machine the application is served from, so it asks first. No
// unit moves and no channel is promoted: only `shell.marker` changes, which the
// server renders into __BUILD__ and nothing fetches, and the original bytes go
// back at the end. Read it as an operator action, not as a test.
//
// Two readings come out of it, and they are independent:
//
// Read the first answer after the resume as well, and it is printed for that
// reason: if it names the OLD marker, the process survived the suspension with
// its cache intact and the staleness below is a real reading. If it names the
// new one, the machine was stopped and started rather than suspended, the cache
// came back empty, and the run measured a cold read instead.
//
//   staleness  how long the origin served the old composition after the resume.
//              Anything far past MANIFEST_TTL_MS is the fault this is for.
//   skew       how far the guest's clock falls OUTSIDE the round trip that read
//              it. Zero means the clock is correct to the resolution below.

import { CACHE_POINTER, configFromEnv, getObjectText, putObject } from "./store.ts";

const CHANNEL = Bun.env.PROBE_CHANNEL ?? "test-qa";
const HOST = Bun.env.PROBE_HOST ?? "test-qa.pointer-deploy.test";
const ADDRESS = Bun.env.LIVE_ADDRESS ?? "https://pointer-deploy.fly.dev";
const REGION = Bun.env.REGION ?? "eu";
const ASLEEP_MS = Number(Bun.env.PROBE_ASLEEP_MS ?? 90_000);
const BUDGET_MS = Number(Bun.env.PROBE_BUDGET_MS ?? 180_000);

// The suite's own channels only. Rewriting a pointer IS a deploy however it is
// done, and this one rewrites it while the machine cannot answer.
if (!CHANNEL.startsWith("test-")) {
  console.error(`refusing: ${CHANNEL} is a real channel. This probe writes the pointer it names.`);
  process.exit(1);
}
if (Bun.env.I_WILL_SUSPEND !== "1") {
  console.error("This suspends the machine the application is served from.");
  console.error("Run it as: I_WILL_SUSPEND=1 bun run scripts/probe-resume-skew.ts");
  process.exit(1);
}

const run = async (cmd: string[]): Promise<{ code: number; stdout: string; stderr: string }> => {
  const proc = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, stdout: stdout.trim(), stderr: stderr.trim() };
};

/** curl, because the channel is selected by a Host that differs from the address. */
const get = async (): Promise<string> => {
  const r = await run(["curl", "-sS", "-H", `Host: ${HOST}`, `${ADDRESS}/`]);
  return r.code === 0 ? r.stdout : "";
};

const markerOf = (html: string): string | null => {
  const m = /id="__BUILD__">(.*?)<\/script>/s.exec(html);
  if (!m?.[1]) return null;
  try {
    return (JSON.parse(m[1]) as { units?: Record<string, { marker: string }> }).units?.shell?.marker ?? null;
  } catch {
    return null;
  }
};

const log = (s: string) => console.error(`${new Date().toISOString()} ${s}`);

const cfg = configFromEnv();
const key = `manifests/${REGION}/${CHANNEL}.json`;
const original = await getObjectText(cfg, key);
if (original === null) {
  console.error(`${key} does not exist. This probe replaces a pointer, never invents one.`);
  process.exit(1);
}

const write = async (marker: string): Promise<void> => {
  const doc = JSON.parse(original) as Record<string, unknown> & {
    shell: { marker: string };
    composedAt: string;
  };
  doc.shell.marker = marker;
  doc.composedAt = new Date().toISOString();
  await putObject(cfg, key, new TextEncoder().encode(`${JSON.stringify(doc, null, 2)}\n`), {
    contentType: "application/json; charset=utf-8",
    cacheControl: CACHE_POINTER,
  });
};

const list = await run(["fly", "machine", "list", "--json"]);
if (list.code !== 0) {
  console.error(`fly machine list failed:\n${list.stderr}`);
  process.exit(1);
}
const machines = (JSON.parse(list.stdout) as Array<{ id: string; region: string }>).map((m) => m.id);
if (machines.length !== 1) {
  console.error(`expected one machine, found ${machines.length}. Name one and rerun.`);
  process.exit(1);
}
const machine = machines[0]!;

let staleMs = -1;
let skewMs = Number.NaN;
/** The width of the round trip the clock was read across. The resolution. */
let bracketMs = Number.NaN;
try {
  // 1. A cached entry for the origin to go stale on. Without this the resumed
  //    server reads the store from cold and the probe measures nothing.
  const before = `resume-before-${Date.now().toString(36)}`;
  await write(before);
  const seeded = Date.now();
  let seen: string | null = null;
  while (Date.now() - seeded < 60_000) {
    seen = markerOf(await get());
    if (seen === before) break;
    await Bun.sleep(500);
  }
  if (seen !== before) {
    console.error(`the origin never took ${before}; it holds ${JSON.stringify(seen)}. Nothing measured.`);
    process.exit(1);
  }
  log(`the origin holds ${before}`);

  // 2. Asleep, with real time passing and the process frozen.
  const suspended = await run(["fly", "machine", "suspend", machine]);
  if (suspended.code !== 0) {
    console.error(`fly machine suspend failed:\n${suspended.stderr}`);
    process.exit(1);
  }
  log(`suspended ${machine}, sleeping ${Math.round(ASLEEP_MS / 1000)} s`);
  await Bun.sleep(ASLEEP_MS);

  // 3. The pointer moves while it cannot see it.
  const after = `resume-after-${Date.now().toString(36)}`;
  await write(after);
  const wrote = Date.now();
  log(`wrote ${after} while the machine was asleep`);

  // 4. The first request resumes it. Then: how long does it serve the old one?
  let first = true;
  while (Date.now() - wrote < BUDGET_MS) {
    const marker = markerOf(await get());
    if (first) {
      log(`first answer after the resume: ${JSON.stringify(marker)} at +${Date.now() - wrote} ms`);
      first = false;
    }
    if (marker === after) {
      staleMs = Date.now() - wrote;
      break;
    }
    await Bun.sleep(1_000);
  }

  // 5. The guest's clock, bracketed by the round trip that read it.
  //
  // `fly ssh console` takes seconds - connect, then start bun - so a bare
  // subtraction measures the command and not the clock. Measured here, an
  // awake machine reads 2802 to 4742 ms of round trip with its clock landing
  // 136 to 273 ms before the end of it. A correct clock lands ANYWHERE inside
  // the interval, so only a value outside it is skew, and only by how far
  // outside. The resolution is the width of the bracket, which is reported
  // beside the number: a skew smaller than that cannot be seen this way, and a
  // skew that matters here is the length of the suspension.
  const readStart = Date.now();
  const guest = await run(["fly", "ssh", "console", "-C", 'bun -e "console.log(Date.now())"']);
  const readEnd = Date.now();
  const value = Number(guest.stdout.trim().split("\n").pop());
  if (Number.isFinite(value)) {
    bracketMs = readEnd - readStart;
    skewMs = value < readStart ? value - readStart : value > readEnd ? value - readEnd : 0;
  }
} finally {
  await putObject(cfg, key, new TextEncoder().encode(original), {
    contentType: "application/json; charset=utf-8",
    cacheControl: CACHE_POINTER,
  });
  log("pointer restored");
}

const ttlMs = Number(Bun.env.MANIFEST_TTL_MS ?? 10_000);
console.log(
  `\nstaleness  ${staleMs < 0 ? `over ${BUDGET_MS} ms and still behind` : `${staleMs} ms`}` +
    ` (the server's TTL is ${ttlMs} ms)\n` +
    `skew       ${Number.isFinite(skewMs) ? `${skewMs} ms` : "could not be read"}` +
    ` (outside a ${Number.isFinite(bracketMs) ? bracketMs : "?"} ms round trip, which is the resolution)`,
);

// A run that measured nothing must not read as a run that found nothing.
if (staleMs < 0) process.exit(1);
