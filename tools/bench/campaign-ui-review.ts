import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";

/**
 * Captures the campaign story panel (C11a) and the cinematic speaker panel (CIN5) on their fixture review page
 * (`campaign-ui-review.html`), plus the shared reward row (epilogue, gallery, settlement reward popups), desktop and
 * phone width, English and Hungarian, and measures one auto-advance.
 * Run: npx tsx --env-file=<file with OUT=<folder> and optionally ONLY=<shot name prefix>>
 * tools/bench/campaign-ui-review.ts
 */
interface Shot {
  clicks?: number;
  height: number;
  name: string;
  query: string;
  width: number;
}

const DESKTOP = { height: 800, width: 1280 };
const PHONE = { height: 844, width: 390 };
const PHONE_LANDSCAPE = { height: 390, width: 844 };
const SETTLE_MS = 450;
const POPUP_GUTTER_PX = 16;

const SHOTS: Shot[] = [
  { ...DESKTOP, name: "intro-desktop-en", query: "view=intro&lang=en" },
  { ...DESKTOP, name: "intro-replay-desktop-hu", query: "view=intro-replay&lang=hu" },
  { ...DESKTOP, clicks: 1, name: "intro-page2-desktop-hu", query: "view=intro&lang=hu" },
  { ...PHONE, name: "intro-phone-en", query: "view=intro&lang=en" },
  { ...PHONE, clicks: 1, name: "intro-page2-phone-hu", query: "view=intro&lang=hu" },
  { ...DESKTOP, name: "epilogue-success-desktop-en", query: "view=epilogue-success&lang=en" },
  { ...PHONE, name: "epilogue-success-phone-hu", query: "view=epilogue-success&lang=hu" },
  { ...DESKTOP, name: "epilogue-failure-desktop-hu", query: "view=epilogue-failure&lang=hu" },
  { ...PHONE, name: "epilogue-failure-phone-en", query: "view=epilogue-failure&lang=en" },
  { ...DESKTOP, name: "epilogue-pending-desktop-en", query: "view=epilogue-pending&lang=en&theme=dark" },
  { ...DESKTOP, name: "speaker-line1-desktop-en", query: "view=speaker&lang=en&hold=1" },
  { ...DESKTOP, clicks: 1, name: "speaker-line2-desktop-hu", query: "view=speaker&lang=hu&hold=1" },
  { ...DESKTOP, clicks: 2, name: "speaker-long-page1-desktop-hu", query: "view=speaker&lang=hu&hold=1&scene=snow" },
  { ...DESKTOP, clicks: 3, name: "speaker-long-page2-desktop-hu", query: "view=speaker&lang=hu&hold=1&scene=night" },
  { ...PHONE, name: "speaker-line1-phone-en", query: "view=speaker&lang=en&hold=1" },
  { ...PHONE, clicks: 1, name: "speaker-line2-phone-hu", query: "view=speaker&lang=hu&hold=1&scene=snow" },
  { ...PHONE, clicks: 3, name: "speaker-long-page2-phone-hu", query: "view=speaker&lang=hu&hold=1&theme=dark" },
  { ...PHONE_LANDSCAPE, clicks: 2, name: "speaker-long-page1-landscape-hu", query: "view=speaker&lang=hu&hold=1" },
  { ...DESKTOP, name: "speaker-fallback-desktop-en", query: "view=speaker-fallback&lang=en&hold=1&scene=night" },
  { ...DESKTOP, name: "speaker-actor-named-desktop-en", query: "view=speaker-actor&lang=en&hold=1" },
  { ...PHONE, name: "speaker-actor-named-phone-hu", query: "view=speaker-actor&lang=hu&hold=1&scene=night" },
  { ...DESKTOP, clicks: 1, name: "speaker-actor-default-desktop-en", query: "view=speaker-actor&lang=en&hold=1" },
  { ...DESKTOP, name: "settings-desktop-hu", query: "view=settings&lang=hu" },
  { ...DESKTOP, name: "rewards-epilogue-desktop-en", query: "view=epilogue-rewards&lang=en" },
  { ...PHONE, name: "rewards-epilogue-phone-hu", query: "view=epilogue-rewards&lang=hu" },
  { ...DESKTOP, name: "rewards-gallery-desktop-en", query: "view=reward-gallery&lang=en" },
  { ...PHONE, name: "rewards-gallery-phone-en", query: "view=reward-gallery&lang=en&theme=dark" },
  { ...DESKTOP, name: "rewards-adventure-popup-desktop-en", query: "view=reward-popup&lang=en" },
  { ...PHONE, name: "rewards-adventure-popup-phone-hu", query: "view=reward-popup&lang=hu" },
  { ...PHONE, name: "rewards-level-up-popup-phone-en", query: "view=level-up-popup&lang=en&scene=night" }
];

/** `ONLY=<prefix>` (env file) captures just the shots whose name starts with it. */
const only = process.env.ONLY ?? "";

/** Auto-advance: line 1 (70 characters) should change after 2000 + 70 × 60 = 6200 ms at the normal speed. */
const measureAutoAdvance = async (page: Page, url: string) => {
  await page.setViewportSize(DESKTOP);
  await page.goto(`${url}campaign-ui-review.html?view=speaker&lang=en`);
  await page.waitForSelector(".speaker-panel__text");
  const start = Date.now(), first = await page.textContent(".speaker-panel__text");
  await page.waitForFunction(`document.querySelector(".speaker-panel__text")?.textContent !== ${JSON.stringify(first)}`,
    null, { polling: "raf", timeout: 15_000 });
  const advanceMs = Date.now() - start;
  console.log(`auto-advance after ${advanceMs} ms (expected ≈ 6200 ms)`);
};

/**
 * A settlement popup card keeps the backdrop's 16 px gutter on both sides (390 px phones included): its measured
 * side gaps and the document's scroll width against the viewport; a smaller gap is flagged.
 */
const popupGutterNote = (page: Page) => page.evaluate(gutter => {
  const card = document.querySelector(".settlement-popup__dialog")?.getBoundingClientRect();
  if (!card) return "";
  const left = Math.round(card.left), right = Math.round(window.innerWidth - card.right);
  const note = ` popup gutter ${left}/${right} px, scrollWidth ${document.documentElement.scrollWidth}` +
    ` of ${window.innerWidth}`;
  return Math.min(left, right) < gutter ? `${note} (popup inside its gutter!)` : note;
}, POPUP_GUTTER_PX);

const out = process.env.OUT ?? "/tmp/campaign-ui-review";
mkdirSync(out, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  const page = await browser.newPage();
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  for (const shot of SHOTS.filter(entry => entry.name.startsWith(only))) {
    await page.setViewportSize({ height: shot.height, width: shot.width });
    await page.goto(`${url}campaign-ui-review.html?${shot.query}`);
    await page.waitForSelector(
      ".story-panel, .speaker-panel, .settings-panel, .review__reward-gallery, .settlement-popup__dialog");
    await page.waitForTimeout(SETTLE_MS);
    for (let click = 0; click < (shot.clicks ?? 0); click++) {
      const target = page.locator(".speaker-panel__advance, .story-panel .settlement-ui__button--primary").first();
      await target.click();
      await page.waitForTimeout(SETTLE_MS);
    }
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    await page.screenshot({ path: join(out, `${shot.name}.png`) });
    console.log(`${shot.name}${overflow ? " (horizontal overflow!)" : ""}${await popupGutterNote(page)}`);
  }
  if (!only) await measureAutoAdvance(page, url);
} finally {
  await browser.close();
  await server.close();
}
