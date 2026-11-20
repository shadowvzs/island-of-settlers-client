import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";
import { checkTriangleBudget } from "./triangle-budget";

const runId = process.argv[2];
assert(runId && /^[a-z0-9-]+$/.test(runId), "Choose a new explicit native run ID");
const output = resourcesPath("project-reviews", "storage-double-doors-2026-11-04", runId);
mkdirSync(output, { recursive: false });
const sourceFiles = ["src/render-common/buildings/storage-door-profile.ts",
  "src/render-common/buildings/building-recipe.ts", "src/render-common/buildings/roman-design-kit.ts",
  "src/render-common/buildings/nation-kit-japanese.ts", "src/render-common/buildings/persian-headquarters.ts",
  "src/render-common/buildings/indigenous-headquarters.ts", "src/render-common/buildings/levels/level-kit.ts",
  "src/render-common/buildings/levels/level-dressing.ts", "src/render-common/buildings/levels/leveled-building-recipe.ts",
  "src/renderers/three/buildings/storage-double-door.ts", "src/renderers/three/buildings/roman-building.ts",
  "src/renderers/three/buildings/roman-entrance-animation.ts"];
const hashes = () => Object.fromEntries(sourceFiles.map(file => [file,
  createHash("sha256").update(readFileSync(file)).digest("hex")]));
const sourceHashes = hashes();
const nations = ["roman", "viking", "nubian", "japanese", "maya", "persian", "chinese", "indigenous"];
const cases = [{ id: 0, level: 1, leaves: [0, 0], label: "hq-closed" },
  { id: 0, level: 5, leaves: [1, 1], label: "hq-open" },
  { id: 29, level: 5, leaves: [1, 0], label: "store-left-open" },
  { id: 39, level: 5, leaves: [0, 1], label: "harbour-right-open" }];
const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
const reports: unknown[] = [], errors: string[] = [], budgetFailures: unknown[] = [], budgetWarnings: unknown[] = [];
try {
  browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { width: 800, height: 800 } });
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript("window.__name=value=>value;");
  for (const quality of ["high", "minimal"]) for (const nation of nations) {
    await page.goto(`${url}building-showcase.html?nation=${nation}&quality=${quality}&sample=1&building=0`);
    await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
    await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
    await page.addStyleTag({ content: "aside,footer{display:none!important}main{grid-template-columns:1fr!important}#viewport{width:100vw!important;height:100vh!important}" });
    const files: { file: string; label: string }[] = [];
    for (const entry of cases) {
      const stats = await page.evaluate(async ({ id, leaves, level, nation }) => {
        const preview = (window as any).__buildingPreview;
        preview.selectBuilding(id, level); await (window as any).__buildingResidentReady;
        const model = preview.model(), root = model.root;
        root.rotation.y = 0;
        model.update(0, { construction: 1, door: 1, doorLeaves: leaves,
          inputStock: {}, outputStock: {}, working: false });
        root.updateMatrixWorld(true);
        const scale = root.scale.x, door = model.recipe.door;
        const x = (door[0] + model.recipe.doorDimensions.width / 2) * scale;
        const y = door[1] * scale, z = door[2] * scale;
        preview.renderer.setSize(800, 800);
        preview.camera.aspect = 1; preview.camera.updateProjectionMatrix();
        preview.camera.position.set(x + 1.4, y + 1.3, z + 2.7);
        preview.controls.target.set(x, y + .65, z - .08); preview.controls.update();
        preview.renderer.render(preview.scene, preview.camera);
        const { nationTriangleBudget } = await import(
          /* @vite-ignore */ String("/src/render-common/buildings/building-triangle-budgets.ts"));
        const left = root.getObjectByName("door_left"), right = root.getObjectByName("door_right");
        return { triangles: model.triangles(false), budgets: nationTriangleBudget(nation, id),
          leftYaw: left?.rotation.y, rightYaw: right?.rotation.y,
          modelWidth: model.recipe.doorDimensions.width, displayedWidth: model.recipe.doorDimensions.width * scale,
          profile: root.getObjectByName("door")?.userData.profile };
      }, { ...entry, nation });
      assert(Math.abs(stats.leftYaw + entry.leaves[0]! * Math.PI / 2) < 1e-8);
      assert(Math.abs(stats.rightYaw - entry.leaves[1]! * Math.PI / 2) < 1e-8);
      const budgetStatus = checkTriangleBudget(stats.triangles, stats.budgets[quality === "high" ? 0 : 1]);
      if (budgetStatus === "fail") budgetFailures.push({ nation, quality, ...entry, ...stats });
      if (budgetStatus === "warn") budgetWarnings.push({ nation, quality, ...entry, ...stats });
      const file = `${nation}-${quality}-${entry.label}.png`;
      await page.screenshot({ path: resolve(output, file) });
      files.push({ file, label: entry.label }); reports.push({ nation, quality, ...entry, ...stats, budgetStatus });
    }
    const sheet = await browser.newPage({ viewport: { width: 1200, height: 1240 } });
    try {
      const figures = files.map(({ file, label }) => `<figure><img src="data:image/png;base64,${
        readFileSync(resolve(output, file)).toString("base64")}"><figcaption>${nation}/${quality}/${label}</figcaption></figure>`);
      await sheet.setContent(`<html><style>body{margin:0;display:grid;grid-template-columns:repeat(2,600px);background:#182028;color:white;font:18px sans-serif}figure{margin:0;height:620px}img{width:600px;height:600px}figcaption{text-align:center}</style>${figures.join("")}</html>`);
      await sheet.locator("img").evaluateAll(images => Promise.all(images.map(image => (image as HTMLImageElement).decode())));
      await sheet.screenshot({ path: resolve(output, `${nation}-${quality}-sheet.png`) });
    } finally { await sheet.close(); }
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(hashes(), sourceHashes, "Native source changed during the gallery");
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ reports, errors, budgetFailures, budgetWarnings,
    sourceHashes, sourceUnchanged: true, passed: budgetFailures.length === 0, visualInspectionPending: true }, null, 2));
} finally { await browser?.close(); await server.close(); }
console.log(JSON.stringify({ output, frames: reports.length, errors, budgetFailures, budgetWarnings }));
