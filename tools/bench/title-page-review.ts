import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrowserContext, Page } from "playwright-core";

import { createCampaign, createCampaignMap } from "../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  cloneGameSettings, DEFAULT_ONLINE_SETTINGS, GAME_SETTINGS_PRESETS, type GameSettings
} from "../../../island-of-settlers-shared/src/game-settings/game-settings";
import { launchBrowser, startDevServer } from "./browser";

/**
 * Captures the title page (GS3b) per settings combination in the real page: offline without a home (menu,
 * campaigns, settings, the landing dialog after a won map, a deployer background by convention), online without a
 * home (browser-only play), offline with a home and online with a home (the game menu before play, owner
 * 2026-11-13), on desktop and phone. The bundled settings file is answered by
 * a route; `?login=1` keeps the automated browser from booting as a tool run. Also logs whether a world exists
 * behind the title page (JS heap, `__islandReady`) and the page width at phone size. `ADMIN=1` shows the menus as a
 * signed-in administrator sees them (no backend runs here: the served access module answers "admin").
 * Run: npx tsx --env-file=<file with OUT=<folder>, optionally LANGS=hu,en, PORT=5263, ONLY=online-home and
 *   ADMIN=1> tools/bench/title-page-review.ts
 */
const DESKTOP = { height: 800, width: 1280 };
const PHONE = { height: 844, width: 390 };
const SETTLE_MS = 1200;
const out = process.env.OUT ?? "/tmp/title-page-review";
const languages = (process.env.LANGS ?? "hu").split(",");
const port = Number(process.env.PORT ?? 5263);
/** Comma-separated capture names; absent = every capture. */
const only = process.env.ONLY?.split(",");
const asAdmin = process.env.ADMIN === "1";
const BACKGROUND = readFileSync(new URL("../../src/app/assets/island-voyage-viking.webp", import.meta.url));

const onlineWithoutHome = (): GameSettings => {
  const settings = cloneGameSettings(DEFAULT_ONLINE_SETTINGS);
  settings.start = { place: "campaignSelect" };
  settings.afterMap = "exitChoice";
  return settings;
};
const mapRecord = (id: string, name: string, unlock: ReturnType<typeof createCampaignMap>["unlock"]) => ({
  ...createCampaignMap(id, "isles", { hash: null, id: `slot-${id}` }), name: { en: name }, state: "ready" as const,
  unlock
});
const MAPS = [
  mapRecord("bay", "The Quiet Bay", []),
  mapRecord("cliffs", "Cliffs of the North", [{ kind: "previousMapCompleted" }]),
  mapRecord("fortress", "The Last Fortress", [{ kind: "previousMapCompleted" }])
];
const CAMPAIGN = { ...createCampaign("isles"), mapIds: ["bay", "cliffs", "fortress"],
  name: { en: "The Northern Isles" }, state: "ready" as const };

/** The local editor records (offered in development builds) and, optionally, a won first map in the slot. */
const seed = (page: Page, won: boolean) => page.evaluate(async ({ campaign, maps, won: wonMap }) => {
  const load = (path: string) => import(/* @vite-ignore */ String(path));
  const { openCampaignIndexedDbRepositories } = await load("/src/app/campaign-storage/campaign-indexeddb-store.ts");
  const repositories = await openCampaignIndexedDbRepositories();
  for (const kind of ["maps", "campaigns"] as const)
    for (const record of await repositories[kind].list()) await repositories[kind].delete(record.id, record.revision);
  for (const map of maps) await repositories.maps.create(map);
  await repositories.campaigns.create(campaign);
  if (!wonMap) return;
  const [{ openLocalSaveStore }, { createPlayerProgress }] = await Promise.all([
    load("/src/app/save-store/local-save-store.ts"), load("/src/shared/progression/player-progress.ts")]);
  const store = await openLocalSaveStore("offline.story");
  const campaignProgress = { isles: { bay: { exit: "victory" } } };
  await store.endRunWithoutHome({ ...createPlayerProgress(7), campaignProgress });
  sessionStorage.setItem("island-title-landing",
    JSON.stringify({ before: {}, campaignId: "isles", status: "won" }));
}, { campaign: CAMPAIGN, maps: MAPS, won });

