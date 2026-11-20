import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { openReviewPage, stageReviewSave } from "./water-review-page";

/**
 * Shell collecting check (SHORE-SHELLS): on the live owner save (High), focuses the explored home
 * shell nearest the headquarters, clicks it with the mouse, and records the collected count, the
 * old and new place and screenshots before / after at the old place and at the new place.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> [VIEWPORT=1920x1080] [ZOOM=4]
 */
const sourcePath = process.env.SAVE;
const outputDir = process.env.OUTPUT_DIR;
assert(sourcePath && outputDir, "Set SAVE and OUTPUT_DIR");
const [width, height] = (process.env.VIEWPORT ?? "1920x1080").split("x").map(Number) as [number, number];
const zoom = Number(process.env.ZOOM ?? 4);
mkdirSync(outputDir, { recursive: true });

const frames = (page: Page, count: number) => page.evaluate(async total => {
  for (let index = 0; index < total; index += 1) await new Promise(done => requestAnimationFrame(done));
}, count);

const focus = async (page: Page, point: { x: number; z: number }) => {
  await page.evaluate(({ point, zoom }) => (window as any).__settlement.focusGround(point.x, point.z, zoom),
    { point, zoom });
  await frames(page, 30);
};

/** The explored shell nearest the headquarters (index and place). */
const chooseShell = (page: Page) => page.evaluate(() => {
  const live = (window as any).__settlement, world = (window as any).__atmosphereLiveDebug.world;
  const home = live.simulation.home();
  const positions: { x: number; z: number }[] = live.simulation.shoreShellPositions();
  let best = null as null | { index: number; x: number; z: number };
  positions.forEach((position, index) => {
    if (world.fog[Math.floor(position.z) * world.cellsX + Math.floor(position.x)] < 1) return;
    const distance = Math.hypot(position.x - home.x, position.z - home.z);
    if (!best || distance < Math.hypot(best.x - home.x, best.z - home.z)) best = { index, ...position };
  });
  return best;
});

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = {};
try {
  const save = stageReviewSave(readFileSync(sourcePath, "utf8"));
  const { page } = await openReviewPage(browser, url, "high", save, { height, width });
  const shell = await chooseShell(page);
  assert(shell, "No explored shore shell");
  await focus(page, shell);
  await page.screenshot({ path: resolve(outputDir, "before.png") });
  const screen = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), shell);
  const collectedBefore = await page.evaluate(() => (window as any).__settlement.simulation.shoreShellsCollected());
  await page.mouse.click(screen.x, screen.y);
  await frames(page, 30);
  await page.screenshot({ path: resolve(outputDir, "after-old-place.png") });
  const after = await page.evaluate(index => {
    const simulation = (window as any).__settlement.simulation;
    return { collected: simulation.shoreShellsCollected(), place: simulation.shoreShellPositions()[index] };
  }, shell.index);
  Object.assign(report, { after, collectedBefore, screen, shell });
  await focus(page, after.place);
  await page.screenshot({ path: resolve(outputDir, "new-place.png") });
  console.log(JSON.stringify(report));
} finally {
  writeFileSync(resolve(outputDir, "report.json"), JSON.stringify(report, null, 2));
  await browser.close();
  await server.close();
}
