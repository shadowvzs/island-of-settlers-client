import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { readMapFile } from "../../src/shared/world/save/map-reader";
import { writeMapFile } from "../../src/shared/world/save/map-writer";
import { digestWorld } from "./map-editor-terrain-probe";
import { launchBrowser, startDevServer } from "./browser";
import { openDevelopmentAction } from "./development-ui-helpers";
import { stageStartupSave } from "./frame-profile";

/**
 * Native game-export -> standalone-editor-import round trip. The game exports the canonical
 * `.island` file through Development tools; the editor loads that file, saves it to its own map
 * library, and the saved bytes must retain the exact catalog provenance and every world layer.
 *
 * Run: npx tsx tools/bench/editor-catalog-roundtrip-review.ts
 */
const provenance = { hash: "b".repeat(64), mapId: "2f1e7d42-9b0a-4c74-8f36-3f7aae3d9c11", revision: 7 };
const output = resolve(import.meta.dirname,
  "../../../resources/project-reviews/editor-catalog-2026-10-30/roundtrip");
mkdirSync(output, { recursive: true });
const sourcePath = resolve(import.meta.dirname,
  "../../../resources/project-reviews/island-lifecycle-2026-10-29/developed-colony.json");
const source = JSON.parse(readFileSync(sourcePath, "utf8"));
source.archipelago.active = null;
source.mapProvenance = provenance;
// A catalog-started game carries the revision in both its save field and its embedded map. Add
// the same provenance to this retained fixture so the game-export path is representative.
const sourceMap = await readMapFile(Buffer.from(source.map, "base64"));
source.map = Buffer.from(await writeMapFile(sourceMap.world, { ...sourceMap.meta, animals: sourceMap.animals,
  provenance, savedAt: source.savedAt, terrain: sourceMap.terrain })).toString("base64");
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const errors: string[] = [];
try {
  const game = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  game.on("pageerror", error => errors.push(`game: ${error.message}`));
  await game.routeWebSocket("**/*", () => {});
  await stageStartupSave(game, url, JSON.stringify(source), true);
  await game.goto(`${url}?quality=minimal&cache=0&reveal=1&time=day`);
  await game.waitForFunction(() => Boolean((window as any).__settlement), null, { timeout: 240_000 });
  await game.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  const exportedAt = await game.evaluate(() => (window as any).__settlement.simulation.gameNow());
  const downloadPromise = game.waitForEvent("download", { timeout: 120_000 });
  await (await openDevelopmentAction(game, "Export map")).click();
  const download = await downloadPromise;
  const downloadPath = await download.path();
  assert(downloadPath, "The exported map download has no path");
  const gameBytes = new Uint8Array(readFileSync(downloadPath));
  writeFileSync(resolve(output, "game-export.island"), gameBytes);
  const exported = await readMapFile(gameBytes);
  assert.deepEqual(exported.meta.provenance, provenance, "Game export lost catalog provenance");
  const exportedDigest = await digestWorld(exported.world);
  const exportedScenario = JSON.stringify(exported.world.scenario ?? null);
  await game.close();

  const editor = await browser.newPage({ viewport: { width: 1280, height: 820 } });
  editor.on("pageerror", error => errors.push(`editor: ${error.message}`));
  await editor.routeWebSocket("**/*", () => {});
  await editor.goto(`${url}editor.html?quality=minimal&size=256&seed=123&cache=0`);
  await editor.waitForFunction(() => Boolean((window as any).__editorReady), null, { timeout: 240_000 });
  await editor.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  await editor.getByRole("tab", { name: "Map, headquarters and scenario", exact: true })
    .waitFor({ state: "visible" });
  await editor.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
  editor.once("dialog", dialog => void dialog.accept());
  const [chooser] = await Promise.all([
    editor.waitForEvent("filechooser", { timeout: 60_000 }),
    editor.getByRole("button", { name: "Load map file", exact: true }).click()
  ]);
  await chooser.setFiles({ buffer: Buffer.from(gameBytes), mimeType: "application/octet-stream",
    name: "game-export.island" });
  await editor.waitForURL(/map=/, { timeout: 120_000 });
  await editor.waitForFunction(() => Boolean((window as any).__editorReady), null, { timeout: 240_000 });
  await editor.locator("#loading-screen").waitFor({ state: "detached", timeout: 240_000 });
  await editor.getByRole("tab", { name: "Map, headquarters and scenario", exact: true }).click();
  await editor.getByRole("button", { name: "Save in the browser (new slot)", exact: true }).click();
  await editor.waitForTimeout(1_000);
  const saved = await editor.evaluate(async () => {
    const { openMapStorage } = await import(/* @vite-ignore */ String("/src/app/map-editor/map-storage.ts"));
    const storage = await openMapStorage();
    if (!storage) throw new Error("The editor has no map storage");
    try {
      const slots = await storage.list(), slot = slots[0];
      const bytes = slot && await storage.read(slot.id);
      if (!slot || !bytes) throw new Error("The editor did not retain the imported map");
      return { bytes: Array.from(bytes), slot };
    } finally { storage.close(); }
  });
  const editorBytes = Uint8Array.from(saved.bytes);
  writeFileSync(resolve(output, "editor-roundtrip.island"), editorBytes);
  const imported = await readMapFile(editorBytes);
  assert.deepEqual(imported.meta.provenance, provenance, "Editor save lost catalog provenance");
  assert.equal(JSON.stringify(imported.world.scenario ?? null), exportedScenario,
    "Editor round trip changed the authored scenario");
  assert.deepEqual(await digestWorld(imported.world), exportedDigest,
    "Editor round trip changed a world layer");
  const report = {
    exportedAt,
    gameBytes: gameBytes.length,
    editorBytes: editorBytes.length,
    editorSlot: saved.slot,
    exportedDigest,
    importedDigest: await digestWorld(imported.world),
    provenance,
    errors
  };
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ editorBytes: editorBytes.length, gameBytes: gameBytes.length, provenance,
    editorSlot: saved.slot, errors }));
} finally {
  await browser.close();
  await server.close();
}
