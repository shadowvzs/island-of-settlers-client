import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, it } from "vitest";

import {
  gameSourceFolders, SHARED_SOURCE_FOLDER, sourceFingerprints, type SourceFolders, sourceVersionPlugin
} from "../tools/source-version-plugin";

const folders: string[] = [];
const fixture = () => {
  const folder = mkdtempSync(join(tmpdir(), "settlers-source-version-"));
  folders.push(folder);
  return folder;
};
const put = (root: string, file: string, text: string) => {
  mkdirSync(join(root, file, ".."), { recursive: true });
  writeFileSync(join(root, file), text);
};
/** Minimal game folders: the tested source folder plus empty assets, worker source and worker manifests. */
const gameFolders = (simulation: string[]): SourceFolders => {
  const root = fixture();
  put(root, "assets/a.png", "asset");
  put(root, "worker/src/w.ts", "worker");
  put(root, "worker/game_ready/tripo/manifest.json", JSON.stringify({ props: {}, workers: [] }));
  put(root, "worker/game_ready/armour/manifest.json", JSON.stringify({ sets: [] }));
  put(root, "worker/game_ready/mounts/manifest.json",
    JSON.stringify({ horse: { coat: { mask: "mask.png" }, model: "horse.png" }, riders: [] }));
  for (const file of ["mask.png", "horse.png"]) put(root, `worker/game_ready/mounts/${file}`, file);
  return { assets: join(root, "assets"), simulation,
    workerAssets: join(root, "worker/game_ready"), workerSource: join(root, "worker/src") };
};
const version = async (folder: string) => {
  const load = sourceVersionPlugin(gameFolders([folder])).load;
  if (typeof load !== "function") throw new Error("Missing source-version loader");
  return load.call({} as never, "\0virtual:source-version");
};
afterEach(() => {
  for (const folder of folders.splice(0)) rmSync(folder, { recursive: true });
});

it("invalidates prepared islands after source contents or asset filenames change", async () => {
  const folder = fixture();
  writeFileSync(join(folder, "model.glb"), "original");
  const before = await version(folder);
  writeFileSync(join(folder, "model.glb"), "changed");
  expect(await version(folder)).not.toEqual(before);
  rmSync(join(folder, "model.glb"));
  writeFileSync(join(folder, "other.glb"), "original");
  expect(await version(folder)).not.toEqual(before);
});

it("produces the same version regardless of directory location and creation order", async () => {
  const first = fixture(),
    second = fixture();
  writeFileSync(join(first, "b.ts"), "second");
  writeFileSync(join(first, "a.ts"), "first");
  writeFileSync(join(second, "a.ts"), "first");
  writeFileSync(join(second, "b.ts"), "second");
  expect(await version(first)).toEqual(await version(second));
});

it("fingerprints the shared package source with the client source", () => {
  const folders = gameSourceFolders("/game/island-of-settlers-client", "/game/workers");
  expect(folders.simulation).toEqual(["/game/island-of-settlers-client/src", "/game/island-of-settlers-shared/src"]);
  expect(SHARED_SOURCE_FOLDER).toBe("../island-of-settlers-shared/src");
  const client = fixture(), shared = fixture();
  writeFileSync(join(client, "sim.ts"), "sim");
  writeFileSync(join(shared, "wares.json"), "[]");
  const fixtureFolders = gameFolders([client, shared]);
  const before = sourceFingerprints(fixtureFolders);
  writeFileSync(join(shared, "wares.json"), "[{}]");
  const after = sourceFingerprints(fixtureFolders);
  expect(after.sourceVersion).not.toEqual(before.sourceVersion);
  expect(after.versions.simulation).not.toEqual(before.versions.simulation);
  expect(after.versions.assets).toEqual(before.versions.assets);
});
