import { execFileSync } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { buildingEntry } from "@shared/catalog";

import { nationTriangleBudget } from "../../src/render-common/buildings/building-triangle-budgets";
import { launchBrowser, startDevServer } from "./browser";
import { buildingAssetCodes } from "./building-asset-targets";
import { buildingLibraryAnimationNames } from "./building-library-animation-contract";
import { auditLevelBudgets } from "./level-budget-audit";
import { resourcesPath } from "./resources-path";
import { triangleBudgetFails } from "./triangle-budget";

// Default regeneration runs the entrance/support preflight. Explicit asset-only sessions may
// skip tests; metadata records this and never presents asset exports as gameplay acceptance.
const preflightMode = process.env.BUILDING_ASSET_PREFLIGHT ?? "run";
if (!["run", "skip"].includes(preflightMode)) throw new Error("BUILDING_ASSET_PREFLIGHT must be run or skip");
const preflight = { mode: preflightMode, testsExecuted: preflightMode === "run",
  reason: preflightMode === "skip" ? "Explicit asset-only export; entrance/support and gameplay checks were not run." : "Default entrance/support preflight." };
if (preflightMode === "run") execFileSync(
  process.execPath,
  [
    "node_modules/vitest/vitest.mjs",
    "run",
    "tests/building-entrances.test.ts",
    "tests/building-supports.test.ts"
  ],
  { stdio: "inherit" }
);

const previewIds = new Set((process.env.BUILDING_PREVIEW_IDS ?? "").split(",").filter(Boolean).map(Number));
const reviewBuilding = (id: number) => previewIds.size === 0 || previewIds.has(id);

