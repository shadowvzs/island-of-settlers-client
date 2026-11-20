import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Island screenshots at arbitrary views with the fog lifted:
 * `npx tsx tools/bench/view-shots.ts name=x,z,zoom ...` (OUT_DIR, CINEMATIC=1,
 * QUERY=time=dawn for extra url parameters, WAIT_MS before the shot (default 1500),
 * CLEAN=1 hides the overlays,
 * CRITTERS=1 prints the live critters with their screen points).
 */
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/views";
const extraQuery = process.env.QUERY ? `&${process.env.QUERY}` : "";
const views = process.argv.slice(2).map((argument) => argument.split("="));
const waitMs = Number(process.env.WAIT_MS ?? 1500);
const HIDE_OVERLAYS = ".stats-overlay, .minimap, button { display: none !important; }";

const printCritters = async (page: Page) => {
  const critters = await page.evaluate(() => window.__listCritters?.() ?? []);
  for (const { name, screenX, screenY, x, z } of critters) {
    console.log(
      `  ${name} at ${x.toFixed(1)},${z.toFixed(1)} screen ${screenX | 0},${screenY | 0}`
    );
  }
};

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1600 } });
  page.on("pageerror", (error) => console.log("[pageerror]", error.message));
  page.on("console", (message) => {
    if (message.type() === "error") console.log("[browser]", message.text().slice(0, 600));
  });
  for (const [name, view] of views) {
    await page.goto(`${url}?view=${view}&reveal=1${extraQuery}`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
    if (process.env.CLEAN === "1") await page.addStyleTag({ content: HIDE_OVERLAYS });
    await page.waitForTimeout(waitMs);
    await page.screenshot({ path: join(outDir, `${name}.png`) });
    if (process.env.CRITTERS === "1") await printCritters(page);
    if (process.env.CINEMATIC === "1") {
      await page.keyboard.press("c");
      await page.waitForTimeout(800);
      await page.screenshot({ path: join(outDir, `${name}-cinematic.png`) });
    }
    console.log(name);
  }
  await browser.close();
  await server.close();
};

await main();
