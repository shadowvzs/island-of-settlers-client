import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { fromSaveSnapshot, toSaveSnapshot } from "../src/app/save-store/save-snapshot";
import * as client from "../src/app/settlement/server-bundle";
import type { GameSaveV1 } from "../src/shared/settlement/game-save";
import { canonicalJson, hashText } from "../src/shared/settlement/settlement-state-hash";
import { aiIslandSave, CATCH_UP_MODES } from "./helpers/ai-island-save";
import { CLIENT_ROOT } from "./helpers/server-bundle-graph";

type ServerBundle = typeof client;

const AWAY_MS = 120_000;
const TIMEOUT = 600_000;

let folder = "";
let server: ServerBundle;

/** The api's game bundle of this source, built like `tools/server/build-verifier.ts` into a temp folder. */
beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "catch-up-two-path-"));
  const outfile = join(folder, "verifier.mjs");
  await build({ absWorkingDir: CLIENT_ROOT, bundle: true, entryPoints: ["src/app/settlement/server-bundle.ts"],
    format: "esm", logLevel: "warning", outfile, platform: "node", target: "node22" });
  server = await import(pathToFileURL(outfile).href) as ServerBundle;
}, TIMEOUT);

afterAll(() => { if (folder) rmSync(folder, { force: true, recursive: true }); });

const caughtUp = async (bundle: ServerBundle, source: GameSaveV1, options: (typeof CATCH_UP_MODES)[number][1]) => {
  const result = await bundle.catchUpSnapshot(toSaveSnapshot(structuredClone(source)), source.savedAt + AWAY_MS,
    options);
  expect(result).not.toBeNull();
  return fromSaveSnapshot(result!.snapshot)!;
};

/** EAI5b gate: an island with an AI economy catches up to the same state in the client and in the server bundle. */
describe("offline catch-up of an AI island: client = server bundle", () => {
  it("gives the same settlement hash in every catch-up mode, with the AI frozen", async () => {
    const source = await aiIslandSave(true);
    for (const [name, options] of CATCH_UP_MODES) {
      const [local, remote] = [await caughtUp(client, source, options), await caughtUp(server, source, options)];
      expect(hashText(canonicalJson(remote.settlement)), name).toBe(hashText(canonicalJson(local.settlement)));
      expect(local.settlement.factionAi, `${name}: AI state frozen`).toEqual(source.settlement.factionAi);
    }
  }, TIMEOUT);
});
