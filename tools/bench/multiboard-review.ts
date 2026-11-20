import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Browser } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Captures the script multiboards (TRG8): the design's §14.4 board on the fixture review page
 * (`campaign-ui-review.html?view=multiboard`, fed by the real script engine), desktop and phone width, English and
 * Hungarian, expanded and collapsed, one and two boards, a countdown board with a timer window (EXT-TIMER); then
 * the board layer inside the real settlement HUD.
 * Run: npx tsx --env-file=<file with OUT=<folder> and optionally ONLY=<shot name prefix>>
 * tools/bench/multiboard-review.ts
 */
interface Shot {
  /** Header toggles to click, by board id, in order. */
  collapse?: readonly string[];
  height: number;
  name: string;
  /** Clicks on "Plant a tree" after the page opened (a live update of one dirty cell). */
  plant?: number;
  query: string;
  /** Clicks on "Pass a second" after the page opened (countdown cells and timer windows tick down). */
  seconds?: number;
  width: number;
}

const DESKTOP = { height: 800, width: 1280 };
const PHONE = { height: 844, width: 390 };
const SETTLE_MS = 350;
const IDLE_MS = 1000;
const GROVE = "var-3";
const ARMY = "var-4";

const SHOTS: Shot[] = [
  { ...DESKTOP, name: "grove-desktop-en", query: "lang=en" },
  { ...DESKTOP, name: "grove-desktop-hu", query: "lang=hu" },
  { ...DESKTOP, collapse: [GROVE], name: "grove-collapsed-desktop-en", query: "lang=en" },
  { ...DESKTOP, name: "grove-planted-desktop-en", plant: 2, query: "lang=en&planted=5" },
  { ...DESKTOP, name: "two-boards-desktop-en", query: "lang=en&boards=2" },
  { ...DESKTOP, name: "two-boards-desktop-hu-dark", query: "lang=hu&boards=2&theme=dark&scene=night" },
  { ...DESKTOP, collapse: [ARMY], name: "two-boards-one-collapsed-desktop-en", query: "lang=en&boards=2&scene=snow" },
  { ...DESKTOP, name: "countdown-desktop-hu", query: "lang=hu&timer=47", seconds: 2 },
  { ...PHONE, name: "grove-phone-en", query: "lang=en" },
  { ...PHONE, name: "grove-phone-hu", query: "lang=hu" },
  { ...PHONE, collapse: [GROVE], name: "grove-collapsed-phone-hu", query: "lang=hu" },
  { ...PHONE, name: "two-boards-phone-en", query: "lang=en&boards=2" },
  { ...PHONE, collapse: [ARMY], name: "two-boards-other-expanded-phone-hu", query: "lang=hu&boards=2" }
];

const only = process.env.ONLY ?? "";
const out = process.env.OUT ?? "/tmp/multiboard-review";

/** A fresh context per shot: the player's remembered header toggles (local storage) never leak between shots. */
const captureReviewShot = async (browser: Browser, url: string, shot: Shot) => {
  const context = await browser.newContext({ viewport: { height: shot.height, width: shot.width } });
  const page = await context.newPage();
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  await page.goto(`${url}campaign-ui-review.html?view=multiboard&${shot.query}`);
  await page.waitForSelector(".multiboard");
  for (let click = 0; click < (shot.plant ?? 0); click++) await page.click('[data-review="plant"]');
  for (let click = 0; click < (shot.seconds ?? 0); click++) await page.click('[data-review="second"]');
  for (const board of shot.collapse ?? []) await page.click(`[data-multiboard="${board}"] .multiboard__toggle`);
  await page.waitForTimeout(SETTLE_MS);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  const texts = await page.locator(".multiboard").allInnerTexts();
  await page.screenshot({ path: join(out, `${shot.name}.png`) });
  await page.locator(".multiboard-layer").screenshot({ path: join(out, `${shot.name}-close.png`) });
  console.log(`${shot.name}${overflow ? " (horizontal overflow!)" : ""}: ${JSON.stringify(texts)}`);
  await context.close();
};

