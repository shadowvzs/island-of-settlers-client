import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/** Felling sequence screenshots: seconds after the first swing -> file suffix. */
const MOMENTS: [number, string][] = [
  [0.45, "1-chopping"],
  [3.7, "2-falling"],
  [5.2, "3-fallen"],
  [8.5, "4-cleared"]
];

/** Island view (seed 1234 bookmark); OUT_DIR as in shots. */
const ISLAND_VIEW = process.env.VIEW ?? "168,200,2.6";
const outDir = process.env.OUT_DIR ?? "../docs/terrain-benchmarks/felling";

const captureSequence = async (page: Page, name: string, chop: () => Promise<void>) => {
  await page.screenshot({ path: join(outDir, `${name}-0-standing.png`) });
  await chop();
  const started = Date.now();
  for (const [seconds, suffix] of MOMENTS) {
    await page.waitForTimeout(Math.max(0, seconds * 1000 - (Date.now() - started)));
    await page.screenshot({ path: join(outDir, `${name}-${suffix}.png`) });
  }
  console.log(name, "done");
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
  await page.goto(`${url}?view=${ISLAND_VIEW}`);
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 120_000 });
  await page.waitForTimeout(1500);
  await captureSequence(page, "island", () => page.evaluate(() => window.__fellNearestTree?.()));
  await browser.close();
  await server.close();
};

await main();
