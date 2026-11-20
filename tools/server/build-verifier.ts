import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { build } from "esbuild";

import { gameSourceFolders, sourceFingerprints } from "../source-version-plugin.ts";

/**
 * The api's game bundle for this build (phase C, D4.3/D4.4): one Node ESM bundle of
 * `src/app/settlement/server-bundle.ts` (command log verification, offline catch-up) at
 * `dist-verifier/<SOURCE_VERSION>/verifier.mjs`. Uploads and logins name the build that sent them; the api loads
 * the matching bundle (older ones stay beside it, so recent logs of clients that have not updated yet still verify).
 *
 *   npx tsx tools/server/build-verifier.ts [--out dist-verifier]
 */
const client = resolve(import.meta.dirname, "../..");
const workerRepo = resolve(client, process.env.WORKER_REPO ?? "../island-of-settlers-worker-generation");
// The same folders as vite.config.ts (shared package included): the version a browser build reports.
const { sourceVersion } = sourceFingerprints(gameSourceFolders(client, workerRepo));
const outIndex = process.argv.indexOf("--out");
const outRoot = resolve(client, outIndex < 0 ? "dist-verifier" : process.argv[outIndex + 1]!);
const folder = join(outRoot, sourceVersion);
mkdirSync(folder, { recursive: true });
await build({
  bundle: true, entryPoints: [join(client, "src/app/settlement/server-bundle.ts")], format: "esm",
  logLevel: "warning", outfile: join(folder, "verifier.mjs"), platform: "node", target: "node22"
});
writeFileSync(join(outRoot, "latest.json"), JSON.stringify({ sourceVersion }, null, 2));
console.log(`Verifier for ${sourceVersion}: ${join(folder, "verifier.mjs")}`);
