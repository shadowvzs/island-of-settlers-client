import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { NEUTRAL_BUILDING_IDS } from "../../src/render-common/buildings/neutral-building-recipe";
import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

/** Neutral enemy models use their own native library and UI previews; player assets stay separate. */
const output = resourcesPath("building-previews", "nations", "neutral");
mkdirSync(output, { recursive: true });
mkdirSync(resolve("assets/building-icons"), { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
try {
  const page = await browser.newPage({ viewport: { width: 900, height: 750 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.routeWebSocket("**/*", () => {});
  for (const quality of ["high", "minimal"]) {
    await page.goto(`${url}building-showcase.html?nation=neutral&quality=${quality}&sample=1&building=0`, { timeout: 120000 });
    await page.waitForFunction(() => (window as any).__buildingReady, null, { timeout: 120000 });
    const encoded = await page.evaluate(async () => {
      const normalMaps = await import(/* @vite-ignore */ String("/tools/bench/building-export-normal-maps.ts"));
      const bytes = await normalMaps.withBuildingExportNormalMaps(() => (window as any).__buildingPreview.exportLibrary());
      return new Promise<string>((done, reject) => {
        const reader = new FileReader(); reader.onload = () => done((reader.result as string).split(",")[1]!);
        reader.onerror = () => reject(reader.error); reader.readAsDataURL(new Blob([bytes]));
      });
    });
    const bytes = Buffer.from(encoded, "base64"), jsonLength = bytes.readUInt32LE(12);
    const gltf = JSON.parse(bytes.subarray(20, 20 + jsonLength).toString("utf8"));
    assert.equal(gltf.nodes.filter((node: any) => node.extras?.buildingStyle === "neutral").length,
      NEUTRAL_BUILDING_IDS.length);
    writeFileSync(resolve(output, `neutral-library-${quality}.glb`), bytes);
    for (const id of NEUTRAL_BUILDING_IDS) {
      await page.evaluate(id => (window as any).__buildingPreview.selectBuilding(id), id);
      await page.waitForTimeout(100);
      await page.screenshot({ path: resolve(output, `${id}-${quality}.png`) });
    }
  }
  await page.setViewportSize({ width: 240, height: 180 });
  await page.goto(`${url}building-showcase.html?nation=neutral&quality=high&sample=1&building=0`, { timeout: 120000 });
  await page.waitForFunction(() => (window as any).__buildingReady, null, { timeout: 120000 });
  for (const id of NEUTRAL_BUILDING_IDS) {
    await page.evaluate(id => (window as any).__buildingPreview.selectBuilding(id), id);
    await page.waitForTimeout(100);
    await page.screenshot({ path: resolve(`assets/building-icons/neutral-${id}.png`) });
  }
  assert.deepEqual(errors, []);
  writeFileSync(resolve(output, "catalog.json"), JSON.stringify({ style: "neutral",
    types: NEUTRAL_BUILDING_IDS, errors }, null, 2));
  console.log(`Neutral libraries, previews and ${NEUTRAL_BUILDING_IDS.length} icons generated: ${output}`);
} finally { await browser.close(); await server.close(); }
