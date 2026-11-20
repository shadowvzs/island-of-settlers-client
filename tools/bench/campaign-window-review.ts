import { mkdirSync } from "node:fs";
import { join } from "node:path";
import type { Page } from "playwright-core";

import {
  type CampaignCargo, type CampaignMap, createCampaign, createCampaignMap
} from "../../../island-of-settlers-shared/src/campaign/campaign-model";
import { launchBrowser, startDevServer } from "./browser";
import { PATHS_CAMPAIGN, PATHS_MAPS, pathsProgressAnswer } from "./campaign-paths-fixture";

/**
 * Captures the player's campaign window (C8) in the real game on a fresh home island: the bottom-bar launcher, the
 * map list with its lock state and the departure panel, with two ready fixture campaigns in the local campaign
 * store. A debug harbour with stock and one idle ship makes the first map ready to sail when the island has a coast
 * plot within reach; otherwise the window shows the "no harbour" refusal.
 * BR4: afterwards the branching fixture (campaign-paths-fixture.ts) replaces the window's content with the same
 * window component over a port that answers the fixture account's server progress (guests have no server), and the
 * list and the path graph are captured (`paths-*`).
 * Run: npx tsx --env-file=<file with OUT=<folder>, optionally LANGS=hu,en and QUALITY=high> \
 *   tools/bench/campaign-window-review.ts
 */
const DESKTOP = { height: 800, width: 1280 };
const READY_TIMEOUT_MS = 240_000;
const SETTLE_MS = 900;
const HARBOUR_TYPE_ID = 39;

const out = process.env.OUT ?? "/tmp/campaign-window-review";
const languages = (process.env.LANGS ?? "hu").split(",");
const quality = process.env.QUALITY ?? "high";

const cargo = (soldiers: number): CampaignCargo => ({
  goods: [{ amount: 20, ware: "planks" }, { amount: 10, ware: "stone" }, { amount: 4, ware: "bread" }],
  settlers: 3,
  soldiers: soldiers ? [{ amount: soldiers, type: "shield" }, { amount: 2, type: "archer" }] : []
});
const mapRecord = (id: string, campaignId: string, patch: Partial<CampaignMap>): CampaignMap =>
  ({ ...createCampaignMap(id, campaignId, { hash: null, id: `slot-${id}` }), state: "ready", ...patch });

/** Two ready campaigns: three maps (completed is server state, so guests see available + locked) and one map. */
const MAPS = [
  mapRecord("bay", "isles", { name: { en: "The Quiet Bay", hu: "A csendes öböl" }, requiredCargo: cargo(0),
    unlock: [] }),
  mapRecord("cliffs", "isles", { name: { en: "Cliffs of the North", hu: "Északi sziklák" },
    requiredCargo: cargo(8), unlock: [] }),
  mapRecord("fortress", "isles", { name: { en: "The Last Fortress", hu: "Az utolsó erőd" },
    requiredCargo: cargo(20), unlock: [{ kind: "previousMapCompleted" }, { kind: "playerLevel", level: 12 }] }),
  mapRecord("reef", "storm", { name: { en: "Storm Reef", hu: "Viharzátony" }, unlock: [] })
];
const CAMPAIGNS = [
  { ...createCampaign("isles"), mapIds: ["bay", "cliffs", "fortress"],
    name: { en: "The Northern Isles", hu: "Az északi szigetek" }, state: "ready" as const },
  { ...createCampaign("storm"), mapIds: ["reef"], name: { en: "Storm Season", hu: "Viharszezon" },
    state: "ready" as const }
];

const seedCampaigns = (page: Page) => page.evaluate(async ({ campaigns, maps }) => {
  const { openCampaignIndexedDbRepositories } = await import(
    /* @vite-ignore */ String("/src/app/campaign-storage/campaign-indexeddb-store.ts"));
  const repositories = await openCampaignIndexedDbRepositories();
  for (const kind of ["maps", "campaigns"] as const)
    for (const record of await repositories[kind].list()) await repositories[kind].delete(record.id, record.revision);
  for (const map of maps) await repositories.maps.create(map);
  for (const campaign of campaigns) await repositories.campaigns.create(campaign);
}, { campaigns: CAMPAIGNS, maps: MAPS });

/**
 * A finished debug harbour with the first map's goods and an idle ship: true, or the refusal counts when no coast
 * plot was found within reach of the headquarters.
 */
const prepareHarbour = (page: Page, typeId: number) => page.evaluate(harbourType => {
  const { simulation } = (window as any).__settlement;
  const home = simulation.headquarters, reasons: Record<string, number> = {};
  const RADIUS = 60, HALF_CELL_STEPS = 2;
  // Half-cell steps cover both grid snaps (odd and even footprints) without knowing the footprint here.
  for (let ring = 8; ring <= RADIUS * HALF_CELL_STEPS; ring++)
    for (let dz = -ring; dz <= ring; dz++) for (let dx = -ring; dx <= ring; dx++) {
      if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
      const placed = simulation.placeBuilding(harbourType, Math.floor(home.x) + dx / HALF_CELL_STEPS,
        Math.floor(home.z) + dz / HALF_CELL_STEPS);
      reasons[placed.reason ?? "ok"] = (reasons[placed.reason ?? "ok"] ?? 0) + 1;
      if (!placed.ok || !placed.building) continue;
      // Fixture only: the unconnected harbour gets its own idle settlers, so the settlers line reads ready.
      Object.assign(placed.building, { construction: 1, idleSettlers: 5, input: {}, required: {} });
      Object.assign(placed.building.inventory, { bread: 9, planks: 60, stone: 14 });
      simulation.debugEnsureFreeShips(placed.building.uid, 1);
      return true;
    }
  return reasons;
}, typeId);

