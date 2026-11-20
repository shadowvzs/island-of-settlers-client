import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { fightFieldBattle as fightCamps } from "./island-battle-helpers";

/**
 * Native adventure review: harbour planner, voyage, first visit (a generated 96×96 island without
 * buildings: the troops land by gangway from an anchored ship, field camps hold the island), a
 * real field battle, the victory popup, then the reward ship and survivors at home.
 * `QUALITY=minimal` reviews the low detail level.
 */
const saved = JSON.parse(readFileSync("/home/shadowvzs/Downloads/island-settlers-2026-10-11.json", "utf8"));
// Isolated fixture: one idle ship in open water near the saved harbour; the owner save is never written.
saved.settlement.naval.sites = []; saved.settlement.naval.active = [];
saved.settlement.naval.fleet.ships = [{ id: 1, x: 188.5, z: 221.5, y: .18, yaw: 0,
  phase: "idle", cargoCount: 0, cargo: {}, route: [], cursor: 0, timer: 0 }];
saved.settlement.naval.fleet.nextShip = 2;
const quality = process.env.QUALITY ?? "high";
const output = process.env.OUTPUT ?? "/home/shadowvzs/personal/island of settlers/game/resources/adventures-2026-10-12";
mkdirSync(output, { recursive: true });
const shot = (name: string) => resolve(output, `${quality}-${name}.png`);
const { server, url } = await startDevServer(), browser = await launchBrowser();
const report: Record<string, unknown> = { quality };
type Page = import("playwright-core").Page;
const ready = async (page: Page) => {
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 600000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 600000 });
};
const reload = async (page: Page, click: () => Promise<void>) => {
  await Promise.all([page.waitForEvent("load", { timeout: 120000 }), click()]);
  await ready(page);
};

