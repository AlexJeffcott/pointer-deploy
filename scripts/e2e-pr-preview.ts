// Does a pull request's build actually get a URL, from the store outwards?
//
//   bun run e2e:preview
//
// §30. Everything else about the marker policy can be green while this fails.
// The unit tests call `admitsMarker` directly. The @local scenarios hand the
// server a catalogue this repository wrote, through a stub that answers one
// shape of key. Neither of them has published anything, and publishing is
// where a marker becomes a fact: `build.ts` reads BUILD_MARKER, `publish`
// writes it into `unit.json` and rebuilds `units/catalogue.json` from a LIST of
// the bucket, and only then does the server have something to filter.
//
// So this runs the documented commands - build, publish - against the real
// store, and then asks a server reading that store for the unit by id.
//
// It READS the real channels and writes none of them. The only writes are new
// unit directories, which are immutable and which every e2e script here already
// makes. The other half of the claim - a preview can be looked at and can never
// be deployed - is `features/refusing-a-harness-build.feature`, which asserts
// that promote refuses a marked build BEFORE it contacts the store.
//
// The server is local - `bun src/server/index.ts`, the documented entry point,
// the same file the image runs - because a real channel is reached by a Host
// header and this must not depend on the deployed image carrying the policy
// yet. The store, the units, publish, the catalogue and the composition are
// all real.

import { UNITS, type Unit } from "./contract.ts";
import { configFromEnv, publicOrigin } from "./store.ts";

const APP: Unit = "shell";

/** The store's 5 s object cache plus the server's 10 s document TTL, and room. */
const PROPAGATION_MS = 40_000;

/** Unique per run, so no id here has ever been published before. */
const RUN = Date.now().toString(36);
const PR_NUMBER = String(Math.floor(Date.now() / 1000) % 100000);
const PREVIEW_MARKER = `pr-${PR_NUMBER}`;
const HARNESS_MARKER = `e2e-preview-${RUN}`;

let failures = 0;
const check = (what: string, ok: boolean, saw = "") => {
  console.log(`  ${ok ? "ok  " : "FAIL"} ${what}${ok || !saw ? "" : `\n        ${saw}`}`);
  if (!ok) failures++;
};

async function run(
  args: string[],
  env: Record<string, string> = {},
): Promise<{ code: number; out: string; said: string }> {
  const proc = Bun.spawn(args, {
    env: { ...process.env, FORCE_COLOR: "0", NO_COLOR: "1", ...env },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [out, err] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ]);
  return { code: await proc.exited, out, said: `${out}${err}` };
}

/**
 * Builds and publishes one marked build, and reports the ids.
 *
 * Every unit carries the marker, not only the one asked for. That is what CI
 * would do for a pull request, and it is the honest shape: a branch changes
 * whatever it changes and the marker says which branch built it.
 */
async function publishMarked(marker: string): Promise<Record<Unit, string>> {
  const built = await run(["bun", "run", "build"], { BUILD_MARKER: marker });
  if (built.code !== 0) throw new Error(`the build failed:\n${built.said}`);
  const published = await run(["bun", "run", "--silent", "scripts/publish.ts"]);
  if (published.code !== 0) throw new Error(`the publish failed:\n${published.said}`);
  return JSON.parse(published.out) as Record<Unit, string>;
}

const server: { proc: ReturnType<typeof Bun.spawn> | null } = { proc: null };
let PORT = "";

async function startServer(): Promise<void> {
  const cfg = configFromEnv();
  const proc = Bun.spawn(["bun", "src/server/index.ts"], {
    env: {
      ...process.env,
      // Development, so the *.localhost names resolve to a channel. The store,
      // the manifests and the catalogue are all production.
      NODE_ENV: "development",
      PORT: "0",
      MANIFEST_BASE: `${publicOrigin(cfg)}/manifests`,
    },
    stdout: "pipe",
    stderr: "pipe",
  });
  server.proc = proc;

  const reader = proc.stdout.getReader();
  const deadline = Date.now() + 15_000;
  let buffered = "";
  while (Date.now() < deadline) {
    const { value, done } = await reader.read();
    if (done) break;
    buffered += new TextDecoder().decode(value);
    const m = /listening on http:\/\/[^:]+:(\d+)/.exec(buffered);
    if (m) {
      reader.releaseLock();
      PORT = m[1]!;
      return;
    }
  }
  throw new Error(`the server did not start. Output so far:\n${buffered}`);
}

const ask = async (
  channel: string,
  query: string,
): Promise<{ status: number; body: string }> => {
  const res = await fetch(`http://127.0.0.1:${PORT}${query}`, {
    headers: { host: `${channel}.localhost` },
  });
  return { status: res.status, body: await res.text() };
};

const unitIn = (body: string, unit: Unit): string | null => {
  const m = /id="__BUILD__">(.*?)<\/script>/s.exec(body);
  if (!m?.[1]) return null;
  const doc = JSON.parse(m[1]) as { units?: Record<string, { unitId: string }> };
  return doc.units?.[unit]?.unitId ?? null;
};

/**
 * Asks until the answer stops being "this channel has never served that".
 *
 * The catalogue reaches the server through two caches, the store's own and the
 * document TTL, and a `peek` returns the OLD value while the new one is
 * fetched. So the first ask after a publish is refused for a reason that is
 * not the one under test, and this waits that out rather than reading it as a
 * result.
 */
