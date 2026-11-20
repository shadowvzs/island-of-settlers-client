import { writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "../bench/browser";

/**
 * Usage: npx tsx tools/dev/animal-sheets.mts <out-dir> [elk,deer,gaits,rabbit,rabbits,stages,resting]
 * Renders the animal showcase sheets (transparent RGBA PNGs) into <out-dir>/<sheet>.png;
 * WINTER=1 renders the winter coats into <out-dir>/<sheet>-winter.png.
 */
const [outDir = ".", sheets = "elk,deer,rabbit,rabbits,stages,resting"] = process.argv.slice(2);
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const page = await browser.newPage({ viewport: { height: 1000, width: 1600 } });
page.on("pageerror", (error) => console.log("[pageerror]", error.message));
const winter = process.env.WINTER === "1";
for (const sheet of sheets.split(",")) {
  await page.goto(`${url}animal-showcase.html?sheet=${sheet}${winter ? "&winter=1" : ""}`);
  await page.waitForFunction(() => window.__sheetReady === true, null, { timeout: 120000 });
  const data = await page.evaluate(() => window.__sheetPng!());
  const name = winter ? `${sheet}-winter` : sheet;
  writeFileSync(`${outDir}/${name}.png`, Buffer.from(data.split(",")[1]!, "base64"));
  console.log("wrote", sheet);
}
await browser.close();
await server.close();
