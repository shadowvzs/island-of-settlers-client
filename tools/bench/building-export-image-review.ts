import { writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { BUILDING_CATALOG } from "../../src/render-common/buildings/building-catalog";
import { nationTriangleBudget } from "../../src/render-common/buildings/building-triangle-budgets";
import { launchBrowser, startDevServer } from "./browser";
import { buildingLibraryAnimationNames } from "./building-library-animation-contract";
import { auditLevelBudgets } from "./level-budget-audit";
import { resourcesPath } from "./resources-path";

const { server, url } = await startDevServer();
let browser: Awaited<ReturnType<typeof launchBrowser>> | undefined;
let receipt: unknown;
try {
  browser = await launchBrowser();
  const page = await browser.newPage();
  await page.goto(`${url}building-showcase.html?nation=indigenous&quality=high&sample=1`);
  await page.waitForFunction(() => Boolean((window as any).__buildingReady), null, { timeout: 120000 });
  await page.evaluate(() => (window as any).__buildingPreview.renderer.setAnimationLoop(null));
  const nativeClips: { id: number; clips: string[] }[] = [];
  for (const definition of BUILDING_CATALOG) nativeClips.push(await page.evaluate(async id => {
    const preview = (window as any).__buildingPreview;
    preview.selectBuilding(id); const model = preview.model();
    await (window as any).__buildingResidentReady;
    model.update(0, { construction: 1, door: 1, working: false });
    preview.renderer.render(preview.scene, preview.camera);
    return { id, clips: model.root.animations.map((clip: { name: string }) => clip.name) };
  }, definition.id));
  await auditLevelBudgets(page, "diagnostic indigenous/high", id => nationTriangleBudget("indigenous", id)[0]);
  const freshLibrary = await page.evaluate(async expectedClips => {
    const preview = (window as any).__buildingPreview;
    const fixture = await import(/* @vite-ignore */ String("/tools/bench/building-export-image-fixture.ts"));
    return fixture.diagnoseBuildingImageExport(() => preview.exportLibrary(), expectedClips);
  }, buildingLibraryAnimationNames("indigenous", nativeClips));
  if (freshLibrary.failed) receipt = { freshLibrary, retainedLibraries: "not checked after fresh failure" };
  else {
    const retainedLibraries = await page.evaluate(async () => {
      const fixture = await import(/* @vite-ignore */ String("/tools/bench/building-export-reload-fixture.ts"));
      return fixture.reloadRetainedBuildingLibraries();
    });
    receipt = { freshLibrary, retainedLibraries };
  }
} finally {
  await browser?.close(); await server.close();
  console.log("FULL CLOSED: image diagnostic browser/server");
}
writeFileSync(resolve(resourcesPath("project-reviews", "building-assets-sync-2026-11-04", "full-b"),
  "export-indigenous-control-e.json"), JSON.stringify(receipt, null, 2));
console.log(JSON.stringify(receipt));