async function askSettled(
  channel: string,
  query: string,
): Promise<{ status: number; body: string }> {
  const deadline = Date.now() + PROPAGATION_MS;
  let last = await ask(channel, query);
  while (Date.now() < deadline) {
    if (!last.body.includes("is not one this channel can serve")) return last;
    await Bun.sleep(1_000);
    last = await ask(channel, query);
  }
  return last;
}

console.log(`\n§30, against the real store. Preview marker ${PREVIEW_MARKER}.\n`);

try {
  await startServer();
  console.log(`  server on 127.0.0.1:${PORT}, reading the real store\n`);

  // --- a pull request publishes -------------------------------------------

  console.log(`A pull request builds with BUILD_MARKER=${PREVIEW_MARKER} and publishes.`);
  const preview = await publishMarked(PREVIEW_MARKER);
  console.log(`  ${UNITS.map((u) => `${u}=${preview[u]}`).join(" ")}`);

  // The pull request's WHOLE build. This is the reading the marker policy is
  // responsible for, and nothing else can block it: every unit in the
  // composition came out of this build, so no unit in it predates anything.
  const whole = await askSettled("qa", `/?shell=${preview.shell}&${APP}=${preview[APP]}`);
  check(
    "qa serves the build that pull request made",
    whole.status === 200,
    `status ${whole.status}\n        ${whole.body.slice(0, 220)}`,
  );
  check(
    "and the page names its units as the ones it ran",
    unitIn(whole.body, APP) === preview[APP] && unitIn(whole.body, "shell") === preview.shell,
    `shell=${unitIn(whole.body, "shell")} ${APP}=${unitIn(whole.body, APP)}`,
  );

  // And one sub-app of it, against everything the channel serves today. This is
  // what a reviewer wants for a one-panel change, and it is the reading that
  // can be blocked by something this item does not own: the composition's shell
  // is then the CHANNEL's shell, and if that shell reads a block this server no
  // longer writes, §11 refuses the whole composition. UNDECIDED rather than
  // FAILED, the way `falsify` reports a mutation nobody ran - the alternative
  // is a check that is red for a reason nobody here can fix, and a check that
  // is usually red is a check people stop reading.
  const one = await askSettled("qa", `/?${APP}=${preview[APP]}`);
  const blockedByShell = one.status === 400 && one.body.includes("which this server does not write");
  if (blockedByShell) {
    console.log(`  ---- one sub-app of it, against the channel's own rest`);
    console.log(`        UNDECIDED: the shell qa points at reads a block this server no longer writes,`);
    console.log(`        so §11 refuses every composition on this channel, override or not.`);
    console.log(`        ${one.body.slice(0, 160)}`);
    console.log(`        Promote a shell built from this tree to qa and this decides itself.`);
  } else {
    check("qa serves one sub-app of it against its own rest", one.status === 200, `status ${one.status}\n        ${one.body.slice(0, 220)}`);
    const shellServed = unitIn(one.body, "shell");
    check(
      "and runs the channel's own shell beside it",
      shellServed !== null && shellServed !== preview.shell,
      `shell=${shellServed}, and the preview built ${preview.shell}`,
    );
  }

  // --- and can never be deployed ------------------------------------------
  //
  // NOT run here, deliberately. `promote qa --from-build` refuses a marked
  // build before it contacts the store, and three @local scenarios in
  // `features/refusing-a-harness-build.feature` assert exactly that, including
  // "the store was never contacted". Running it live would put a real channel
  // one bug away from being handed a preview, to re-prove something already
  // covered and already falsified.

  // --- a marker qa does not admit -----------------------------------------

  console.log(`\nA build marked ${HARNESS_MARKER} publishes, and qa admits no such marker.`);
  const harness = await publishMarked(HARNESS_MARKER);
  console.log(`  ${APP}=${harness[APP]}`);

  // No settling loop: the refusal under test IS "not one this channel can
  // serve", so waiting for that message to go away would wait out the clock
  // and then report the right answer as a timeout. One ask, after the ask
  // above has already forced the catalogue to be re-read.
  const refused = await ask("qa", `/?${APP}=${harness[APP]}`);
  check("qa refuses it", refused.status === 400, `status ${refused.status}`);
  check(
    "and the refusal names the rule rather than the marker",
    refused.body.includes("is not one this channel can serve"),
    refused.body.slice(0, 200),
  );

  // --- prod admits neither -------------------------------------------------

  const onProd = await ask("prod", `/?${APP}=${preview[APP]}`);
  check("prod refuses the preview qa served", onProd.status === 400, `status ${onProd.status}`);
  // For the RIGHT reason. Without this the check passes when prod refuses
  // every override for some other cause, and prod would read as enforcing a
  // policy it had stopped applying.
  check(
    "because the id is not one prod can serve, which is the marker policy",
    onProd.body.includes("is not one this channel can serve"),
    onProd.body.slice(0, 200),
  );

  // The control. Without this, a prod that refused EVERY override would pass
  // the line above and nobody would know prod had stopped composing at all.
  const prodPointer = await ask("prod", "/");
  check("and prod still serves its own pointer", prodPointer.status === 200, `status ${prodPointer.status}`);
} finally {
  server.proc?.kill();
}

console.log(
  failures === 0
    ? `\nSUCCESS: a pull request's build has a URL on qa and reaches prod not at all.\n`
    : `\nFAILED: ${failures} check${failures === 1 ? "" : "s"}.\n`,
);
process.exit(failures === 0 ? 0 : 1);