const openGame = async (page: Page, url: string, language: string) => {
  await page.addInitScript("window.__name=value=>value;");
  await page.route("**/campaign-fixture.html", route =>
    route.fulfill({ body: "<body></body>", contentType: "text/html" }));
  await page.goto(`${url}campaign-fixture.html`);
  await page.evaluate(code => localStorage.setItem("island-of-settlers.language", code), language);
  await seedCampaigns(page);
  await page.goto(`${url}?quality=${quality}`);
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: READY_TIMEOUT_MS });
  await page.locator("#loading-screen").waitFor({ state: "detached" });
  await page.locator('[data-launcher-id="campaign"]').waitFor({ state: "visible", timeout: 20_000 });
};

/**
 * Mounts the campaign window component over the branching fixture into the open window's frame: the real content is
 * hidden, the fixture content is a sibling with the same classes, so frame, theme and styles are the game's.
 */
const mountPathsWindow = (page: Page) => page.evaluate(async ({ answer, campaign, maps }) => {
  const load = (path: string) => import(/* @vite-ignore */ String(path));
  const [{ createComponentMount }, { CampaignWindow }, { createCampaignWindowPort }, { createExternalStore }] =
    await Promise.all([load("/src/app/components/react-island.tsx"),
    load("/src/app/settlement-ui/campaign-window/campaign-window.tsx"),
    load("/src/app/settlement/campaign-window-port.ts"), load("/src/app/components/ui-store.ts")]);
  const original = document.querySelector<HTMLElement>(".settlement-ui__campaign-window .campaign-window")!;
  const host = document.createElement("div");
  host.className = original.className;
  original.hidden = true;
  original.after(host);
  const port = createCampaignWindowPort({ economy: { campaignProgress: async () => answer }, now: () => Date.now(),
    openRepositories: async () => ({ campaigns: { list: async () => [campaign] }, maps: { list: async () => maps } }),
    operation: () => null, readMap: async () => ({ error: "Fixture", loaded: null }),
    simulation: (window as any).__settlement.simulation, start: async () => "Fixture" });
  createComponentMount(CampaignWindow, { port, store: createExternalStore({ playerNation: "roman" }),
    visibility: createExternalStore({ opened: 1, visible: true }) })(host);
}, { answer: pathsProgressAnswer(), campaign: PATHS_CAMPAIGN, maps: PATHS_MAPS });

const capturePaths = async (page: Page, language: string) => {
  const campaignWindow = page.locator(".settlement-ui__campaign-window");
  await mountPathsWindow(page);
  const paths = campaignWindow.locator(".campaign-window:not([hidden])");
  await paths.locator('[data-campaign-map="mill"]').click();
  await page.waitForTimeout(SETTLE_MS);
  await page.screenshot({ path: join(out, `paths-desktop-${language}.png`) });
  await campaignWindow.screenshot({ path: join(out, `paths-list-crop-${language}.png`) });
  await paths.locator('[data-campaign-map="ford"]').click();
  await page.waitForTimeout(SETTLE_MS);
  console.log(`${language}: closed map depart disabled = ${await paths.locator("[data-campaign-depart]").isDisabled()}`);
  await campaignWindow.screenshot({ path: join(out, `paths-closed-crop-${language}.png`) });
  await paths.locator("[data-campaign-graph]").click();
  await page.waitForTimeout(SETTLE_MS);
  await campaignWindow.screenshot({ path: join(out, `paths-graph-crop-${language}.png`) });
};

mkdirSync(out, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
try {
  for (const language of languages) {
    const context = await browser.newContext({ viewport: DESKTOP });
    const page = await context.newPage();
    page.on("pageerror", error => console.error("[pageerror]", error.message));
    await openGame(page, url, language);
    console.log(`${language}: harbour ready = ${JSON.stringify(await prepareHarbour(page, HARBOUR_TYPE_ID))}`);
    await page.waitForTimeout(SETTLE_MS);
    await page.screenshot({ path: join(out, `launcher-desktop-${language}.png`) });
    await page.locator('[data-launcher-id="campaign"]').click();
    const campaignWindow = page.locator(".settlement-ui__campaign-window");
    await campaignWindow.locator(".campaign-window__maps").waitFor({ state: "visible", timeout: 20_000 });
    await page.waitForTimeout(SETTLE_MS + SETTLE_MS);
    await page.screenshot({ path: join(out, `window-ready-desktop-${language}.png`) });
    await campaignWindow.screenshot({ path: join(out, `window-ready-crop-${language}.png`) });
    await campaignWindow.locator('[data-campaign-map="cliffs"]').click();
    await page.waitForTimeout(SETTLE_MS + SETTLE_MS);
    await campaignWindow.screenshot({ path: join(out, `window-missing-crop-${language}.png`) });
    await campaignWindow.locator('[data-campaign-map="fortress"]').click();
    await page.waitForTimeout(SETTLE_MS + SETTLE_MS);
    await campaignWindow.screenshot({ path: join(out, `window-locked-crop-${language}.png`) });
    const depart = campaignWindow.locator("[data-campaign-depart]");
    console.log(`${language}: locked map depart disabled = ${await depart.isDisabled()}`);
    await capturePaths(page, language);
    await context.close();
  }
} finally {
  await browser.close();
  await server.close();
}
