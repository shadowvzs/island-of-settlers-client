import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Wind quality test (plant brief): two frames 0.7 s apart in strong wind and a difference image
 * (moved pixels red). Roots, stem bases and seed head attachments must stay grey.
 * `npx tsx tools/bench/wind-shots.ts x,z,zoom` (OUT_DIR, QUERY=garden=1 for the plant garden).
 */
const view = process.argv[2] ?? "164,212,5";
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/wind";
const extraQuery = process.env.QUERY ? `&${process.env.QUERY}` : "";

/** Runs in the page (as a string, so the bundler adds no helpers): red where frames differ. */
const DIFF_SCRIPT = (first: string, second: string) => `(async () => {
  const load = (data) => new Promise((resolve) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.src = "data:image/png;base64," + data;
  });
  const [a, b] = await Promise.all([load("${first}"), load("${second}")]);
  const canvas = Object.assign(document.createElement("canvas"), { height: a.height, width: a.width });
  const context = canvas.getContext("2d");
  context.drawImage(a, 0, 0);
  const pixels = context.getImageData(0, 0, a.width, a.height);
  context.drawImage(b, 0, 0);
  const next = context.getImageData(0, 0, a.width, a.height).data;
  const data = pixels.data;
  for (let i = 0; i < data.length; i += 4) {
    const change = Math.abs(data[i] - next[i]) + Math.abs(data[i + 1] - next[i + 1]) +
      Math.abs(data[i + 2] - next[i + 2]);
    const grey = (data[i] + data[i + 1] + data[i + 2]) / 6;
    data[i] = change > 40 ? 255 : grey;
    data[i + 1] = change > 40 ? 0 : grey;
    data[i + 2] = change > 40 ? 0 : grey;
  }
  context.putImageData(pixels, 0, 0);
  return canvas.toDataURL("image/png").split(",")[1];
})()`;

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1600 } });
  await page.goto(`${url}?view=${view}&reveal=1&rain=1${extraQuery}`);
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  const first = (await page.screenshot()).toString("base64");
  await page.waitForTimeout(700);
  const second = (await page.screenshot()).toString("base64");
  const diff = (await page.evaluate(DIFF_SCRIPT(first, second))) as string;
  writeFileSync(join(outDir, "wind.png"), Buffer.from(diff, "base64"));
  writeFileSync(join(outDir, "frame.png"), Buffer.from(first, "base64"));
  console.log("done");
  await browser.close();
  await server.close();
};

await main();