/** The real settlement HUD on a blank page (no 3D scene): the layer mounts lazily when the feed gets boards. */
const captureHudShot = async (
  browser: Browser, url: string, name: string, viewport: typeof DESKTOP, tracker = false
) => {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  await page.route("**/multiboard-hud.html", route => route.fulfill({
    body: "<!doctype html><body style='margin:0;background:linear-gradient(#7fb6e0,#4d8a4a 60%,#2f6034)'>",
    contentType: "text/html"
  }));
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}multiboard-hud.html`);
  await page.evaluate(async () => {
    await import(/* @vite-ignore */ String("/src/app/styles.css"));
    const { createSettlementUi } = await import(/* @vite-ignore */ String("/src/app/settlement-ui/index.ts"));
    const ui = createSettlementUi({ onDemolishBuilding: () => true, onMinimap() {}, onRoadMode() {}, onRotate() {},
      onSelectBuilding() {}, onSettings() {} });
    ui.onIslandShown();
    ui.update({});
    const { createMultiboardReviewSession } = await import(
      /* @vite-ignore */ String("/src/campaign-ui-review/multiboard-review-session.ts"));
    createMultiboardReviewSession({ countdownSeconds: null, planted: 3, secondBoard: true });
  });
  await page.waitForSelector(".settlement-ui .multiboard-layer .multiboard");
  // The colony tracker shares the corner: its (empty) frame shown, the boards must sit below it.
  if (tracker) await page.evaluate(() => { document.querySelector<HTMLElement>(".colony-tracker")!.hidden = false; });
  await page.waitForTimeout(SETTLE_MS * 2);
  await page.screenshot({ path: join(out, `${name}.png`) });
  console.log(name);
  await context.close();
};

/** DOM mutations inside the stack over an idle second and after one event each (no per-frame work, dirty cells). */
const measureDomWork = async (browser: Browser, url: string) => {
  const context = await browser.newContext({ viewport: DESKTOP });
  const page = await context.newPage();
  await page.addInitScript("window.__name = value => value;");
  await page.goto(`${url}campaign-ui-review.html?view=multiboard&lang=en&boards=2`);
  await page.waitForSelector(`[data-multiboard="${ARMY}"]`);
  await page.evaluate(() => {
    const records: string[] = [];
    const describe = (record: MutationRecord) => {
      const element = record.target instanceof Element ? record.target : record.target.parentElement;
      return `${record.type}@${element?.closest("[data-multiboard]")?.getAttribute("data-multiboard") ?? "stack"}`;
    };
    new MutationObserver(list => records.push(...list.map(describe))).observe(
      document.querySelector(".multiboard-stack")!,
      { attributes: true, characterData: true, childList: true, subtree: true });
    Object.assign(window, { multiboardMutations: records });
  });
  const take = () => page.evaluate(() => (window as unknown as { multiboardMutations: string[] })
    .multiboardMutations.splice(0));
  await page.waitForTimeout(IDLE_MS);
  console.log(`dom work, idle ${IDLE_MS} ms: ${JSON.stringify(await take())}`);
  await page.click('[data-review="plant"]');
  await page.waitForTimeout(SETTLE_MS);
  console.log(`dom work, one tree planted: ${JSON.stringify(await take())}`);
  await page.click('[data-review="recruit"]');
  await page.waitForTimeout(SETTLE_MS);
  console.log(`dom work, one soldier recruited: ${JSON.stringify(await take())}`);
  await context.close();
};

mkdirSync(out, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const shot of SHOTS.filter(entry => entry.name.startsWith(only))) await captureReviewShot(browser, url, shot);
  if (!only) await measureDomWork(browser, url);
  if ("hud-desktop".startsWith(only)) await captureHudShot(browser, url, "hud-desktop", DESKTOP);
  if ("hud-phone".startsWith(only)) await captureHudShot(browser, url, "hud-phone", PHONE);
  if ("hud-tracker-desktop".startsWith(only)) await captureHudShot(browser, url, "hud-tracker-desktop", DESKTOP, true);
  if ("hud-tracker-phone".startsWith(only)) await captureHudShot(browser, url, "hud-tracker-phone", PHONE, true);
} finally {
  await browser.close();
  await server.close();
}
