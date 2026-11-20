/**
 * C12 captures: the Graphics tab with the Character detail slider moved (pending, ✓ enabled)
 * and after its ✓ tick (applied, ✓ disabled) on a desktop (1920x1080) and a phone (400x860)
 * viewport. The report logs the captions, the stored choice and that applying kept the page.
 *
 *   SAVE=<save.json> OUTPUT_DIR=<dir> npx tsx tools/bench/character-settings-captures.ts
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { stageStartupSave } from "./frame-profile";

const save = JSON.parse(readFileSync(process.env.SAVE!, "utf8"));
const environment = save.runtime.environment;
Object.assign(environment, { cycling: false, targetHour: environment.hour, weatherState: "clear" });
const saveText = JSON.stringify(save);
const output = resolve(process.env.OUTPUT_DIR!);
mkdirSync(output, { recursive: true });

const VIEWPORTS = [
  { height: 1080, name: "desktop-1920x1080", width: 1920 },
  { height: 860, name: "phone-400x860", width: 400 }
] as const;

const GRAPHICS_CONTENT =
  ".settings-panel:not([hidden]) .settings-panel__tab-content:not([hidden])";

const openIsland = async (url: string, viewport: { height: number; width: number }) => {
  const page = await browser.newPage({ viewport });
  page.on("pageerror", error => console.log("pageerror", error.message));
  await page.routeWebSocket("**/*", () => {});
  await page.addInitScript(() => { (window as any).__name = (value: unknown) => value; });
  await stageStartupSave(page, url, saveText);
  await page.goto(`${url}?quality=high&cache=0&skipLogin=1`);
  await page.waitForFunction(() => (window as any).__islandReady === true, null, { timeout: 240000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.waitForTimeout(2000);
  return page;
};

const openGraphicsTab = async (page: Page) => {
  await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.locator(".settings-panel:not([hidden])").getByRole("heading", { name: "Graphics" }).waitFor();
  await page.waitForTimeout(400);
};

/** The Character detail slider is the second range input of the Graphics tab. */
const characterSlider = (page: Page) =>
  page.locator(`${GRAPHICS_CONTENT} input[type='range']`).nth(1);

/** The Detail preset slider is the first range input of the Graphics tab. */
const detailSlider = (page: Page) =>
  page.locator(`${GRAPHICS_CONTENT} input[type='range']`).nth(0);

const characterApplyButton = (page: Page) =>
  page.locator(`${GRAPHICS_CONTENT} button[aria-label="Apply character detail"]`);

const readCharacterState = (page: Page) => page.evaluate((graphicsContent) => {
  const ranges = Array.from(document.querySelectorAll<HTMLInputElement>(
    `${graphicsContent} input[type='range']`
  )).filter(input => input.getClientRects().length > 0);
  const input = ranges[1];
  const apply = Array.from(document.querySelectorAll<HTMLButtonElement>(
    `${graphicsContent} button[aria-label="Apply character detail"]`
  )).find(button => button.getClientRects().length > 0);
  if (!input) return null;
  return {
    applyDisabled: apply?.disabled ?? null,
    caption: input.closest("label")?.textContent ?? "",
    max: input.max,
    min: input.min,
    step: input.step,
    stored: localStorage.getItem("island-of-settlers.graphics.character-detail"),
    value: input.value
  };
}, GRAPHICS_CONTENT);

/** Moves the slider like a keyboard user; React's range onChange sees the real input event. */
const moveCharacterSlider = async (page: Page) => {
  await characterSlider(page).focus();
  await page.keyboard.press("End");
  await page.waitForTimeout(300);
};

const captureViewport = async (url: string, viewport: typeof VIEWPORTS[number]) => {
  const page = await openIsland(url, viewport);
  await openGraphicsTab(page);
  const initial = await readCharacterState(page);
  await page.evaluate(() => { (window as any).__c12Marker = "kept"; });
  await moveCharacterSlider(page);
  const pending = await readCharacterState(page);
  await page.screenshot({ path: resolve(output, `${viewport.name}-character-detail-pending.png`) });
  await characterApplyButton(page).click();
  await page.waitForTimeout(300);
  const applied = await readCharacterState(page);
  const marker = await page.evaluate(() => (window as any).__c12Marker ?? null);
  const islandReady = await page.evaluate(() => (window as any).__islandReady === true);
  await page.screenshot({ path: resolve(output, `${viewport.name}-character-detail-applied.png`) });
  // Moving the Detail preset slider discards a pending Character detail choice (no capture).
  await characterSlider(page).focus();
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  const movedCharacter = await readCharacterState(page);
  await detailSlider(page).focus();
  await page.keyboard.press("Home");
  await page.waitForTimeout(300);
  const afterDetailMove = await readCharacterState(page);
  await page.close();
  return {
    afterDetailMove,
    applied,
    detailMoveResetCharacter: afterDetailMove?.applyDisabled === true &&
      afterDetailMove.caption === applied?.caption,
    initial,
    islandReady,
    liveApplyKeptPage: marker === "kept",
    movedCharacter,
    pending
  };
};

const { server, url } = await startDevServer();
const browser = await launchBrowser();
const report: Record<string, unknown> = { save: process.env.SAVE };
try {
  for (const viewport of VIEWPORTS) {
    report[viewport.name] = await captureViewport(url, viewport);
    console.log(viewport.name, "captured");
  }
  writeFileSync(resolve(output, "report.json"), JSON.stringify(report, null, 2));
} finally {
  await browser.close();
  await server.close();
}
