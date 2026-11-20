import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { nationalBuildingIconPath } from "../../src/render-common/buildings/building-icon-path";
import {
  buildingFamilyId, nationTriangleBudget
} from "../../src/render-common/buildings/building-triangle-budgets";
import type { WorkerNation } from "../../src/render-common/workers/worker-unit";
import { launchBrowser, startDevServer } from "./browser";
import { buildingAssetCodes, buildingAssetNations } from "./building-asset-targets";
import { type BuildingIconRenderProof, writeBuildingIconProof } from "./building-icon-proof";
import { buildingLibraryAnimationNames } from "./building-library-animation-contract";
import { auditLevelBudgets } from "./level-budget-audit";
import { resourcesPath } from "./resources-path";
import { triangleBudgetFails } from "./triangle-budget";

/** Roman is exported by building-shots.ts; every other catalog nation here. */
const supportedNations: readonly string[] = buildingAssetNations().filter(nation => nation !== "roman");
const nationOption = process.argv.find(argument => argument.startsWith("--nations="))?.slice(10);
const nations = (nationOption ?? process.env.BUILDING_NATIONS)?.split(",").filter(Boolean) ?? supportedNations;
assert(nations.length > 0 && nations.every(nation => supportedNations.includes(nation)), "Unknown or empty building nation list");

const output = resourcesPath("building-previews", "nations");
const previewIds = new Set((process.env.BUILDING_PREVIEW_IDS ?? "").split(",").filter(Boolean).map(Number));
const reviewBuilding = (id: number) => previewIds.size === 0 || previewIds.has(id);
const CODES = buildingAssetCodes();
const MODELS = CODES.length;
const budgetOnly = process.env.BUILDING_ASSET_BUDGET_ONLY === "1";
const preflight = { mode: process.env.BUILDING_ASSET_PREFLIGHT ?? "run",
  testsExecutedByThisScript: false,
  note: process.env.BUILDING_ASSET_PREFLIGHT === "skip" ? "Explicit asset-only export; no tests or gameplay were run." : "No test preflight is performed by this script." };
