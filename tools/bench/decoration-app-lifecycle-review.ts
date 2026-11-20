import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const output = resourcesPath("project-reviews", "decoration-lazy-2026-11-04", "app-lifecycle");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const rows: unknown[] = [], errors: string[] = [], requests: string[] = [];
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
let releaseModel!: () => void, releasePlant!: () => void;
const modelGate = new Promise<void>(done => { releaseModel = done; });
const plantGate = new Promise<void>(done => { releasePlant = done; });
let firstModel = true;
const pot = "roadDecoration:indigenous-flower-pot:native";
const cherry = "roadDecoration:plant-cherry-blossom-roadside-ground-0:native";
try {
  await page.addInitScript(() => {
    (window as any).__name = (value: unknown) => value;
    (window as any).__decorationDocumentMarker = performance.timeOrigin;
    localStorage.setItem("island-of-settlers.graphics.detail", "minimal");
    localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
  });
  page.on("pageerror", error => errors.push(error.message));
  page.on("request", request => requests.push(request.url()));
  await page.route("**/src/renderers/three/settlement/three-road-decorations.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    const anchor = "const dispose = () => {";
    assert(source.includes(anchor));
    const hook = `globalThis.__decorationLayers ??= []; globalThis.__decorationLayers.push({
      root, ghostRoot, templates, disposed: () => disposed });`;
    await route.fulfill({ response, body: source.replace(anchor, `${hook}\n${anchor}`) });
  });
  await page.route("**/src/app/island-runtime.ts*", async route => {
    const response = await route.fetch(), source = await response.text();
    const anchor = "const dispose = async () => {"; assert(source.includes(anchor));
    await route.fulfill({ response, body: source.replace(anchor,
      `globalThis.__decorationRuntime={renderer,world,settlement,ready};\n${anchor}`) });
  });
  await page.route("**/src/renderers/three/road-decoration-model.ts*", async route => {
    if (firstModel && !new URL(route.request().url()).searchParams.has("decorationRetry")) {
      firstModel = false; await route.abort("failed"); return;
    }
    if (new URL(route.request().url()).searchParams.has("decorationRetry")) await modelGate;
    await route.continue();
  });
  await page.route("**/src/renderers/three/road-plant-model-core.ts*", async route => {
    await plantGate; await route.continue();
  });
  await page.goto(`${url}admin.html?seed=123&size=96&forest=0&mountains=0&cache=0&time=day&terrainVariation=0`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__islandLoadReview),
    null, { timeout: 180000 });
  const empty = await page.evaluate(() => {
    const root = window as any;
    return { templates: root.__decorationLayers.at(-1).templates.statistics(),
      resources: root.__decorationRuntime.renderer.getResourceStats(), timeOrigin: performance.timeOrigin };
  });
  assert.equal(empty.templates.templates, 0);
  assert(!requests.some(address => /road-decoration-model\.ts/.test(address)));
  rows.push({ stage: "actual-empty-map", ...empty });
  const preview = async (item: string) => {
    const point = await page.evaluate(item => {
      const s = (window as any).__settlement, sim = s.simulation;
      s.removeFog(); const progress = s.playerSession.progress(); progress.inventory ??= {}; progress.inventory[item] = 2;
      const hq = sim.buildings().find((building: any) => building.typeId === 0);
      for (let radius = 3; radius <= 12; radius++) for (let dz = -radius; dz <= radius; dz++) for (const dx of [-radius, radius]) {
        const position = { x: hq.x + dx, z: hq.z + dz };
        const plan = sim.planRoadDecoration({ item, position, yaw: 0 }); if (!plan.ok) continue;
        const point = s.projectGround(position.x, position.z);
        if (point && point.x > 400 && point.x < 1100 && point.y > 350 && point.y < 760) {
          s.selectRoadDecoration(item); return point;
        }
      }
      throw new Error("No visible canonical placement candidate");
    }, item);
    await page.mouse.move(point.x + 1, point.y); await page.mouse.move(point.x, point.y);
    await page.waitForFunction(item => (window as any).__settlement.controls.roadDecorationGhost()?.item === item, item);
    return point;
  };
  const retried = page.waitForRequest(request => new URL(request.url()).searchParams.has("decorationRetry"));
  const point = await preview(pot); await retried;
  await page.mouse.click(point.x, point.y, { button: "right" });
  await preview(pot); releaseModel();
  await page.waitForFunction(() => (window as any).__decorationLayers.at(-1).ghostRoot.children.length > 0);
  const recovered = await page.evaluate(() => {
    const layer = (window as any).__decorationLayers.at(-1);
    return { stats: layer.templates.statistics(), ghostMeshes: layer.ghostRoot.children.length };
  });
  assert.equal(recovered.stats.errors, 0); assert.equal(recovered.stats.templates, 1);
  rows.push({ stage: "real-network-failure-retry-cancel-repreview", ...recovered });
  await page.screenshot({ path: resolve(output, "recovered-preview.png") });
  await page.mouse.click(point.x, point.y);
  await page.waitForFunction(() => (window as any).__settlement.simulation.roadDecorations().length === 1);
  await page.keyboard.press("Escape");
  const identity = await page.evaluate(() => (window as any).__settlement.simulation.roadDecorations()
    .map((entry: any) => ({ uid: entry.uid, item: entry.item, position: entry.position, yaw: entry.yaw })));
  const lod = async (quality: "minimal" | "high") => {
    const count = await page.evaluate(() => (window as any).__decorationLayers.length);
    await page.evaluate(quality => (window as any).__graphicsReview.applyDetail(quality), quality);
    await page.waitForFunction(count => Boolean((window as any).__islandReady) &&
      (window as any).__decorationLayers.length > count, count, { timeout: 180000 });
    await page.waitForFunction(() => (window as any).__decorationLayers.at(-1).templates.statistics().templates === 1);
    const row = await page.evaluate(() => {
      const root = window as any;
      return { resources: root.__decorationRuntime.renderer.getResourceStats(),
        layers: root.__decorationLayers.map((layer: any) => ({ disposed: layer.disposed(), children: layer.root.children.length,
          ghost: layer.ghostRoot.children.length, stats: layer.templates.statistics() })),
        decorations: root.__settlement.simulation.roadDecorations().map((entry: any) => ({
          uid: entry.uid, item: entry.item, position: entry.position, yaw: entry.yaw })) };
    });
    assert.deepEqual(row.decorations, identity);
    for (const previous of row.layers.slice(0, -1)) {
      assert(previous.disposed); assert.equal(previous.children, 0); assert.equal(previous.stats.templates, 0);
    }
    rows.push({ stage: "live-quality-switch", quality, ...row });
  };
  await lod("high"); await lod("minimal");
  const plantRequested = page.waitForRequest(request => /road-plant-model-core\.ts/.test(request.url()));
  await preview(cherry); await plantRequested;
  const generate = async () => {
    const count = await page.evaluate(() => (window as any).__decorationLayers.length);
    await page.evaluate(async () => {
      const { DEFAULT_ISLAND_CHOICE } = await import(/* @vite-ignore */ String("/src/app/map-generator/helpers.ts"));
      (window as any).__islandLoadReview.generate({ ...DEFAULT_ISLAND_CHOICE, size: 96, forest: 0, mountains: 0,
        rivers: 0, terrainVariation: 0 }, 123);
    });
    await page.waitForFunction(count => Boolean((window as any).__islandReady) &&
      (window as any).__decorationLayers.length > count, count, { timeout: 180000 });
  };
  await generate();
  const plantResponse = page.waitForResponse(response => /road-plant-model-core\.ts/.test(response.url()));
  releasePlant(); await plantResponse;
  for (let index = 0; index < 3; index++) await generate();
  const final = await page.evaluate(() => {
    const root = window as any;
    return { timeOrigin: performance.timeOrigin, resources: root.__decorationRuntime.renderer.getResourceStats(),
      layers: root.__decorationLayers.map((layer: any) => ({ disposed: layer.disposed(),
        children: layer.root.children.length, ghost: layer.ghostRoot.children.length, stats: layer.templates.statistics() })),
      receipts: root.__handoffReceipts() };
  });
  assert.equal(final.timeOrigin, empty.timeOrigin);
  for (const previous of final.layers.slice(0, -1)) {
    assert(previous.disposed); assert.equal(previous.children, 0); assert.equal(previous.ghost, 0);
    assert.equal(previous.stats.templates, 0);
  }
  assert.equal(final.layers.at(-1).stats.templates, 0);
  rows.push({ stage: "pending-plant-replaced-by-four-full-app-islands", ...final });
  assert.deepEqual(errors, []);
} finally {
  releaseModel(); releasePlant();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ rows, errors, requests }, null, 2));
  await browser.close(); await server.close();
}
console.log(JSON.stringify({ output, rows: rows.length, errors }));
