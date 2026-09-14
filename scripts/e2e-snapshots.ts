// Does a planner really reach a bucket, and come back? `PLAN.md` step 6.
//
//   bun run e2e:snapshots
//
// The claim this exists to falsify: the service holds nothing of its own, the
// BUCKET holds the snapshots, and the key it holds cannot reach the bucket the
// origin executes from. Every other check in the repository can be green while
// that is false. `api/service.test.ts` runs against `memoryStore`, because
// `api/Dockerfile` runs those tests inside the image build where there is no
// credential and there should not be one; the @local scenarios spawn a service
// with no credential for the same reason. So nothing else in this tree has ever
// written a byte to Tigris through the service.
//
// It drives the DEPLOYED service, which is the entry point a browser uses, and
// it takes every reading from outside: a push, a read at the address it was
// given, a second push of the same bytes, and two attempts to reach the object
// from the public asset origin. `~/projects/CLAUDE.md` asks for the artefact to
// be committed next to the feature and runnable in one command.
//
// What it WRITES is one snapshot per run, at the address of its own bytes. A
// snapshot is immutable and permanent, so a run cannot change what any other
// reader sees - which is the difference from the greeting this replaced, where
// every write changed the value the next visitor read. The body carries a
// marker so a later sweep can find what these runs left.

// A module, so that top-level `await` is allowed. Nothing here is imported by
// anything: this is a command, and the export is the declaration that makes it
// one.
export {};

const SERVICE = (Bun.env.API_BASE ?? "https://pointer-deploy-api.fly.dev").replace(/\/$/, "");
const ASSETS = (Bun.env.ASSET_BASE ?? "https://pointer-deploy-assets.fly.storage.tigris.dev")
  .replace(/\/$/, "");
const RUN = new Date().toISOString();

const failures: string[] = [];
let step = 0;
const heading = (text: string): void => console.log(`\n${++step}. ${text}`);
const check = (what: string, ok: boolean, detail = ""): boolean => {
  if (ok) console.log(`  ok   ${what}`);
  else {
    console.log(`  FAIL ${what}${detail ? `\n         ${detail}` : ""}`);
    failures.push(what);
  }
  return ok;
};

/**
 * A planner whose bytes are different on every run.
 *
 * Deliberately not a fixed document. A fixed one would already be in the bucket
 * after the first run, so `the service kept it` would pass without a write ever
 * happening again - the check would be measuring the first run forever.
 */
const planner = {
  format: "pointer-planner",
  schemaVersion: 1,
  exportedAt: RUN,
  tasks: [
    {
      id: `e2e-snapshots-${RUN}`,
      title: "Book the ferry",
      column: "todo",
      due: null,
      tags: ["e2e:snapshots"],
      createdAt: RUN,
    },
  ],
};

const json = async (res: Response): Promise<Record<string, unknown>> =>
  res.headers.get("content-type")?.includes("json")
    ? ((await res.json()) as Record<string, unknown>)
    : {};

heading(`The deployed service answers the version this shell calls: ${SERVICE}`);
const root = await fetch(`${SERVICE}/v1`);
check("GET /v1 answers", root.status === 200, `${root.status}`);
const rootBody = await json(root);
check(
  "and names the snapshot route",
  JSON.stringify(rootBody.routes ?? []).includes('"/v1/snapshots"'),
  JSON.stringify(rootBody.routes),
);
// The whole reason this route exists: a version this deploy does not serve has
// to answer differently, or a page learns nothing from asking.
check("a version it does not serve is 404", (await fetch(`${SERVICE}/v2`)).status === 404);

heading("A planner goes into the bucket, and the address is the hash of its bytes");
const body = JSON.stringify(planner);
const pushed = await fetch(`${SERVICE}/v1/snapshots`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});
const said = await json(pushed);
const address = typeof said.snapshot === "string" ? said.snapshot : "";
check("the service kept it", pushed.status === 201, `${pushed.status} ${JSON.stringify(said)}`);
check("and answered with an address", /^[0-9a-f]{64}$/.test(address), address);
const expected = new Bun.CryptoHasher("sha256").update(body).digest("hex");
check("which is the sha256 of the bytes that were sent", address === expected, `${address}`);

