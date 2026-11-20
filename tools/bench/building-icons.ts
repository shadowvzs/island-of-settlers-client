import assert from "node:assert/strict";
import { mkdirSync } from "node:fs";
import { resolve } from "node:path";

import { nationalBuildingIconPath } from "../../src/render-common/buildings/building-icon-path";
import type { WorkerNation } from "../../src/render-common/workers/worker-nation";
import { launchBrowser, startDevServer } from "./browser";
import { buildingAssetCodes } from "./building-asset-targets";
import { type BuildingIconRenderProof, writeBuildingIconProof } from "./building-icon-proof";

const output = resolve("assets/building-icons");
const requested = new Set(process.argv.slice(2).map(Number));
/** NATION=viking (etc.) renders that nation's set; Roman by default. */
const nation = process.env.NATION ?? "roman";
const codes = buildingAssetCodes();
const selected = requested.size ? codes.filter(code => requested.has(code)) : codes;
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 240, height: 180 } });
  await page.routeWebSocket("**/*", () => {});
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${url}building-showcase.html?building=17&nation=${nation}&quality=high&sample=1`, { timeout: 120000 });
  await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
  const proofs: BuildingIconRenderProof[] = [];
  for (const code of selected) {
    const proof = await page.evaluate(async (id) => {
      const preview = (window as any).__buildingPreview;
      preview.renderer.setAnimationLoop(null);
      preview.selectBuilding(id,1);
      await (window as any).__buildingResidentReady;
      preview.model().update(0, { construction: 1, door: 0, working: false });
      preview.renderer.render(preview.scene, preview.camera);
      // Let the compositor present the newly selected model before capturing the page.
      await new Promise<void>(resolve => requestAnimationFrame(() => {
        preview.renderer.render(preview.scene, preview.camera);
        requestAnimationFrame(() => resolve());
      }));
      const model=preview.model();
      return {id:model.root.userData.buildingId??(model.root.userData.monument?7:-1),
        nation:model.root.userData.nation,nodeName:model.root.name,triangles:model.triangles()};
    }, code);
    assert.equal(proof.id,code);assert.equal(proof.nation,nation);proofs.push(proof);
    await page.screenshot({ path: resolve(nationalBuildingIconPath(nation as WorkerNation,code)) });
  }
  if(selected.length===codes.length)writeBuildingIconProof(nation as WorkerNation,proofs);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log(`Saved ${selected.length} original ${nation} menu thumbnails.`);
} finally {
  await browser.close();
  await server.close();
}
