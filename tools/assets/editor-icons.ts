import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "../bench/browser";

/**
 * Makes the map editor's icons from the game itself: the icon page renders every tool's item
 * (trees and saplings with the game's prop meshes and material, stones and ore boulders with the
 * rock layer, animals with the animal layer, ground tiles from the terrain textures, relief and
 * eraser drawings painted with them) on a transparent background, trims and scales them; this
 * script saves them as lossless WebP (Chrome encodes quality 1 losslessly; 1x and 2x) under
 * assets/editor-icons/.
 * Run: npx tsx tools/assets/editor-icons.ts
 */
const OUT = "assets/editor-icons";

const toBuffer = (dataUrl: string) => Buffer.from(dataUrl.split(",")[1]!, "base64");

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  page.on("pageerror", (error) => console.error("[pageerror]", error.message));
  await page.goto(`${url}editor-icons.html`);
  await page.waitForFunction(() => window.__editorIcons !== undefined, null, { timeout: 300_000 });
  const icons = await page.evaluate(() => window.__editorIcons!);
  const reliefChecks = await page.evaluate(async () => {
    const checks: { name: string; opaquePixels: number }[] = [];
    for (const name of ["relief-mountain", "relief-alpine", "relief-lake", "relief-reset"]) {
      const image = new Image(); image.src = window.__editorIcons![name]![1]!;
      await image.decode();
      const canvas = document.createElement("canvas"); canvas.width = image.width; canvas.height = image.height;
      const context = canvas.getContext("2d")!; context.drawImage(image, 0, 0);
      const pixels = context.getImageData(0, 0, image.width, image.height).data;
      let opaquePixels = 0;
      for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 8) opaquePixels++;
      checks.push({ name, opaquePixels });
    }
    return checks;
  });
  assert(reliefChecks.every(check => check.opaquePixels > 100), "Relief icons must contain visible pixels");
  assert.equal(new Set(reliefChecks.map(check => icons[check.name]![1])).size, reliefChecks.length,
    "Every relief tool must render its own distinct icon");
  console.log("Native relief icon checks", JSON.stringify(reliefChecks));
  mkdirSync(OUT, { recursive: true });
  for (const [name, [single, double]] of Object.entries(icons)) {
    if (process.env.ICONS && !process.env.ICONS.split(",").includes(name)) continue;
    writeFileSync(`${OUT}/${name}.webp`, toBuffer(single!));
    writeFileSync(`${OUT}/${name}@2x.webp`, toBuffer(double!));
  }
  await page.setViewportSize({ height: 700, width: 1200 });
  await page.screenshot({ path: process.env.PREVIEW ?? "/tmp/editor-icons-preview.png" });
  console.log(`${Object.keys(icons).length} icons written to ${OUT}`);
} finally {
  await browser.close();
  await server.close();
}
