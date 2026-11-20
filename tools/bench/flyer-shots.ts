import { mkdirSync } from "node:fs";
import { join } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Bird and butterfly specimen sheets (?flyers=1|2), overlays hidden:
 * `npx tsx tools/bench/flyer-shots.ts` (OUT_DIR, SHEETS=1,2, VIEW=x,z,zoom).
 */
const sheets = (process.env.SHEETS ?? "1").split(",");
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/flyers";
const view = process.env.VIEW ?? "116,216,3";
const HIDE_OVERLAYS = ".stats-overlay, .minimap, button { display: none !important; }";

const main = async () => {
  mkdirSync(outDir, { recursive: true });
  const { server, url } = await startDevServer();
  const browser = await launchBrowser();
  const page = await browser.newPage({ viewport: { height: 900, width: 1600 } });
  page.on("pageerror", (error) => console.log("[pageerror]", error.message));
  for (const sheet of sheets) {
    await page.goto(`${url}?view=${view}&reveal=1&flyers=${sheet}`);
    await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
    await page.addStyleTag({ content: HIDE_OVERLAYS });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: join(outDir, `flyers-${sheet}.png`) });
    console.log("sheet", sheet);
  }
  await browser.close();
  await server.close();
};

await main();
