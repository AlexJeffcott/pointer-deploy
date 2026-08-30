// Proves the API version gate, §13, against the real store and the DEPLOYED
// service.
//
//   bun run scripts/e2e-api-gate.ts
//
// The claim: a shell calls a version of an API, the service that answers it is
// a separate deploy, and when that deploy stops answering the version the
// origin says so and stops offering the shell.
//
// Nothing in this repository moves while that happens. One variable on another
// Fly app changes, and the answer this origin gives changes with it. That is
// the fourth deploy schedule, and it is the whole point of the item.
//
// It writes to `test-qa` and NEVER to a real channel. It changes API_SERVES on
// `pointer-deploy-api` and puts it back, including after a failure - which is
// what the `finally` is for. While the service answers only v2, a visitor to a
// real channel still gets a page: the channel's own pointer is never refused,
// only an override is, and only the switcher's shell option is greyed out.
// `dist/` is left holding the build this ran.

const CHANNEL = "test-qa";
const APP = "pointer-deploy-api";
const ORIGIN = Bun.env.LIVE_ADDRESS ?? "https://pointer-deploy.fly.dev";
const HOST = `${CHANNEL}.pointer-deploy.test`;
/** The origin caches the discovery document for its own TTL, 10 s deployed. */
const SETTLE_MS = 20_000;

