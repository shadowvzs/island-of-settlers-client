import { writeFileSync } from "node:fs";

import { launchBrowser, startDevServer } from "../bench/browser";
import { resourcesPath } from "../bench/resources-path";

/**
 * Offline only: renders the original Japanese sail dragon (an SDF sculpt ray marched on the GPU, cel
 * shaded, inked along material and depth edges, over original cloud wisps) into
 * assets/textures/ships/japanese-sail-dragon-{high,minimal}.webp and a review image in resources/.
 * Usage: npx tsx tools/assets/japanese-sail-dragon.ts   (PREVIEW=1 skips the assets; SIZE=1024 is faster)
 */
const renderSize = Number(process.env.SIZE ?? 2048);

const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/dragon.html", route => route.fulfill({ contentType: "text/html", body: "<body>" }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}dragon.html`);
  const started = performance.now();
  const result = await page.evaluate(async size => {
    const module = await import(/* @vite-ignore */ String("/tools/assets/japanese-sail-dragon-page.ts"));
    return module.renderSailDragon(size) as { high: string; minimal: string; review: string };
  }, renderSize);
  console.log(`rendered ${renderSize}px in ${Math.round(performance.now() - started)} ms`);
  writeFileSync(resourcesPath("settlement-previews", "nation-ships", "japanese-sail-dragon-render.png"),
    Buffer.from(result.review, "base64"));
  if (process.env.PREVIEW !== "1") {
    writeFileSync("assets/textures/ships/japanese-sail-dragon-high.webp", Buffer.from(result.high, "base64"));
    writeFileSync("assets/textures/ships/japanese-sail-dragon-minimal.webp", Buffer.from(result.minimal, "base64"));
  }
} finally { await browser.close(); await server.close(); }
