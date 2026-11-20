import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import { LEGACY_SIM_RULES, type SimRules } from "../../../island-of-settlers-shared/src/game-settings/sim-rules";
import { launchBrowser, startDevServer } from "./browser";

/**
 * Captures the player corner under every row of the progression visibility table (plan §9.4, owner Q10, lane PROG)
 * in the real game on a fresh home island: the island adopts each rule set through the recorded `adoptGameRules`,
 * then the corner is captured. The map-fixed row overrides the island's effective level rule in the page (no shipped
 * map fixes a level yet). With rewards off the quest book is captured too (no reward chips).
 * Run: npx tsx --env-file=<file with OUT=<folder>, optionally LANGS=hu,en and QUALITIES=high,minimal> \
 *   tools/bench/progression-ui-review.ts
 */
const DESKTOP = { height: 800, width: 1280 };
const HUD_CLIP = { height: 380, width: 460, x: 0, y: 0 };
const READY_TIMEOUT_MS = 240_000;
const SETTLE_MS = 900;

const out = process.env.OUT ?? "/tmp/progression-ui-review";
const languages = (process.env.LANGS ?? "hu").split(",");
const qualities = (process.env.QUALITIES ?? "high").split(",");

const rules = (name: string, change: Partial<SimRules>): SimRules =>
  ({ ...LEGACY_SIM_RULES, ...change, revision: `review-${name}` });

interface ReviewState {
  /** The level rule a map would impose (page override); absent: the adopted rules alone. */
  mapLevel?: number;
  name: string;
  questBook?: boolean;
  rules: SimRules;
}

const STATES: ReviewState[] = [
  { name: "1-progression-on", rules: rules("on", {}) },
  { name: "2-experience-off", rules: rules("xp-off", { experience: false }) },
  { name: "3-progression-off", rules: rules("off",
    { experience: false, level: { kind: "fixed", level: 50 }, talents: false }) },
  { name: "4-talents-off", rules: rules("talents-off", { talents: false }) },
  { mapLevel: 5, name: "5-map-fixed-level", rules: rules("map-level", {}) },
  { name: "6-rewards-off", questBook: true, rules: rules("rewards-off", { rewards: false }) }
];

const openGame = async (page: Page, url: string, language: string, quality: string) => {
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/progression-fixture.html", route =>
    route.fulfill({ body: "<body></body>", contentType: "text/html" }));
  await page.goto(`${url}progression-fixture.html`);
  await page.evaluate(code => localStorage.setItem("island-of-settlers.language", code), language);
  await page.goto(`${url}?quality=${quality}`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: READY_TIMEOUT_MS });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.locator(".player-hud").waitFor({ state: "visible", timeout: 20_000 });
};

/** Some earned levels, so the bar and the level number are not the fresh game's 1 / empty. */
const earnLevels = async (page: Page) => {
  await page.evaluate(() => (window as any).__settlement.addDebugLevels());
  const popup = page.locator(".settlement-popup__dialog");
  await popup.waitFor({ state: "visible", timeout: 10_000 });
  await popup.locator("button").last().click();
  await page.locator(".settlement-popup").waitFor({ state: "hidden", timeout: 10_000 });
};

const applyState = (page: Page, state: ReviewState) => page.evaluate(({ mapLevel, rules: adopted }) => {
  const { simulation } = (window as any).__settlement;
  const original = simulation.__reviewRules ??= simulation.effectiveGameRules;
  simulation.effectiveGameRules = original;
  const result = simulation.adoptGameRules(adopted);
  if (mapLevel !== undefined)
    simulation.effectiveGameRules = () => ({ ...original(), level: { kind: "capped", level: mapLevel } });
  return result;
}, { mapLevel: state.mapLevel, rules: state.rules });

const captureQuestBook = async (page: Page, path: string) => {
  await page.locator('[data-ui-anchor="hud.quests"]').click();
  const questWindow = page.locator(".settlement-ui__quest-window");
  await questWindow.waitFor({ state: "visible" });
  await page.waitForTimeout(SETTLE_MS);
  await questWindow.screenshot({ path });
};

const main = async () => {
  mkdirSync(out, { recursive: true });
  const { server, url } = await startDevServer({ unlockAll: false });
  const browser = await launchBrowser();
  try {
    for (const language of languages) for (const quality of qualities) {
      const page = await browser.newPage({ viewport: DESKTOP });
      await openGame(page, url, language, quality);
      await earnLevels(page);
      for (const state of STATES) {
        const adopted = await applyState(page, state);
        if (adopted !== true) throw new Error(`${state.name}: ${adopted}`);
        await page.waitForTimeout(SETTLE_MS);
        const base = join(out, `${language}-${quality}-${state.name}`);
        await page.screenshot({ clip: HUD_CLIP, path: `${base}.png` });
        if (state.questBook) await captureQuestBook(page, `${base}-quests.png`);
        console.log(`captured ${base}`);
      }
      await page.close();
    }
  } finally {
    await browser.close();
    await server.close();
  }
};

await main();