/** The development build's guest reads as a signed-in administrator (the title page's admin entries). */
const routeAdminAccess = (context: BrowserContext) =>
  context.route("**/src/app/development-access.ts*", async route => {
    const response = await route.fetch();
    const body = (await response.text()).replaceAll('"guest-dev-build"', '"admin"');
    await route.fulfill({ body, response });
  });

const routeSettings = async (context: BrowserContext, settings: GameSettings, background: boolean) => {
  await context.route("**/game-settings.json", route => route.fulfill({ json: settings }));
  await context.route("**/title/title-background.webp", route => (background
    ? route.fulfill({ body: BACKGROUND, contentType: "image/webp" })
    : route.fulfill({ body: "missing", contentType: "text/html" })));
};

const openTitle = async (page: Page, url: string, language: string, won = false) => {
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/title-fixture.html",
    route => route.fulfill({ body: "<body></body>", contentType: "text/html" }));
  await page.goto(`${url}title-fixture.html`);
  await page.evaluate(code => localStorage.setItem("island-of-settlers.language", code), language);
  await seed(page, won);
  await page.goto(`${url}?login=1`);
  await page.locator(".title-page__panel").waitFor({ state: "visible", timeout: 60_000 });
  await page.waitForTimeout(SETTLE_MS);
};

/** No world behind the title page: no island flag, the heap, the widest element against the viewport. */
const logPageFacts = async (page: Page, label: string) => {
  const facts = await page.evaluate(() => ({
    heapMb: Math.round(((performance as any).memory?.usedJSHeapSize ?? 0) / 1e6),
    islandReady: Boolean((window as any).__islandReady),
    scrollWidth: document.documentElement.scrollWidth,
    viewport: window.innerWidth
  }));
  console.log(`${label}: ${JSON.stringify(facts)}`);
};

const shot = (page: Page, name: string) => page.screenshot({ path: join(out, `${name}.png`) });

const captureStory = async (context: BrowserContext, url: string, language: string) => {
  const page = await context.newPage();
  page.on("pageerror", error => console.error("[pageerror]", error.message));
  await openTitle(page, url, language);
  await logPageFacts(page, `story-${language}`);
  await shot(page, `story-menu-desktop-${language}`);
  await page.locator('[data-title-entry="campaigns"]').click();
  await page.locator(".campaign-window__maps").waitFor({ state: "visible", timeout: 20_000 });
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, `story-campaigns-desktop-${language}`);
  await page.locator('[data-campaign-map="cliffs"]').click();
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, `story-campaigns-locked-desktop-${language}`);
  await page.locator(".title-page__back").click();
  await page.locator('[data-title-entry="settings"]').click();
  await page.waitForTimeout(SETTLE_MS);
  await shot(page, `story-settings-desktop-${language}`);
  await page.close();
};

const captureLanding = async (context: BrowserContext, url: string, language: string) => {
  const page = await context.newPage();
  await openTitle(page, url, language, true);
  await page.locator(".title-page__dialog").waitFor({ state: "visible", timeout: 20_000 });
  await shot(page, `story-landing-desktop-${language}`);
  await page.close();
};

const capture = async (url: string, language: string, settings: GameSettings, name: string, background = false) => {
  if (only && !only.includes(name)) return;
  const browser = await launchBrowser();
  try {
    for (const [size, viewport] of [["desktop", DESKTOP], ["phone", PHONE]] as const) {
      const context = await browser.newContext({ viewport });
      await routeSettings(context, settings, background);
      if (asAdmin) await routeAdminAccess(context);
      const page = await context.newPage();
      page.on("pageerror", error => console.error("[pageerror]", error.message));
      await openTitle(page, url, language);
      await logPageFacts(page, `${name}-${size}-${language}`);
      await shot(page, `${name}-menu-${size}-${language}`);
      if (name === "story" && size === "desktop") {
        await captureStory(context, url, language);
        await captureLanding(context, url, language);
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }
};

mkdirSync(out, { recursive: true });
const { server, url } = await startDevServer({ port });
try {
  for (const language of languages) {
    await capture(url, language, GAME_SETTINGS_PRESETS.story, "story");
    await capture(url, language, onlineWithoutHome(), "online-story");
    await capture(url, language, GAME_SETTINGS_PRESETS.offlineSettlement, "offline-home");
    await capture(url, language, DEFAULT_ONLINE_SETTINGS, "online-home");
    await capture(url, language, GAME_SETTINGS_PRESETS.story, "story-background", true);
  }
} finally {
  await server.close();
}