heading("It comes back out at that address, through a second request");
const back = await fetch(`${SERVICE}/v1/snapshots/${address}`);
const held = await json(back);
check("the address reads", back.status === 200, `${back.status}`);
check(
  "and holds the task that was pushed",
  JSON.stringify(held.tasks) === JSON.stringify(planner.tasks),
  JSON.stringify(held.tasks),
);
// The two fields the shell's pull door reads before it writes anything.
check("it carries the format the push declared", held.format === "pointer-planner", `${held.format}`);
check("and the schema version", held.schemaVersion === 1, `${held.schemaVersion}`);

heading("The same bytes are the same address, and cost one object");
const again = await fetch(`${SERVICE}/v1/snapshots`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body,
});
check("a second push answers with the address of the first", (await json(again)).snapshot === address);

heading("The snapshot is NOT in the bucket the origin executes from");
// The security argument of the whole step, measured from outside rather than
// inferred from there being two keys. `bun run verify:keys` measures the other
// half: that the key this service holds is refused a write to that bucket.
for (const path of [`snapshots/${address}.json`, `${address}.json`]) {
  const reachable = await fetch(`${ASSETS}/${path}`);
  check(
    `the public asset origin does not serve ${path}`,
    reachable.status === 404 || reachable.status === 403,
    `${reachable.status}`,
  );
}

heading("What the service will not take, and will not look up");
check(
  "a body that is not a JSON object is refused",
  (
    await fetch(`${SERVICE}/v1/snapshots`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "[1]",
    })
  ).status === 400,
);
check(
  "an address that is not a sha256 is refused by shape",
  (await fetch(`${SERVICE}/v1/snapshots/latest`)).status === 400,
);
check(
  "an address nothing was pushed to is not found",
  (await fetch(`${SERVICE}/v1/snapshots/${"0".repeat(64)}`)).status === 404,
);

heading("A slot, and the two capabilities over it");
// The doors for these arrive at `PLAN.md` step 7. The ROUTES are deployed now,
// so they are measured now: a live route nothing has read is a route nobody
// knows the shape of.
const minted = await json(await fetch(`${SERVICE}/v1/slots`, { method: "POST" }));
const slot = typeof minted.slot === "string" ? minted.slot : "";
const writeKey = typeof minted.writeKey === "string" ? minted.writeKey : "";
check("a slot is minted with an id and a write key", slot !== "" && writeKey !== "");

const moved = await fetch(`${SERVICE}/v1/slots/${slot}`, {
  method: "PUT",
  headers: { "content-type": "application/json", "x-write-key": writeKey },
  body: JSON.stringify({ snapshot: address }),
});
check("the write key moves the slot", moved.status === 200, `${moved.status}`);

const read = await json(await fetch(`${SERVICE}/v1/slots/${slot}`));
check("the id alone reads the slot", read.snapshot === address, JSON.stringify(read));
// Holding the id grants read and nothing else. A slot file carrying its own
// write key would hand the move to every reader and collapse the two
// capabilities into one.
check("and the slot it reads carries no write key", !("writeKey" in read) && !("writeKeyHash" in read));

const refused = await fetch(`${SERVICE}/v1/slots/${slot}`, {
  method: "PUT",
  headers: { "content-type": "application/json", "x-write-key": "not-the-key" },
  body: JSON.stringify({ snapshot: address }),
});
// 403 and not 404. The id already granted the read, so pretending the slot is
// missing would tell its holder something false about their own slot.
check("a wrong write key is refused with 403", refused.status === 403, `${refused.status}`);

console.log(
  failures.length === 0
    ? `\nAll checks passed. ${step} steps. Snapshot ${address}`
    : `\n${failures.length} FAILED:\n${failures.map((f) => `  ${f}`).join("\n")}`,
);
process.exit(failures.length === 0 ? 0 : 1);
