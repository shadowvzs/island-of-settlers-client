import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { confirmImport, openMenuAction, resumeSavedGame, saveFromMenu } from "./save-helpers";

const output = resolve("../resources/settlement-previews/game-save");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(),
  browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const page = await browser.newPage({ viewport: { width: 1400, height: 900 } }),
      errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.routeWebSocket("**/*", () => {});
    await page.goto(`${url}?quality=${quality}&cache=0&reveal=1`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
    const setup = await page.evaluate(async () => {
      const app = (window as any).__settlement,
        sim = app.simulation,
        hq = sim.headquarters;
      let building: any;
      for (let radius = 6; radius <= 24 && !building; radius += 2) {
        for (const [dx, dz] of [
          [radius, 0],
          [-radius, 0],
          [0, radius],
          [0, -radius],
          [radius, 4],
          [-radius, 4],
          [4, radius],
          [4, -radius]
        ]) {
          const placed = sim.placeBuilding(17, hq.x + dx, hq.z + dz);
          if (!placed.ok) continue;
          if (!app.roads.addRoad(hq.access, placed.building.access)) {
            sim.demolishBuilding(placed.building.uid);
            continue;
          }
          building = placed.building;
          break;
        }
      }
      if (!building) throw new Error("No connected actual island building for save review");
      for (let step = 0; step < 500 && !sim.frames().some((actor: any) => actor.ware); step++)
        sim.update(0.05);
      if (!sim.frames().length)
        throw new Error("Native actual settlement has no recruited workers");
      let editorPlaced = false;
      for (let offset = 3; offset < 20 && !editorPlaced; offset++)
        editorPlaced = app.mapEditor.placeAnimal(1, hq.x + offset, hq.z + 4);
      if (!editorPlaced) throw new Error("Could not place genuine editor animal");
      hq.inventory.gold = 17;
      window.__fellNearestTree?.();
      window.__killNearestAnimal?.();
      const storageModule = await import(
        /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts")
      );
      const storage = await storageModule.openLocalSaveStore();
      (window as any).__previousSave = (await storage.readSavedGame())?.savedAt ?? null;
      return {
        building: building.uid,
        workers: sim.frames().length,
        roads: app.roads.segments().length
      };
    });
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.screenshot({ path: resolve(output, `${quality}-menu.png`) });
    await saveFromMenu(page);
    await page.waitForFunction(async () => {
      const module = await import(
        /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts")
      );
      const saved = await (await module.openLocalSaveStore()).readSavedGame();
      return !!saved && saved.savedAt !== (window as any).__previousSave;
    });
    const baseline = await page.evaluate(async () => {
      const module = await import(
        /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts")
      );
      const saved = await (await module.openLocalSaveStore()).readSavedGame();
      const app = (window as any).__settlement;
      app.simulation.headquarters.inventory.gold = 99;
      const corrupt = JSON.parse(JSON.stringify(saved));
      corrupt.settlement.buildings[0].inventory.gold = -1;
      const result = await app.savedGames.importJson(JSON.stringify(corrupt));
      if (result || app.simulation.headquarters.inventory.gold !== 99)
        throw new Error("Invalid app import mutated live economy");
      return { settlement: saved.settlement, runtime: saved.runtime };
    });
    await resumeSavedGame(page);
    await page.getByRole("button", { name: "Build", exact: true }).waitFor({ state: "visible" });
    const restored = await page.evaluate(() => {
      const app = (window as any).__settlement;
      return {
        state: app.simulation.saveState(),
        growth: app.growth.saveState(),
        felling: app.felling.saveState(),
        animals: app.animals.saveState(),
        editorAnimals: app.mapEditor.saveInput().animals.length,
        launchers: document.querySelector(".settlement-ui__actions")?.children.length
      };
    });
    assert.equal(restored.state.settlers, baseline.settlement.settlers);
    assert.equal(restored.state.buildings[0].inventory.gold, 17);
    assert.equal(restored.launchers, 4);
    assert.deepEqual(restored.state.roads, baseline.settlement.roads);
    assert.deepEqual(
      restored.state.buildings.map((building: any) => [
        building.uid,
        building.typeId,
        building.x,
        building.z,
        building.rotation
      ]),
      baseline.settlement.buildings.map((building: any) => [
        building.uid,
        building.typeId,
        building.x,
        building.z,
        building.rotation
      ])
    );
    assert.deepEqual(
      restored.state.actors.map((actor: any) => [actor.uid, actor.job, actor.home, actor.building]),
      baseline.settlement.actors.map((actor: any) => [
        actor.uid,
        actor.job,
        actor.home,
        actor.building
      ])
    );
    assert.deepEqual(restored.growth.jobPlanted, baseline.runtime.growth.jobPlanted);
    assert(restored.growth.now >= baseline.runtime.growth.now);
    assert.deepEqual(
      restored.felling.controller.fellings,
      baseline.runtime.felling.controller.fellings
    );
    assert.equal(restored.editorAnimals, 1);
    assert.deepEqual(restored.animals.pool.active, baseline.runtime.animals.pool.active);
    assert.deepEqual(restored.animals.pool.species, baseline.runtime.animals.pool.species);
    assert.deepEqual(restored.animals.pool.carcass, baseline.runtime.animals.pool.carcass);
    await page.screenshot({ path: resolve(output, `${quality}-loaded-island.png`) });
    const exportButton = await openMenuAction(page, "Export game");
    const downloading = page.waitForEvent("download");
    await exportButton.click();
    const download = await downloading,
      path = resolve(output, `${quality}-export.json`);
    await download.saveAs(path);
    const exported = JSON.parse(readFileSync(path, "utf8"));
    assert.equal(exported.format, "island-settlers-game");
    await page.evaluate(() => {
      (window as any).__settlement.simulation.headquarters.inventory.gold = 123;
    });
    const importButton = await openMenuAction(page, "Import game");
    const choosing = page.waitForEvent("filechooser");
    await importButton.click();
    const importing = page.waitForEvent("load");
    await (await choosing).setFiles(path);
    await confirmImport(page);
    await importing;
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
    await page.getByRole("button", { name: "Build", exact: true }).waitFor({ state: "visible" });
    const imported = await page.evaluate(
      () => (window as any).__settlement.simulation.headquarters.inventory.gold
    );
    assert.equal(imported, 17);
    assert.deepEqual(errors, []);
    reports.push({
      quality,
      ...setup,
      launchers: restored.launchers,
      loadedGold: 17,
      importedGold: imported,
      savedPopulation: baseline.settlement.settlers,
      savedHeldCargo: baseline.settlement.actors.filter((actor: any) => actor.ware).length,
      savedGrowth: baseline.runtime.growth.planted.length,
      savedCuts: baseline.runtime.felling.controller.fellings.length,
      savedCarcasses: baseline.runtime.animals.pool.carcass.filter((value: number) => value === 1)
        .length,
      editorAnimals: restored.editorAnimals,
      invalidImportKeptGold: 99,
      errors
    });
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  console.log(`Native actual app Save/Load/Export/Import passed: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