const ok = (claim: string) => console.log(`  ok   ${claim}`);
const failures: string[] = [];
const check = (claim: string, pass: boolean, saw: string) => {
  if (pass) ok(claim);
  else {
    console.log(`  FAIL ${claim} - saw ${saw}`);
    failures.push(claim);
  }
  return pass;
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
 * One request to the channel, through curl.
 *
 * Not `fetch`. test-qa has no name of its own and is reached by a Host header,
 * and a Host that differs from the address makes Bun's TLS verification fail
 * before the request leaves - "unknown certificate verification error",
 * measured on 2026-08-29. curl sends the header and verifies the address, which
 * is what every other live check in this repository already does.
 */
const request = async (path: string): Promise<{ status: number; api: string; body: string }> => {
  const r = await run(["curl", "-sS", "-i", "-H", `Host: ${HOST}`, `${ORIGIN}${path}`]);
  if (r.code !== 0) throw new Error(`curl failed for ${path}:\n${r.said}`);
  const split = r.out.indexOf("\r\n\r\n");
  const head = split === -1 ? r.out : r.out.slice(0, split);
  const body = split === -1 ? "" : r.out.slice(split + 4);
  const status = Number(/^HTTP\/[\d.]+ (\d+)/.exec(head)?.[1] ?? 0);
  const api = /^x-shell-api:\s*(.*)$/im.exec(head)?.[1]?.trim() ?? "absent";
  return { status, api, body };
};

const visit = () => request("/");

/** What the switcher says about one shell id on that page. */
const optionFor = (body: string, unitId: string): { disabled?: boolean } | undefined => {
  const m = /id="__VERSIONS__">(.*?)<\/script>/s.exec(body);
  if (!m) return undefined;
  const doc = JSON.parse(m[1]!) as Record<string, Array<{ unitId: string; disabled?: boolean }>>;
  return doc.shell?.find((o) => o.unitId === unitId);
};

/**
 * Waits for the origin to report a state, because the version document is
 * cached there and a service that has just restarted is not read instantly.
 */
async function until(want: (state: string) => boolean, why: string): Promise<string> {
  const deadline = Date.now() + SETTLE_MS;
  let last = "";
  while (Date.now() < deadline) {
    last = (await visit()).api;
    if (want(last)) return last;
    await Bun.sleep(1_000);
  }
  console.log(`  (waited ${SETTLE_MS} ms for ${why}, last read "${last}")`);
  return last;
}

/**
 * Moves the DEPLOYED service to a different set of versions.
 *
 * Twice, because Fly answered `unauthorized` to a machine update once on
 * 2026-08-29 and again to the restore in the `finally` - which left the live
 * service answering only v2 until somebody set it back by hand. A retry is not
 * a fix for that, so the failure path below prints the command a person runs.
 */
const setServes = async (value: string) => {
  for (const attempt of [1, 2]) {
    const said = await run(["fly", "secrets", "set", `API_SERVES=${value}`, "-a", APP]);
    if (said.code === 0) return;
    console.log(`  attempt ${attempt} to set API_SERVES=${value} failed`);
    if (attempt === 2) {
      throw new Error(
        `could not set API_SERVES=${value}. Put the service back by hand:\n` +
          `  fly secrets set API_SERVES=v1 -a ${APP}\n${said.said}`,
      );
    }
  }
};

let shellId = "";
/** The shell a visitor CHOOSES: in the history, recording v1, and not current. */
let olderShell = "";

try {
  // --- what the service says about itself ----------------------------------

  const versionsUrl = `${(Bun.env.API_BASE ?? "https://pointer-deploy-api.fly.dev").replace(/\/$/, "")}/versions`;
  const doc = await fetch(versionsUrl).then((r) => r.json() as Promise<{ serves?: string[] }>);
  check("the deployed service answers v1", doc.serves?.includes("v1") === true, JSON.stringify(doc));

  // --- a shell that calls it, on a channel ---------------------------------

  console.log(`\n${CHANNEL} - a composition whose shell records the API version it calls`);
  const built = await run(["bun", "run", "build"]);
  if (built.code !== 0) throw new Error(`the build failed:\n${built.said}`);
  await run(["bun", "run", "publish"]);
  const promoted = await run(["bun", "run", "promote", CHANNEL, "--from-build"]);
  if (promoted.code !== 0) throw new Error(`the promote failed:\n${promoted.said}`);
  shellId = (JSON.parse(promoted.out.slice(promoted.out.lastIndexOf("{"))) as Record<string, string>)
    .shell!;
  console.log(`  shell ${shellId}`);

  olderShell = shellId;

  // A second shell, so there is one to CHOOSE. The refusal only applies to an
  // override: a channel's own pointer is never refused, because taking the site
  // down over a control that misbehaves is worse than the bug. Both shells
  // record the same API version, so the only difference between them is which
  // one the channel points at.
  const second = await run(["bun", "run", "build"], { BUILD_MARKER_SHELL: "api-gate-probe" });
  if (second.code !== 0) throw new Error(`the second build failed:\n${second.said}`);
  await run(["bun", "run", "publish"]);
  const again = await run(["bun", "run", "promote", CHANNEL, "--from-build"]);
  if (again.code !== 0) throw new Error(`the second promote failed:\n${again.said}`);
  shellId = (JSON.parse(again.out.slice(again.out.lastIndexOf("{"))) as Record<string, string>).shell!;
  check("a second shell is serving", shellId !== olderShell, `${shellId} === ${olderShell}`);
  console.log(`  now serving ${shellId}, with ${olderShell} in the history`);

  const fed = await until((s) => s === "ok", "the origin to read the service");
  check("the origin reports the shell as one the service can feed", fed === "ok", fed);
  const enabled = optionFor((await visit()).body, shellId);
  check("and the switcher offers it", enabled?.disabled === false, JSON.stringify(enabled));

  // --- the fourth schedule moves, and nothing here does --------------------

  console.log(`\n${APP} stops answering v1. No unit is rebuilt and no image is deployed.`);
  await setServes("v2");
  const refused = await until((s) => s.includes("v1"), "the origin to notice");
  check("the origin names the version the service no longer answers", refused.includes("v1"), refused);
  check("and says which shell asked for it", refused.includes("calls API"), refused);

  const page = await visit();
  check("a visitor still receives the page", page.status === 200, `status ${page.status}`);
  const greyed = optionFor(page.body, shellId);
  check("the switcher no longer lets that shell be chosen", greyed?.disabled === true, JSON.stringify(greyed));
  const greyedOlder = optionFor(page.body, olderShell);
  check("nor the one before it", greyedOlder?.disabled === true, JSON.stringify(greyedOlder));

  // The channel's own pointer is served whatever the service says, and only an
  // override is refused. Both halves are asserted, because a gate that refused
  // the pointer would take the site down over a fourth deploy.
  const chosen = await request(`/?shell=${olderShell}`);
  check("choosing one of them is refused", chosen.status === 400, `status ${chosen.status}`);
  check("and the refusal names the version", chosen.body.includes("v1"), chosen.body.slice(0, 200));

  // --- and back ------------------------------------------------------------

  console.log(`\n${APP} answers v1 again`);
  await setServes("v1");
  const back = await until((s) => s === "ok", "the origin to recover");
  check("the origin serves the shell again", back === "ok", back);
} finally {
  // Loud, and never swallowed. A run that leaves the service answering a
  // version no shell calls has broken the thing it was measuring.
  const served = await fetch(`${(Bun.env.API_BASE ?? "https://pointer-deploy-api.fly.dev").replace(/\/$/, "")}/versions`)
    .then((r) => r.json() as Promise<{ serves?: string[] }>)
    .catch(() => ({ serves: undefined }));
  if (served.serves?.includes("v1")) {
    ok("the service is left answering v1");
  } else {
    await setServes("v1").catch((e: unknown) => {
      console.log(`\n  RESTORE FAILED: ${e instanceof Error ? e.message : String(e)}`);
      failures.push("API_SERVES restored");
    });
  }
}

console.log("");
if (failures.length) {
  console.log(`FAILED: ${failures.length} of the checks above`);
  process.exit(1);
}
console.log("SUCCESS: the API version gate holds against the deployed service");

export {};
