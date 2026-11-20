import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Browser, Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Gem shop Military tab (light/dark, High/Minimal, a horse and sword purchase) and the portrait
 * sprite sheet at device pixel ratios 1, 1.5, 2 and 3: every sampled frame offset must land on
 * whole device pixels and frames must advance one by one. Close-ups compare the sheet with the
 * former 128 px strip when `OLD_STRIP_DIR` names a folder holding it.
 * Usage: OLD_STRIP_DIR=/path npx tsx tools/bench/shop-portrait-review.ts
 */
const saved = JSON.parse(readFileSync("/home/shadowvzs/Downloads/island-settlers-2026-10-11.json", "utf8"));
saved.player = { experience: 95, gems: 500, questDay: "", quests: [], seed: 1234, version: 1 };
const output = resolve("../resources/settlement-previews/shop-portraits");
mkdirSync(output, { recursive: true });
const shot = (name: string) => resolve(output, `${name}.png`);
const PIXEL_RATIOS = [1, 1.5, 2, 3];
const OLD_STRIP_FRAMES = 120;
/** Frames shown in the close-ups: the opening breathe and the raised wave. */
const CLOSE_UP_FRAMES = [0, 61];
const oldStripDirectory = process.env.OLD_STRIP_DIR;

const loadGame = async (browser: Browser, url: string, quality: string, deviceScaleFactor: number) => {
  const page = await browser.newPage({ deviceScaleFactor, viewport: { width: 1200, height: 850 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/hud-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto(`${url}hud-fixture.html`);
  await page.evaluate(async fixture => {
    localStorage.removeItem("island-of-settlers.portrait-hidden");
    localStorage.removeItem("island-of-settlers.hud-paper-theme");
    const { openLocalSaveStore } = await import(
      /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    const storage = await openLocalSaveStore();
    await storage.writeStartupGame(JSON.stringify(fixture));
  }, saved);
  await page.goto(`${url}?quality=${quality}`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 240000 });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.locator(".player-hud").waitFor({ state: "visible", timeout: 10000 });
  await page.waitForTimeout(1200);
  return { errors, page };
};

const pickHudMode = async (page: Page, mode: "light" | "dark") => {
  await page.locator(".hud-theme-toggle").click();
  await page.locator(`[data-hud-mode="${mode}"]`).click();
  await page.keyboard.press("Escape");
};

const openMilitaryTab = async (page: Page) => {
  await page.locator(".player-hud__gems").click();
  const shop = page.locator(".settlement-ui__gem-shop-window");
  await shop.waitFor({ state: "visible" });
  await shop.getByRole("tab", { name: "Military" }).click();
  await page.waitForTimeout(400);
  return shop;
};

const reviewMilitaryPurchase = async (page: Page) => {
  const shop = await openMilitaryTab(page);
  assert.equal(await shop.locator(".gem-shop__offer").count(), 7);
  const stock = () => page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const { horse = 0, sword = 0 } = simulation.headquarters.inventory;
    const stored = simulation.frames().filter((actor: any) =>
      actor.job === "Mount" && actor.phase === "horseStored" && actor.home === simulation.headquarters.uid).length;
    return { horse, stored, sword };
  });
  const before = await stock();
  await shop.locator('[data-offer-id="horse-5"] button').click();
  await shop.locator('[data-offer-id="sword-10"] button').click();
  const after = await stock();
  // A bred horse may walk in meanwhile; every stored horse must still be a real animal.
  assert.ok(after.horse >= before.horse + 5, "five bought horses in the headquarters");
  assert.equal(after.stored, after.horse);
  assert.equal(after.sword, before.sword + 10);
  assert.match(await page.locator(".player-hud__gems").innerText(), /^465$/);
  await shop.screenshot({ path: shot("high-shop-military-light") });
  await shop.getByRole("button", { name: "Close gem shop window" }).click();
  await pickHudMode(page, "dark");
  await page.waitForTimeout(300);
  await (await openMilitaryTab(page)).screenshot({ path: shot("high-shop-military-dark") });
  await page.getByRole("button", { name: "Close gem shop window" }).click();
  await pickHudMode(page, "light");
  return { after, before };
};

/**
 * Samples the live animation: offsets in device pixels and the frame order. Every frame change is
 * read when the timer writes it (MutationObserver), so a slow, busy machine cannot skip samples.
 */
const sampleAnimation = (page: Page, pixelRatio: number) => page.evaluate(ratio => new Promise<{
  frames: number[]; offsets: number[]; size: number;
}>(resolve => {
  const portrait = document.querySelector<HTMLElement>(".player-hud__portrait")!;
  const size = portrait.getBoundingClientRect().width;
  const frames: number[] = [], offsets: number[] = [];
  const read = () => {
    const [x, y] = getComputedStyle(portrait).backgroundPosition.split(",")[0]!.trim().split(" ").map(parseFloat);
    offsets.push(x! * ratio, y! * ratio);
    const frame = Math.round(-y! / size) * 10 + Math.round(-x! / size);
    if (frames.at(-1) !== frame) frames.push(frame);
  };
  const observer = new MutationObserver(read);
  observer.observe(portrait, { attributeFilter: ["style"] });
  read();
  setTimeout(() => { observer.disconnect(); resolve({ frames, offsets, size }); }, 2500);
}), pixelRatio);

const assertWholePixelSteps = (pixelRatio: number, sample: Awaited<ReturnType<typeof sampleAnimation>>) => {
  const fractional = sample.offsets.filter(offset => Math.abs(offset - Math.round(offset)) > .01);
  assert.deepEqual(fractional, [], `whole device pixel offsets at ${pixelRatio}x`);
  const skips = sample.frames.slice(1).filter((frame, index) => (frame - sample.frames[index]! + 120) % 120 !== 1);
  assert.ok(sample.frames.length >= 25, `frames advance at ${pixelRatio}x: ${sample.frames.length}`);
  assert.ok(skips.length <= 1, `frames step one by one at ${pixelRatio}x: ${sample.frames.join(",")}`);
};

/** Freezes one frame with inline styles: the new sheet, or the former single-row strip. */
const showFrame = (page: Page, frame: number, oldStrip?: string) => page.evaluate(({ frame, frames, oldStrip }) => {
  const portrait = document.querySelector<HTMLElement>(".player-hud__portrait")!;
  const size = portrait.getBoundingClientRect().width;
  const backdrop = portrait.style.backgroundImage.split("), ")[1]!;
  if (oldStrip) {
    portrait.style.backgroundImage = `url("${oldStrip}"), ${backdrop}`;
    portrait.style.backgroundSize = `${size * frames}px ${size}px, cover`;
    portrait.style.backgroundPosition = `${-frame * size}px 0, center`;
    return;
  }
  portrait.style.backgroundPosition = `${-(frame % 10) * size}px ${-Math.floor(frame / 10) * size}px, center`;
}, { frame, frames: OLD_STRIP_FRAMES, oldStrip });

const restorePortrait = (page: Page, sheet: string) => page.evaluate(sheetImage => {
  const portrait = document.querySelector<HTMLElement>(".player-hud__portrait")!;
  portrait.style.backgroundImage = sheetImage;
  portrait.style.removeProperty("background-size");
  portrait.style.removeProperty("background-position");
}, sheet);

const oldStripUrl = () => {
  if (!oldStripDirectory) return undefined;
  return `data:image/webp;base64,${readFileSync(resolve(oldStripDirectory, "roman.webp")).toString("base64")}`;
};

const reviewPortrait = async (page: Page, pixelRatio: number) => {
  const sample = await sampleAnimation(page, pixelRatio);
  assertWholePixelSteps(pixelRatio, sample);
  const portrait = page.locator(".player-hud__portrait");
  const sheet = await portrait.evaluate(element => (element as HTMLElement).style.backgroundImage);
  const oldStrip = oldStripUrl();
  for (const frame of CLOSE_UP_FRAMES) {
    await showFrame(page, frame);
    await page.waitForTimeout(150);
    await portrait.screenshot({ path: shot(`portrait-${pixelRatio}x-frame${frame}-sheet`) });
    if (!oldStrip) continue;
    await showFrame(page, frame, oldStrip);
    await page.waitForTimeout(300);
    await portrait.screenshot({ path: shot(`portrait-${pixelRatio}x-frame${frame}-old-strip`) });
    await restorePortrait(page, sheet);
  }
  await restorePortrait(page, sheet);
  return { frames: sample.frames.length, pixelRatio, size: sample.size };
};

const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports: unknown[] = [];
try {
  for (const quality of ["high", "minimal"]) {
    const { errors, page } = await loadGame(browser, url, quality, 1);
    if (quality === "high") reports.push({ purchase: await reviewMilitaryPurchase(page) });
    else await (await openMilitaryTab(page)).screenshot({ path: shot("minimal-shop-military-light") });
    assert.deepEqual(errors, []);
    await page.close();
  }
  for (const pixelRatio of PIXEL_RATIOS) {
    const { errors, page } = await loadGame(browser, url, "high", pixelRatio);
    reports.push(await reviewPortrait(page, pixelRatio));
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(output, JSON.stringify(reports));