try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors: string[] = [];
  report.errors = errors;
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/adventure-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto(`${url}adventure-fixture.html`);
  await page.evaluate(async fixture => {
    const { openLocalSaveStore } = await import(
      /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    const { settingsStorage } = await import(/* @vite-ignore */ String("/src/app/settings/graphics-settings.ts"));
    settingsStorage.writeFog(false);
    const storage = await openLocalSaveStore();
    await storage.writeStartupGame(JSON.stringify(fixture));
  }, saved);
  await page.goto(`${url}?quality=${quality}&view=176,193,2.4`);
  await ready(page);

  // 1. Harbour panel: the Adventure expedition button opens the planner.
  const harbour = await page.evaluate(() => {
    const settlement = (window as any).__settlement, simulation = settlement.simulation;
    simulation.startMilitaryTrainingEncounter();
    const building = simulation.buildings().find((entry: any) => entry.typeId === 39);
    settlement.focusGround(building.x, building.z);
    return { stored: simulation.militaryStoredTroops().reduce((sum: number, entry: any) => sum + entry.count, 0),
      uid: building.uid, x: building.x, z: building.z };
  });
  await page.waitForTimeout(800);
  const point = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), harbour);
  await page.mouse.click(point.x, point.y);
  const adventureButton = page.locator(`[data-harbour-adventure="${harbour.uid}"]`).first();
  await adventureButton.waitFor({ state: "visible", timeout: 10000 });
  await page.screenshot({ path: shot("harbour-actions") });
  await adventureButton.click();
  const planner = page.locator(".settlement-ui__colony-planner-window").filter({ hasText: "Adventure expedition" });
  await planner.waitFor({ state: "visible" });
  const easy = await page.evaluate(() => (window as any).__settlement.simulation.adventureIslands()
    .find((island: any) => island.difficulty === "easy"));
  await planner.locator(`[data-colony-island="${easy.id}"]`).click();
  for (const [name, clicks] of [["More swordsmen", 8], ["More axemen", 6], ["More archers", 6]] as const)
    for (let click = 0; click < clicks; click++) await planner.getByRole("button", { name, exact: true }).click();
  const plannerText = await planner.innerText();
  assert.match(plannerText, /20 \/ 20 troops/);
  assert.match(plannerText, /XP/);
  await planner.screenshot({ path: shot("planner") });
  await planner.getByRole("button", { name: "Start expedition", exact: true }).click();
  await page.waitForFunction(uid => (document.querySelector(`[data-harbour-adventure="${uid}"]`) as
    HTMLButtonElement | null)?.disabled === true, harbour.uid, { timeout: 5000 });
  const tracker = page.getByRole("complementary", { name: "Colonies and expeditions", exact: true });
  await tracker.waitFor({ state: "visible" });

  // 2. Voyage: troops board, the ship leaves the map and lands them.
  const sailed = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    for (let second = 0; second < 2000 && simulation.colonyExpeditions()[0]?.status !== "arrived"; second++)
      simulation.update(1);
    return simulation.colonyExpeditions()[0];
  });
  report.sailed = { island: sailed.island, status: sailed.status };
  assert.equal(sailed.status, "arrived");
  const visit = page.locator("[data-adventure-visit]").first();
  await visit.waitFor({ state: "visible", timeout: 10000 });
  await tracker.screenshot({ path: shot("home-tracker-landed") });

  // 3. First visit: a generated island without buildings; the troops land by gangway.
  await reload(page, () => visit.click());
  const arrival = await page.evaluate(() => {
    const settlement = (window as any).__settlement, simulation = settlement.simulation;
    const camp = simulation.militarySoldiers().find((soldier: any) => soldier.combat?.faction && !soldier.stationed);
    const campActor = simulation.frames().find((actor: any) => actor.uid === camp?.actor);
    const landing = simulation.adventure()?.landing;
    settlement.focusGround(landing.shore.x, landing.shore.z);
    return { adventure: simulation.adventure(), allows: simulation.allowsBuilding(2), camp: campActor &&
      { x: campActor.x, z: campActor.z }, docks: simulation.shipSites().filter((site: any) => site.kind === "dock")
      .length, home: simulation.home()?.typeId ?? null, size: simulation.buildings().length };
  });
  report.arrival = arrival;
  assert.equal(arrival.home, null);
  assert.equal(arrival.size, 0);
  assert.equal(arrival.docks, 1);
  assert.equal(arrival.adventure.status, "contested");
  assert.equal(arrival.allows, false);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("adventure-gangway-landing") });
  await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z), arrival.camp);
  await page.waitForTimeout(1200);
  await page.screenshot({ path: shot("enemy-camp") });

  // 4. Battle: an open land fight against the field camps.
  report.camps = await fightCamps(page);
  await page.waitForTimeout(800);
  await page.screenshot({ path: shot("after-field-battle") });
  const popup = page.locator(".settlement-popup__dialog");
  await popup.waitFor({ state: "visible", timeout: 15000 });
  const popupText = await popup.innerText();
  report.popup = popupText;
  assert.match(popupText, /Adventure won!/);
  assert.match(popupText, /XP/);
  await page.screenshot({ path: shot("victory-popup") });

  // 5. Home: the island is discarded, survivors and the reward ship arrive, new offers appear.
  await reload(page, () => popup.getByRole("button", { name: "Sail home", exact: true }).click());
  await page.waitForTimeout(1200);
  const home = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { adventures: document.querySelectorAll("[data-adventure-visit]").length, expeditions:
      simulation.colonyExpeditions().length, home: simulation.headquarters.typeId,
    offers: simulation.adventureIslands().map((island: any) => island.id),
    rewardShip: simulation.ships().find((ship: any) => ship.visitor),
    stored: simulation.militaryStoredTroops().reduce((sum: number, entry: any) => sum + entry.count, 0) };
  });
  report.home = home;
  assert.equal(home.home, 0);
  assert.equal(home.adventures, 0);
  assert.equal(home.expeditions, 0);
  assert(home.rewardShip, "The reward ship must sail to the home harbour");
  assert(home.offers.every((id: number) => id >= 100), "A new set of adventures must be offered");
  await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z), home.rewardShip);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: shot("reward-ship") });
  const unloaded = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const harbour = simulation.buildings().find((entry: any) => entry.typeId === 39);
    const before = harbour.inventory.coins ?? 0;
    for (let second = 0; second < 400 && simulation.ships().some((ship: any) => ship.visitor); second++)
      simulation.update(1);
    return { coinsAfter: harbour.inventory.coins ?? 0, coinsBefore: before,
      visitorLeft: !simulation.ships().some((ship: any) => ship.visitor) };
  });
  report.unloaded = unloaded;
  const player = await page.evaluate(async () => {
    const { openLocalSaveStore } = await import(/* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    return (await (await openLocalSaveStore()).readSavedGame())?.player ?? null;
  });
  report.experience = { after: player?.experience, before: saved.player?.experience ?? 0 };
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(resolve(output, `${quality}-review.json`), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
console.log(JSON.stringify(report, null, 1).slice(0, 3000));
