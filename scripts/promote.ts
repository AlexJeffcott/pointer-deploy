// Points a channel at an already-published build. This is the deploy. It is
// also the rollback: promoting an older build id is the same operation.
//
// No image is built and no machine is restarted. The running servers notice
// within their manifest TTL.

import {
  CACHE_POINTER,
  configFromEnv,
  getObjectText,
  putObject,
  urlsInManifest,
  warmUrls,
} from "./store.ts";

// test-prod and test-qa belong to the live acceptance suite. It runs this
// script rather than a stand-in - a stub could pass while the real promote
// path was broken - so the real script has to accept them.
const CHANNELS = ["prod", "qa", "test-prod", "test-qa"] as const;
type Channel = (typeof CHANNELS)[number];

const [channelArg, buildId] = process.argv.slice(2);
const region = Bun.env.REGION ?? "eu";

if (!channelArg || !buildId) {
  console.error("usage: bun run promote <channel> <buildId>");
  console.error(`       channels: ${CHANNELS.join(", ")}`);
  process.exit(1);
}
if (!CHANNELS.includes(channelArg as Channel)) {
  console.error(`unknown channel ${JSON.stringify(channelArg)}. Expected one of ${CHANNELS.join(", ")}.`);
  process.exit(1);
}

const cfg = configFromEnv();

// The manifest's existence is proof the build finished uploading, because
// publish.ts writes it last. Without this check a channel could point at a
// build whose files are half there, and every visitor would see it.
const manifest = await getObjectText(cfg, `builds/${buildId}/manifest.json`);
if (manifest === null) {
  console.error(
    `build ${buildId} is not published. Nothing was changed; ` +
      `the ${channelArg} channel still points where it did.`,
  );
  process.exit(1);
}

const pointer = `manifests/${region}/${channelArg}.json`;
await putObject(cfg, pointer, new TextEncoder().encode(manifest), {
  contentType: "application/json; charset=utf-8",
  cacheControl: CACHE_POINTER,
});

// A deploy is not finished while the first visitor still has to wait for the
// store to fetch every file from cold. Pass --no-warm to skip it.
if (!process.argv.includes("--no-warm")) {
  const urls = urlsInManifest(JSON.parse(manifest));
  const started = Bun.nanoseconds();
  const { warmed, failed } = await warmUrls(urls);
  const ms = Math.round((Bun.nanoseconds() - started) / 1e6);
  console.error(`  warmed ${warmed}/${urls.length} files in ${ms} ms`);
  for (const f of failed) console.error(`  COLD ${f}`);
}

console.error(`${channelArg} (${region}) now points at build ${buildId}`);
console.log(buildId);