const output = process.env.OUT_DIR ?? resourcesPath("building-previews", "roman");
mkdirSync(output, { recursive: true });
mkdirSync("assets/buildings/roman", { recursive: true });
/** Every catalog building in code order with its English name (stats, sample file names). */
const BUILDINGS = buildingAssetCodes().map(id => ({ id, name: buildingEntry(id)!.text.name.en }));
const { server, url } = await startDevServer();
await server.warmupRequest("/src/building-showcase/main.ts");
await server.waitForRequestsIdle();
const browser = await launchBrowser();
const exportStats: {quality:string; bytes:number; models:number; clips:number; maxTriangles:number; buildings:unknown[]}[] = [];
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  await page.routeWebSocket("**/*", () => {});
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error" || message.text().includes("Could not export"))
      errors.push(message.text());
  });
  for (const quality of ["high", "minimal"]) {
    const buildingStats: {id:number; name:string; triangles:number; parts:number; clips:string[]}[] = [];
    await page.goto(`${url}building-showcase.html?building=20&quality=${quality}`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady));
    for (const definition of BUILDINGS) {
      const stats = await page.evaluate(async (id) => {
        const preview = (window as any).__buildingPreview;
        preview.selectBuilding(id);
        const model = preview.model();
        if (id === 7) await (window as any).__buildingResidentReady;
        model.update(1, { construction: 1, door: 0, working: true });
        return { clips: model.root.animations.map((clip: any) => clip.name), triangles: model.triangles(false), animalTriangles: model.triangles() - model.triangles(false), parts: model.recipe.parts.length };
      }, definition.id);
      buildingStats.push({id:definition.id, name:definition.name, ...stats});
      const budget = nationTriangleBudget("roman", definition.id)[quality === "high" ? 0 : 1];
      if (triangleBudgetFails(definition.name, stats.triangles, budget)) throw new Error(`Triangle budget exceeded: ${definition.name} (${stats.triangles}/${budget})`);
      if (reviewBuilding(definition.id) && (previewIds.size > 0 ||
        [0, 1, 2, 9, 14, 17, 18, 19, 20, 21, 22, 25, 26, 31, 32, 33, 35, 7, 37, 41, 42, 43, 44].includes(
          definition.id
        ))
      ) {
        await page.waitForTimeout(120);
        await page.screenshot({ path: join(output, `${definition.id}-${quality}.png`) });
      }
    }
    const levelFailures = await auditLevelBudgets(page, `roman/${quality}`,
      id => nationTriangleBudget("roman", id)[quality === "high" ? 0 : 1], previewIds.size ? previewIds : undefined);
    if (levelFailures.length) throw new Error(`Triangle budget exceeded: ${levelFailures.join("; ")}`);
    await page.selectOption("#building", "20");
    const expectedClips = buildingLibraryAnimationNames("roman", buildingStats);
    const encoded = await page.evaluate(async ({ buildingCount, expectedClips }) => {
      const normalMaps = await import(/* @vite-ignore */ String("/tools/bench/building-export-normal-maps.ts"));
      const buffer = await normalMaps.withBuildingExportNormalMaps(() => (window as any).__buildingPreview.exportLibrary());
      // Exercise the same official loader used by Three.js asset integrations.
      const loaderModule = await import(
        /* @vite-ignore */ String("/tools/bench/building-library-loader.ts")
      );
      const loaded = await new loaderModule.GLTFLoader().parseAsync(buffer, "");
      let models = 0;
      loaded.scene.traverse((object: any) => {
        if (object.userData.nation === "roman") models++;
      });
      const loadedClips = loaded.animations.map((clip: any) => clip.name).sort();
      if (models !== buildingCount || JSON.stringify(loadedClips) !== JSON.stringify([...expectedClips].sort()))
        throw new Error("GLB round trip lost building metadata");
      loaded.scene.traverse((object: any) => {
        if (!object.isMesh) return;
        object.geometry.dispose();
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        for (const material of materials) {
          for (const value of Object.values(material))
            if ((value as any)?.isTexture) (value as any).dispose();
          material.dispose();
        }
      });
      const blob = new Blob([buffer], { type: "model/gltf-binary" });
      return await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve((reader.result as string).split(",")[1]!);
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(blob);
      });
    }, { buildingCount: BUILDINGS.length, expectedClips });
    const assetFolder = "assets/buildings/roman";
    mkdirSync(assetFolder, { recursive: true });
    const bytes = Buffer.from(encoded, "base64");
    writeFileSync(join(assetFolder, `roman-library-${quality}.glb`), bytes);
    const jsonLength = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
    exportStats.push({quality,bytes:bytes.length,models:BUILDINGS.length,clips:gltf.animations.length,maxTriangles:Math.max(...buildingStats.map(item=>item.triangles)),buildings:buildingStats});
    if (JSON.stringify(gltf.animations.map((clip: any) => clip.name).sort()) !==
      JSON.stringify([...expectedClips].sort()))
      throw new Error("Missing exported animations");
    if (gltf.animations.some((clip: any) => !clip.channels.length))
      throw new Error("Empty exported clip");
    console.log(
      `GLB ${quality}: ${(bytes.length / 1024 / 1024).toFixed(1)} MB, ${gltf.animations.length} clips`
    );
    console.log(`${quality}: all ${BUILDINGS.length} models rendered; GLB exported`);
    await page.evaluate(async (high) => {
      const layerModule = await import(
        /* @vite-ignore */ String("/src/renderers/three/buildings/three-buildings.ts")
      );
      const shadowModule = await import(
        /* @vite-ignore */ String("/src/renderers/three/three-shadows.ts")
      );
      const materialModule = await import(
        /* @vite-ignore */ String("/src/renderers/three/buildings/building-shadows.ts")
      );
      const environmentModule = await import(
        /* @vite-ignore */ String("/src/render-common/environment.ts")
      );
      const preview = (window as any).__buildingPreview;
      preview.renderer.setAnimationLoop(null);
      preview.scene.remove(preview.model().root);
      const shadows = shadowModule.createSunShadows(
        { cellsX: 8, cellsZ: 8 },
        { enabled: high, mapSize: high ? 512 : 1 }
      );
      const layer = layerModule.createThreeBuildings(high, shadows.scene, shadows.uniforms);
      const environment = environmentModule.computeEnvironment(
        { azimuthX: -0.5, azimuthZ: 0.866, elevation: 1.0 },
        12,
        0
      );
      const frame = {
        id: "test",
        type: 20,
        x: 0,
        y: 0,
        z: 0,
        rotation: 0,
        construction: 1,
        door: 1,
        working: true
      };
      for (const object of preview.scene.children)
        if (object.isMesh)
          materialModule.connectSunShadowReceivers([object.material], shadows.uniforms);
      preview.renderer.autoClear = false;
      for (const zoom of [2, 0.6, 2]) {
        layer.update([frame], 1, environment, zoom);
        shadows.render(preview.renderer, environment.sun, { x: 0, z: 0, radius: 4 });
        preview.renderer.clear();
        preview.renderer.render(preview.scene, preview.camera);
        layer.render(preview.renderer, preview.camera);
      }
      (window as any).__testBuildingLayer = layer;
    }, quality === "high");
    await page.screenshot({ path: join(output, `20-island-lighting-${quality}.png`) });
    await page.evaluate(() => {
      (window as any).__testBuildingLayer.dispose();
      delete (window as any).__testBuildingLayer;
    });
  }
  for (const definition of BUILDINGS.filter(entry => reviewBuilding(entry.id))) {
    const id = definition.id;
    const name = definition.name.toLowerCase().replace(/[^a-z0-9]+/g, "-");
    // A loaded machine may take longer than the default 30 s per page.
    await page.goto(`${url}building-showcase.html?building=${id}&quality=high&sample=1`, { timeout: 120000 });
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(async () => { await (window as any).__buildingResidentReady; });
    await page.waitForTimeout(200);
    await page.screenshot({ path: join(output, `roman-${name}-sample.png`) });
  }
  if (errors.length) throw new Error(errors.join("\n"));
  writeFileSync("assets/buildings/roman/export-stats.json", JSON.stringify({generatedAt:new Date().toISOString(), preflight, errors, libraries:exportStats},null,2)+"\n");
} finally {
  await browser.close();
  await server.close();
}

// Menu thumbnails always follow the freshly exported buildings and all model previews.
execFileSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "tools/bench/building-icons.ts"], {
  stdio: "inherit"
});
