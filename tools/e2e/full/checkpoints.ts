import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { type GameSaveV1,readGameSave } from "../../../src/shared/settlement/game-save";
import { describeProgressionCheckpoint } from "./progression-manifest";
import { fingerprintSemanticWorld, type SemanticWorldFingerprint } from "./semantic-world";

const sha256 = (bytes: Uint8Array | string) => createHash("sha256").update(bytes).digest("hex");
export interface E2eCheckpoint {
  directory: string;
  gamePath: string;
  mapPath: string;
  manifestPath: string;
  gameSha256: string;
  mapSha256: string;
  seed: number;
  cellsX: number;
  cellsZ: number;
  buildings: number;
  actors: number;
  sourceVersion: string;
  versions: Record<string, string>;
  heightsSha256: string;
  semanticWorld?: SemanticWorldFingerprint;
  progression?: ReturnType<typeof describeProgressionCheckpoint>;
}

import { confirmImport, openMenuAction } from "../../bench/save-helpers";

const fingerprints = (page: Page) => page.evaluate(async () => {
  const source = await import(/* @vite-ignore */ String("/@id/__x00__virtual:source-version"));
  return { sourceVersion: String(source.SOURCE_VERSION), versions: source.SOURCE_VERSIONS as Record<string, string> };
});

/** Load portable artifacts and verify their hashes before giving an isolated browser a baseline. */
export const loadCheckpoint = async (directory: string): Promise<E2eCheckpoint> => {
  const manifestPath = join(directory, "manifest.json");
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.format, "island-settlers-e2e-checkpoint");
  assert([2, 3].includes(manifest.version), "Unsupported checkpoint manifest version");
  assert.deepEqual(manifest.files, { game: "game.json", map: "world.island" });
  const result: E2eCheckpoint = { ...manifest, directory, manifestPath,
    gamePath: join(directory, "game.json"), mapPath: join(directory, "world.island") };
  const gameBytes = await readFile(result.gamePath), mapBytes = await readFile(result.mapPath);
  assert.equal(sha256(gameBytes), result.gameSha256, "Game baseline was changed");
  assert.equal(sha256(mapBytes), result.mapSha256, "Map baseline was changed");
  const game = JSON.parse(gameBytes.toString("utf8"));
  assert.deepEqual(Buffer.from(game.map, "base64"), mapBytes, "Map and save boundaries differ");
  const loaded = await readGameSave(game);
  assert.equal(sha256(new Uint8Array(loaded.map.world.heights.buffer, loaded.map.world.heights.byteOffset,
    loaded.map.world.heights.byteLength)), result.heightsSha256);
  assert.deepEqual({ seed: loaded.map.world.seed, cellsX: loaded.map.world.cellsX, cellsZ: loaded.map.world.cellsZ },
    { seed: result.seed, cellsX: result.cellsX, cellsZ: result.cellsZ });
  const semanticWorld = await fingerprintSemanticWorld(loaded.map.world, {
    buildings: game.settlement.buildings, roads: game.settlement.roads ?? []
  });
  if (manifest.version === 3) assert.deepEqual(manifest.semanticWorld, semanticWorld,
    "Checkpoint semantic world manifest does not match the saved primary world sections");
  result.semanticWorld = semanticWorld;
  if (manifest.progression) assert.deepEqual(manifest.progression, describeProgressionCheckpoint(loaded.map.world, game.settlement), "Checkpoint progression profile differs from saved data");
  return result;
};

