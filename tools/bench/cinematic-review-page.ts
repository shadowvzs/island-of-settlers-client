import type { Browser, Page } from "playwright-core";

import { stageStartupSave } from "./frame-profile";

/** Shared page helpers of the campaign cinematic review tools (CIN3 camera/player, CIN6 environment). */
type Hook = Record<string, (...args: unknown[]) => unknown>;

/** Calls `window.__cinematicTest[name](...args)` (the `?cinematicTest=1` dev hook). */
export const callHook = (page: Page, name: string, ...args: unknown[]) => page.evaluate(
  ([method, values]) => ((window as unknown as { __cinematicTest: Hook }).__cinematicTest[method as string]!)(
    ...(values as unknown[])), [name, args] as const);

/** Two frames after a seek so the pose, glint and overlay of that time are drawn. */
export const settleFrames = (page: Page) => page.evaluate(() => new Promise(done =>
  requestAnimationFrame(() => requestAnimationFrame(done))));

/** Mean frame cost over `durationMs` from the pass profiler (`passes=1`). */
export const measureFrames = async (page: Page, durationMs: number) => {
  await page.evaluate(() => (window as any).__frameProfiler.resetSession());
  await page.waitForTimeout(durationMs);
  const report = await page.evaluate(() => (window as any).__frameProfiler.sessionReport());
  const passes = report.passes as { drawCalls: number; triangles: number }[];
  return { cpuMs: report.frameCpuMs as number, drawCalls: passes.reduce((sum, pass) => sum + pass.drawCalls, 0),
    frames: report.frames, gpuMs: report.frameGpuMs as number | null,
    triangles: passes.reduce((sum, pass) => sum + pass.triangles, 0) };
};

export interface CinematicGameOptions {
  errors: string[];
  height: number;
  hour: string;
  quality: string;
  /** A startup save, or null for the fresh 128-cell seed-123 island. */
  saveText: string | null;
  width: number;
}

/** Opens the game with the dev hook on and waits until the island is shown and settled. */
export const openCinematicGame = async (browser: Promise<Browser>, url: string, options: CinematicGameOptions) => {
  const { errors, height, hour, quality, saveText, width } = options;
  const page = await (await browser).newPage({ viewport: { height, width } });
  page.on("pageerror", error => { errors.push(error.message); console.log(error.message); });
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
  if (saveText !== null) await stageStartupSave(page, url, saveText);
  const freshWorld = saveText === null ? "&reveal=1&size=128&seed=123" : "";
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1&passes=1&cinematicTest=1&time=${hour}` +
    freshWorld);
  await page.waitForFunction(() => window.__islandReady === true, null, { timeout: 180000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.waitForTimeout(6000);
  return page;
};
