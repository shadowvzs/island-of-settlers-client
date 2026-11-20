import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Browser, Page } from "playwright-core";

import { GAME_SETTINGS_PRESETS } from "../../../island-of-settlers-shared/src/game-settings/game-settings";
import { launchBrowser, startDevServer } from "./browser";

/**
 * The game cursor set in the real page: the title menu, the HUD, the open map, a hovered building and an army
 * order mode, on High and Minimal. Headless screenshots carry no cursor, so each shot reads the cursor the page
 * actually resolves at the mouse (`getComputedStyle(...).cursor`: image and hotspot) and draws that image at the
 * mouse point. Also checks the System cursor setting and the text cursor in inputs.
 * Run: npx tsx --env-file=<file with OUT=<folder>> tools/bench/cursor-game-review.ts
 */
const out = process.env.OUT ?? "/tmp/cursor-game-review";
const VIEWPORT = { height: 800, width: 1280 };

interface ResolvedCursor { file: string; hotspot: [number, number]; raw: string }

/** The cursor CSS resolves for the element under (x, y): its 1x image and hotspot, or the keyword. */
const resolveCursor = (page: Page, x: number, y: number) => page.evaluate(([px, py]) => {
  const element = document.elementFromPoint(px!, py!);
  const raw = element ? getComputedStyle(element).cursor : "";
  const image = raw.match(/url\("?([^")]+?\/cursors\/[\w-]+?)(?:@2x)?\.png"?\)/);
  const hotspot = raw.match(/\)\s+(\d+)\s+(\d+)\s*(?:,|$)/);
  const file = image ? `${image[1]}.png` : "";
  return { file, hotspot: [Number(hotspot?.[1] ?? 0), Number(hotspot?.[2] ?? 0)], raw };
}, [x, y]) as Promise<ResolvedCursor>;

/** Moves the mouse, waits for hover work, then saves the screenshot with the resolved cursor drawn in. */
const shot = async (page: Page, name: string, x: number, y: number, armyCursor?: string) => {
  await page.mouse.move(x, y);
  await page.waitForTimeout(400);
  // The military controls refresh the mode each frame; set it right before reading, as an armed order would.
  if (armyCursor) {
    await page.evaluate(mode => {
      document.querySelector<HTMLElement>("#view")!.dataset.armyCursor = mode;
    }, armyCursor);
  }
  const cursor = await resolveCursor(page, x, y);
  const screenshot = (await page.screenshot()).toString("base64");
  const composed = await page.evaluate(async ({ cursor: { file, hotspot }, png, px, py }) => {
    const load = (src: string) => new Promise<HTMLImageElement>((resolve, reject) => {
      const image = new Image(); image.onload = () => resolve(image); image.onerror = reject; image.src = src;
    });
    const base = await load(`data:image/png;base64,${png}`);
    const canvas = document.createElement("canvas");
    canvas.width = base.width; canvas.height = base.height;
    const context = canvas.getContext("2d")!;
    context.drawImage(base, 0, 0);
    if (file) context.drawImage(await load(file), px - hotspot[0], py - hotspot[1]);
    return canvas.toDataURL("image/png").split(",")[1]!;
  }, { cursor, png: screenshot, px: x, py: y });
  writeFileSync(join(out, `${name}.png`), Buffer.from(composed, "base64"));
  console.log(`${name} @${x},${y}: ${cursor.file ? cursor.file.split("/").pop() : "(no image)"} ${cursor.hotspot.join(" ")}` +
    ` | ${cursor.raw.slice(0, 90)}`);
};

const center = async (page: Page, selector: string) => {
  const box = await page.locator(selector).first().boundingBox();
  if (!box) throw new Error(`${selector} not visible`);
  return { x: Math.round(box.x + box.width / 2), y: Math.round(box.y + box.height / 2) };
};

const captureTitle = async (browser: Browser, url: string) => {
  const context = await browser.newContext({ viewport: VIEWPORT });
  await context.route("**/game-settings.json", route => route.fulfill({ json: GAME_SETTINGS_PRESETS.story }));
  const page = await context.newPage();
  await page.addInitScript("window.__name=value=>value;");
  await page.goto(`${url}?login=1`);
  await page.locator(".title-page__panel").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(1200);
  const entry = await center(page, ".title-page__panel button:not(:disabled)");
  await shot(page, "title-menu-pointer", entry.x, entry.y);
  await shot(page, "title-menu-default", 160, 640);
  const inputCursor = await page.evaluate(() => {
    const input = document.body.appendChild(document.createElement("input"));
    const cursor = getComputedStyle(input).cursor;
    input.remove();
    return cursor;
  });
  console.log(`text input cursor: ${inputCursor}`);
  await page.evaluate(() => document.documentElement.setAttribute("data-system-cursor", ""));
  await shot(page, "title-menu-system-cursor", entry.x, entry.y);
  await context.close();
};

/** Searches a grid around the screen centre for a point where the map picking shows the hover pointer. */
const findHoverTarget = async (page: Page) => {
  for (let ring = 0; ring < 9; ring++) {
    for (let step = 0; step < 16; step++) {
      const angle = step / 16 * Math.PI * 2;
      const x = Math.round(VIEWPORT.width / 2 + Math.cos(angle) * ring * 34);
      const y = Math.round(VIEWPORT.height / 2 + Math.sin(angle) * ring * 34);
      await page.mouse.move(x, y);
      await page.waitForTimeout(140);
      const hovered = await page.evaluate(() => document.querySelector("#view")?.getAttribute("style")
        ?.includes("--cursor-pointer"));
      if (hovered) return { x, y };
    }
  }
  return null;
};

const captureGame = async (browser: Browser, url: string, quality: string) => {
  const page = await browser.newPage({ viewport: VIEWPORT });
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${url}?quality=${quality}&seed=123&size=128&reveal=1&cache=0&time=day`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 180_000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 60_000 });
  await page.waitForTimeout(1500);
  const hudButton = await center(page, ".settlement-ui__hud-host button:visible");
  await shot(page, `${quality}-hud-pointer`, hudButton.x, hudButton.y);
  await shot(page, `${quality}-map-default`, 360, 520);
  const target = await findHoverTarget(page);
  if (target) await shot(page, `${quality}-map-building-pointer`, target.x, target.y);
  else console.log(`${quality}: no hoverable map object found near the centre`);
  await shot(page, `${quality}-map-army-attack`, 700, 460, "attack");
  await shot(page, `${quality}-map-army-board`, 700, 460, "board");
  await page.close();
};

mkdirSync(out, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  await captureTitle(browser, url);
  for (const quality of ["high", "minimal"]) await captureGame(browser, url, quality);
} finally { await browser.close(); await server.close(); }