/** Export once through the real UI; extract its map rather than taking a later, mismatched snapshot. */
export const writeCheckpoint = async (page: Page, directory: string, name: string): Promise<E2eCheckpoint> => {
  assert(/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,95}$/.test(name), "Checkpoint name must be a safe filename");
  const target = join(directory, name);
  // Exclusive directory creation prevents silently overwriting a baseline used by another lane.
  await mkdir(directory, { recursive: true });
  await mkdir(target);
  const gamePath = join(target, "game.json");
  const mapPath = join(target, "world.island");
  const manifestPath = join(target, "manifest.json");
  const source = await fingerprints(page);
  const exportButton = await openMenuAction(page, "Export game");
  const pending = page.waitForEvent("download", { timeout: 120_000 });
  await exportButton.click();
  const download = await pending;
  await download.saveAs(gamePath);
  assert.deepEqual(await fingerprints(page), source, "Source changed while exporting checkpoint");
  const gameBytes = await readFile(gamePath);
  const game = JSON.parse(gameBytes.toString("utf8")) as GameSaveV1;
  const loaded = await readGameSave(game);
  const mapBytes = Buffer.from(game.map, "base64");
  const map = loaded.map;
  assert.equal(map.world.cellsX, game.settlement.world.cellsX);
  assert.equal(map.world.cellsZ, game.settlement.world.cellsZ);
  await writeFile(mapPath, mapBytes, { flag: "wx" });
  const result: E2eCheckpoint = {
    progression: describeProgressionCheckpoint(map.world, game.settlement),
    semanticWorld: await fingerprintSemanticWorld(map.world, {
      buildings: game.settlement.buildings, roads: game.settlement.roads ?? []
    }),
    ...source, heightsSha256: sha256(new Uint8Array(loaded.map.world.heights.buffer, loaded.map.world.heights.byteOffset,
    loaded.map.world.heights.byteLength)),
    directory: target, gamePath, mapPath, manifestPath,
    gameSha256: sha256(gameBytes), mapSha256: sha256(mapBytes),
    seed: map.world.seed, cellsX: map.world.cellsX, cellsZ: map.world.cellsZ,
    buildings: game.settlement.buildings.length, actors: game.settlement.actors.length
  };
  await writeFile(manifestPath, JSON.stringify({
    format: "island-settlers-e2e-checkpoint", version: 3, name, createdAt: new Date().toISOString(),
    ...source, heightsSha256: result.heightsSha256,
    semanticWorld: result.semanticWorld, progression: result.progression,
    semanticScope: "Primary saved terrain/water/material/ore/prop layers and authored definitions; excludes recomputed " +
      "navigation/lighting/fog/normals. Survey flags are runtime state; cleared stone includes the shared building/road union.",
    gameSha256: result.gameSha256, mapSha256: result.mapSha256,
    seed: result.seed, cellsX: result.cellsX, cellsZ: result.cellsZ,
    buildings: result.buildings, actors: result.actors, savedAt: game.savedAt,
    provenance: "UI Export game; world.island is byte-for-byte decoded from that game's embedded map",
    independentMapExport: false,
    archipelagoIncluded: game.archipelago !== undefined,
    restoreSemantics: "Game preserves actors, progress, runtime and archipelago; standalone map starts a new settlement",
    files: { game: "game.json", map: "world.island" },
    forkRule: "Import game.json into a separate browser context; never mutate checkpoint files"
  }, null, 2), { flag: "wx" });
  return result;
};

/** Exercises the real file chooser/import path. Runtime advancement after reload is not an equality failure. */
export const verifyCheckpoint = async (
  page: Page, checkpoint: E2eCheckpoint, options: { allowSourceMismatch?: boolean } = {}
) => {
  const verified = await loadCheckpoint(checkpoint.directory);
  assert.equal(verified.gameSha256, checkpoint.gameSha256);
  const source = await fingerprints(page);
  if (!options.allowSourceMismatch) assert.equal(source.sourceVersion, checkpoint.sourceVersion,
    "Source fingerprint differs; set allowSourceMismatch explicitly for migration investigation");
  const gameBytes = await readFile(checkpoint.gamePath);
  const mapBytes = await readFile(checkpoint.mapPath);
  assert.equal(sha256(gameBytes), checkpoint.gameSha256, "Game baseline was changed");
  assert.equal(sha256(mapBytes), checkpoint.mapSha256, "Map baseline was changed");
  const game = JSON.parse(gameBytes.toString("utf8")) as GameSaveV1;
  assert.deepEqual(Buffer.from(game.map, "base64"), mapBytes, "Map and save boundaries differ");
  const importButton = await openMenuAction(page, "Import game");
  const chooser = page.waitForEvent("filechooser");
  const reload = page.waitForEvent("framenavigated", {
    predicate: frame => frame === page.mainFrame(), timeout: 120_000
  });
  await importButton.click();
  await (await chooser).setFiles(checkpoint.gamePath);
  await confirmImport(page);
  await reload;
  await page.waitForFunction(() => (window as any).__islandReady === true, undefined, { timeout: 120_000 });
  assert.deepEqual(await fingerprints(page), source, "Loaded source changed during checkpoint import");
  const semanticRestored = await page.evaluate(() => (window as any).__fullWorldRestoreBoundary);
  assert(semanticRestored, "Immutable semantic restore boundary is missing");
  const expectedSemantic = verified.semanticWorld;
  assert(expectedSemantic, "Verified checkpoint semantic fingerprint is missing");
  const differingSections = expectedSemantic.sections.filter(section =>
    !semanticRestored.sections?.some((entry: any) => entry.name === section.name && entry.sha256 === section.sha256 &&
      entry.bytes === section.bytes)).map(section => section.name);
  assert.deepEqual(semanticRestored, expectedSemantic,
    `Primary world changed at restore; differing sections: ${differingSections.join(", ")}`);
  const restored = await page.evaluate(() => (window as any).__fullWorldRestoreIdentity);
  assert.deepEqual(restored, { seed: checkpoint.seed, cellsX: checkpoint.cellsX, cellsZ: checkpoint.cellsZ });
  assert.equal(semanticRestored.sections.find(section => section.name === "heights")?.sha256,
    checkpoint.heightsSha256, "Heights changed at the immutable restore boundary");
  return { imported: true, hashesVerified: true, identityVerified: true, terrainVerified: true,
    semanticWorldVerified: true, semanticWorldSha256: semanticRestored.sha256,
    sourceMatches: source.sourceVersion === checkpoint.sourceVersion };
};