const { server, url } = await startDevServer();
await server.warmupRequest("/src/building-showcase/main.ts");
await server.waitForRequestsIdle();
const browser = await launchBrowser();
const reports: unknown[] = [];
const budgetFailures: string[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const nation of nations as WorkerNation[]) {
    const folder = resolve(`assets/buildings/${nation}`), previews = resolve(output, nation);
    mkdirSync(folder, { recursive: true }); mkdirSync(previews, { recursive: true });
    const stats: unknown[] = [], libraries: { quality: string; bytes: number; models: number; clips: number }[] = [];
    for (const quality of ["high", "minimal"]) {
      await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1`, { timeout: 120000 });
      await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
      await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
      const nativeCounts = new Map<number, { triangles: number; stockTriangles: number }>();
      const nativeClips: { id: number; clips: string[] }[] = [];
      for (const id of CODES) {
        const result = await page.evaluate(async id => {
          const preview = (window as any).__buildingPreview;
          preview.selectBuilding(id);
          const model = preview.model(), beforeResident = model.triangles(false);
          await (window as any).__buildingResidentReady;
          const triangles = id === 7 ? model.triangles(false) : beforeResident; model.update(0, { construction: 1, door: 1, working: false });
          preview.renderer.render(preview.scene, preview.camera);
          let stockTriangles = 0;
          model.root.traverse((object: any) => {
            if (object.isMesh && object.userData.stock && !object.userData.liveAnimalGeometry)
              stockTriangles += (object.geometry.index?.count ?? object.geometry.attributes.position.count) / 3;
          });
          return { clips: model.root.animations.map((clip: any) => clip.name), id, triangles, stockTriangles, animalTriangles: model.triangles() - triangles, residentTriangles: model.triangles() - triangles, nation: model.root.userData.nation };
        }, id);
        assert.equal(result.nation, nation);
        nativeClips.push({ id, clips: result.clips });
        const family = buildingFamilyId(id);
        // Native budget-review.json records the measured components; not whole-island FPS claims.
        const budget = nationTriangleBudget(nation, id)[quality === "high" ? 0 : 1];
        const failure = `${nation}/${quality}/${id}: ${result.triangles} >= ${budget}`;
        const overBudget = triangleBudgetFails(`${nation}/${quality}/${id}`, result.triangles, budget);
        if (budgetOnly && overBudget) budgetFailures.push(failure);
        else assert(!overBudget, failure);
        const baseId = ({ 41: 20, 42: 17, 43: 19, 44: 33 } as Record<number, number>)[family];
        const base = baseId === undefined ? undefined : nativeCounts.get(baseId);
        const attribution = base && { baseId, baseTriangles: base.triangles,
          baseStockTriangles: base.stockTriangles, canonicalStockTriangles: result.stockTriangles,
          stockDelta: result.stockTriangles - base.stockTriangles,
          architectureDelta: (result.triangles - result.stockTriangles) - (base.triangles - base.stockTriangles) };
        nativeCounts.set(id, result);
        stats.push({ quality, ...result, budget, attribution });
        if (!budgetOnly && reviewBuilding(id))
          await page.screenshot({ path: resolve(previews, `${id}-${quality}.png`) });
      }
      const levelFailures = await auditLevelBudgets(page, `${nation}/${quality}`,
        id => nationTriangleBudget(nation, id)[quality === "high" ? 0 : 1], previewIds.size ? previewIds : undefined);
      if (budgetOnly) budgetFailures.push(...levelFailures);
      else assert.deepEqual(levelFailures, []);
      if (budgetOnly) { console.log(`${nation}/${quality}: ${MODELS} native geometry budgets inspected (asset-only, no library export).`); continue; }
      const encoded = await page.evaluate(async () => {
        const normalMaps = await import(/* @vite-ignore */ String("/tools/bench/building-export-normal-maps.ts"));
        const buffer = await normalMaps.withBuildingExportNormalMaps(() => (window as any).__buildingPreview.exportLibrary());
        return await new Promise<string>((resolve, reject) => {
          const reader = new FileReader(); reader.onload = () => resolve((reader.result as string).split(",")[1]!);
          reader.onerror = () => reject(reader.error); reader.readAsDataURL(new Blob([buffer]));
        });
      });
      const bytes = Buffer.from(encoded, "base64"), jsonLength = bytes.readUInt32LE(12);
      const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
      const expectedClips = buildingLibraryAnimationNames(nation, nativeClips);
      assert.deepEqual(gltf.animations.map((clip: any) => clip.name).sort(), expectedClips.sort());
      assert.equal(gltf.nodes.filter((node: any) => node.extras?.nation === nation).length, MODELS);
      writeFileSync(resolve(folder, `${nation}-library-${quality}.glb`), bytes);
      libraries.push({ quality, bytes: bytes.length, models: MODELS, clips: expectedClips.length });
      console.log(`${nation}/${quality}: ${MODELS} native models, ${bytes.length} bytes, ${expectedClips.length} clips`);
    }
    if (budgetOnly) { reports.push({ nation, models: MODELS, budgetOnly, stats }); continue; }
    await page.setViewportSize({ width: 240, height: 180 });
    await page.goto(`${url}building-showcase.html?nation=${nation}&quality=high&sample=1`, { timeout: 120000 });
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    const iconProofs: BuildingIconRenderProof[] = [];
    for (const id of CODES) {
      const proof = await page.evaluate(async id => {
        const preview = (window as any).__buildingPreview;
        preview.selectBuilding(id,1); await (window as any).__buildingResidentReady;
        preview.model().update(0, { construction: 1, door: 0, working: false });
        preview.renderer.render(preview.scene, preview.camera);
        await new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
        const model=preview.model();
        return {id:model.root.userData.buildingId??(model.root.userData.monument?7:-1),
          nation:model.root.userData.nation,nodeName:model.root.name,triangles:model.triangles()};
      }, id);
      assert.equal(proof.id,id);assert.equal(proof.nation,nation);iconProofs.push(proof);
      await page.screenshot({ path: resolve(nationalBuildingIconPath(nation,id)) });
    }
    writeBuildingIconProof(nation,iconProofs);
    await page.setViewportSize({ width: 900, height: 750 });
    writeFileSync(resolve(folder, "export-stats.json"), JSON.stringify({ generatedAt: new Date().toISOString(), preflight, errors, libraries, buildings: stats }, null, 2));
    reports.push({ nation, models: MODELS, stats });
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, budgetOnly ? "budget-review.json" : "review.json"), JSON.stringify({ preflight, budgetFailures, reports, errors }, null, 2));
  if (budgetFailures.length) throw new Error(`Native asset budget failures: ${budgetFailures.join("; ")}`);
} finally { await browser.close(); await server.close(); }
