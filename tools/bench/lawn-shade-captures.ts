/**
 * OD-T4 lawn-depth captures: the same view with the Lawn depth Graphics option Off, Normal and
 * Strong, as a contact sheet per quality and the Graphics tab with the select. The option is set
 * through the stored Graphics overrides before the island loads, so the captures exercise the real
 * setting path (no shader patches).
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> FOCUS=x,z [QUALITIES=high,minimal] [VIEWS=iso1]
 *   [SCOUT="x,z;x,z"] npx tsx tools/bench/lawn-shade-captures.ts
 *
 * SCOUT captures one Off iso zoom-1 image per listed point (to choose a meadow) and exits.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { LAWN_DEPTHS, type LawnDepth } from "../../src/render-common/quality";
import { launchBrowser, startDevServer } from "./browser";
import {
  enterPossessedView, installFrameProfiler, readFrameProfile, resetFrameProfile, stageStartupSave
} from "./frame-profile";

const OVERRIDES_KEY = "island-of-settlers.graphics.overrides";
const save = JSON.parse(readFileSync(process.env.SAVE!, "utf8"));
const environment = save.runtime.environment;
// Freeze the sky so every option sees the same light.
Object.assign(environment, { cycling: false, targetHour: environment.hour, weatherState: "clear" });
const saveText = JSON.stringify(save);
const output = resolve(process.env.OUTPUT_DIR!);
const qualities = (process.env.QUALITIES ?? "high,minimal").split(",");
const views = (process.env.VIEWS ?? "iso1").split(",");
const parsePoint = (text: string) => { const [x, z] = text.split(",").map(Number); return { x: x!, z: z! }; };
const focus = parsePoint(process.env.FOCUS ?? "0,0");
mkdirSync(output, { recursive: true });

/** Stores the Lawn depth override the Graphics select would write; the preset default needs none. */
const stageLawnDepth = (page: Page, depth: LawnDepth) => page.addInitScript(({ key, value }) => {
  localStorage.setItem(key, JSON.stringify({ lawnDepth: value }));
}, { key: OVERRIDES_KEY, value: depth });

const openIsland = async (url: string, quality: string, depth: LawnDepth) => {
  const page = await browser.newPage({ viewport: { height: 900, width: 1400 } });
  page.on("pageerror", error => console.log("pageerror", error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
  await installFrameProfiler(page);
  await stageLawnDepth(page, depth);
  await stageStartupSave(page, url, saveText);
  await page.goto(`${url}?quality=${quality}&cache=0&skipLogin=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.waitForTimeout(3000);
  return page;
};

const setIsoCamera = async (page: Page, point: { x: number; z: number }, zoom: number) => {
  await page.evaluate(({ point, zoom }) => Object.assign((window as any).__ownerCamera,
    { centerX: point.x, centerZ: point.z, tilt: 0, yaw: 0, zoom }), { point, zoom });
  await page.waitForTimeout(1800);
};

const measureFrames = async (page: Page) => {
  await resetFrameProfile(page);
  await page.waitForTimeout(6000);
  const { stats } = await readFrameProfile(page);
  return { cpuMs: stats.cpuMs, fps: stats.averageFps, gpuMs: stats.gpuMs };
};

const captureIso = async (page: Page, name: string, path: string) => {
  await setIsoCamera(page, focus, Number(name.slice(3)));
  await page.screenshot({ path });
};

/** The Graphics tab as the player sees it, with the Lawn depth select beside Colour precision. */
const captureGraphicsTab = async (page: Page, path: string) => {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-panel:not([hidden])").getByRole("heading", { name: "Graphics" }).waitFor();
  await page.waitForTimeout(500);
  await page.screenshot({ path });
};

const captureOption = async (
  url: string, quality: string, depth: LawnDepth, captureTab: boolean
) => {
  const page = await openIsland(url, quality, depth);
  const frames: Record<string, unknown> = {};
  const isoViews = views.filter(view => view.startsWith("iso"));
  for (const view of isoViews)
    await captureIso(page, view, resolve(output, `${quality}-${view}-${depth}.png`));
  if (isoViews.length) { await setIsoCamera(page, focus, 1); frames.iso1 = await measureFrames(page); }
  if (captureTab) await captureGraphicsTab(page, resolve(output, `graphics-tab-${quality}.png`));
  if (views.includes("possessed") || views.includes("spyglass")) {
    await enterPossessedView(page);
    await page.screenshot({ path: resolve(output, `${quality}-possessed-${depth}.png`) });
    frames.possessed = await measureFrames(page);
  }
  if (views.includes("spyglass")) {
    await page.evaluate(() => (window as any).__exploration.controller.toggleSpyglass());
    await page.waitForTimeout(2500);
    await page.screenshot({ path: resolve(output, `${quality}-spyglass-${depth}.png`) });
    frames.spyglass = await measureFrames(page);
  }
  await page.close();
  return frames;
};

const contactSheet = async (quality: string, view: string) => {
  const page = await browser.newPage({ viewport: { height: 600, width: 2100 } });
  const cell = (depth: LawnDepth) => `<figure style="margin:0"><figcaption style="height:40px;line-height:40px;padding-left:10px">
    ${quality} ${view} - ${depth}</figcaption><img style="display:block;width:700px"
    src="data:image/png;base64,${readFileSync(resolve(output, `${quality}-${view}-${depth}.png`)).toString("base64")}"></figure>`;
  await page.setContent(`<body style="margin:0;background:#111;color:#eee;font:18px sans-serif">
    <div style="display:flex">${LAWN_DEPTHS.map(cell).join("")}</div></body>`);
  await page.screenshot({ fullPage: true, path: resolve(output, `sheet-${quality}-${view}.png`) });
  await page.close();
};

const scout = async (url: string) => {
  const page = await openIsland(url, "minimal", "off");
  for (const [index, text] of process.env.SCOUT!.split(";").entries()) {
    await setIsoCamera(page, parsePoint(text), 1);
    await page.screenshot({ path: resolve(output, `scout-${index}-${text.replace(",", "_")}.png`) });
  }
  await page.close();
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = { focus, save: process.env.SAVE, options: LAWN_DEPTHS };
try {
  if (process.env.SCOUT) await scout(url);
  else for (const quality of qualities) {
    for (const [index, depth] of LAWN_DEPTHS.entries()) {
      const captureTab = quality === qualities[0] && index === LAWN_DEPTHS.length - 1;
      report[`${quality}-${depth}`] = await captureOption(url, quality, depth, captureTab);
      console.log(quality, depth, JSON.stringify(report[`${quality}-${depth}`]));
    }
    for (const view of views.filter(view => view.startsWith("iso"))) await contactSheet(quality, view);
    writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
  }
} finally { await browser.close(); await server.close(); }
