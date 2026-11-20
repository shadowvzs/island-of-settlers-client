import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";

const saved = JSON.parse(readFileSync("/home/shadowvzs/Downloads/island-settlers-2026-10-11.json", "utf8"));
// Isolated fixture: one idle ship in open water near the saved harbour; the owner save is never written.
saved.settlement.naval.sites = []; saved.settlement.naval.active = [];
saved.settlement.naval.fleet.ships = [{ id: 1, x: 188.5, z: 221.5, y: .18, yaw: 0,
  phase: "idle", cargoCount: 0, cargo: {}, route: [], cursor: 0, timer: 0 }];
saved.settlement.naval.fleet.nextShip = 2;
const output = resolve("../resources/settlement-previews/colony-visit");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const report: Record<string, unknown> = {};
const ready = async (page: import("playwright-core").Page) => {
  await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 240000 });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: 240000 });
};
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 850 } });
  const errors: string[] = [];
  page.on("pageerror", error => errors.push(error.message));
  page.on("console", message => { if (message.type() === "error") errors.push(message.text()); });
  await page.addInitScript("window.__name=value=>value;");
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/colony-fixture.html", route => route.fulfill({ contentType: "text/html", body: "<body></body>" }));
  await page.goto(`${url}colony-fixture.html`);
  await page.evaluate(async fixture => {
    const { openLocalSaveStore } = await import(
      /* @vite-ignore */ String("/src/app/save-store/local-save-store.ts"));
    const { settingsStorage } = await import(/* @vite-ignore */ String("/src/app/settings/graphics-settings.ts"));
    settingsStorage.writeFog(false);
    const storage = await openLocalSaveStore();
    await storage.writeStartupGame(JSON.stringify(fixture));
  }, saved);
  await page.goto(`${url}?quality=high`);
  await ready(page);
  const landed = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    simulation.startMilitaryTrainingEncounter();
    const harbour = simulation.buildings().find((entry: any) => entry.typeId === 39);
    Object.assign(harbour.inventory, { hammer: 1, planks: 20, shovel: 1, stone: 15 });
    const island = simulation.colonyIslands().find((entry: any) => entry.difficulty === "medium");
    const started = simulation.startColonyExpedition(harbour.uid, island.id, { archer: 4, cavalry: 2, shield: 6 });
    for (let second = 0; second < 2000 && simulation.colonyExpeditions()[0]?.status !== "arrived"; second++)
      simulation.update(1);
    return { island: island.name, started, status: simulation.colonyExpeditions()[0]?.status };
  });
  report.landed = landed;
  assert.equal(landed.status, "arrived");
  const visit = page.locator("[data-colony-visit]").first();
  await visit.waitFor({ state: "visible", timeout: 10000 });
  await page.locator(".colony-tracker").screenshot({ path: resolve(output, "home-colony-list.png") });
  await Promise.all([page.waitForEvent("load", { timeout: 60000 }), visit.click()]);
  await ready(page);
  // A colony island: 96×96, its harbour home, ore deposits and garrisoned enemy forts.
  const colony = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const forts = simulation.buildings().filter((building: any) => (building.militaryFaction ?? 0) > 0);
    const garrisoned = simulation.militarySoldiers().filter((soldier: any) => soldier.stationed &&
      soldier.combat?.faction > 0).length;
    return { colony: simulation.colony(), forts: forts.length, garrisoned, home: simulation.headquarters.typeId,
      inventory: simulation.headquarters.inventory, size: simulation.buildings().length,
      oreZones: simulation.surveyedDeposits().filter((zone: any) => zone.ore && zone.surveyed).length,
      stored: simulation.militaryStoredTroops().map((entry: any) => entry.count),
      world: Math.sqrt(simulation.territory().owned.length) };
  });
  report.colony = colony;
  assert.equal(colony.home, 39);
  assert.equal(colony.colony.status, "contested");
  assert.equal(colony.world, 96);
  assert(colony.forts > 0 && colony.garrisoned > 0, "Enemy forts must be garrisoned");
  assert(colony.oreZones > 0, "The colony must hold ore deposits for its mines");
  assert.deepEqual(colony.stored, [6, 0, 4, 2]);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: resolve(output, "colony-arrival.png") });
  const site = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation, home = simulation.headquarters;
    for (let radius = 6; radius < 20; radius++) for (let step = 0; step < 16; step++) {
      const angle = step * Math.PI / 8;
      // The 5 x 4 guardhouse centre sits on a half cell across and a whole cell along.
      const placed = simulation.placeBuilding(2, Math.round(home.x + Math.cos(angle) * radius) + .5,
        Math.round(home.z + Math.sin(angle) * radius));
      if (!placed.ok) continue;
      // Spend the landed stock so the site needs a supply ship from home.
      home.inventory.planks = 0; home.inventory.stone = 0;
      return placed.building.uid;
    }
    return null;
  });
  assert(site !== null, "A guardhouse site must fit near the colony harbour");
  await page.waitForFunction(() => (window as any).__settlement.simulation.ships().some((ship: any) => ship.visitor),
    null, { timeout: 120000 });
  await page.waitForTimeout(6000);
  const supply = await page.evaluate(() => (window as any).__settlement.simulation.ships()
    .find((ship: any) => ship.visitor));
  report.supplyShip = supply;
  await page.evaluate(({ x, z }) => (window as any).__settlement.focusGround(x, z), supply);
  await page.waitForTimeout(800);
  await page.screenshot({ path: resolve(output, "colony-supply-ship.png") });
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(output, "colony-build-menu.png") });
  await page.keyboard.press("Escape");
  const back = page.getByRole("button", { name: "Sail back to the home island", exact: true });
  await back.waitFor({ state: "visible", timeout: 10000 });
  await Promise.all([page.waitForEvent("load", { timeout: 60000 }), back.click()]);
  await ready(page);
  const home = await page.evaluate(() => {
    const settlement = (window as any).__settlement;
    return { home: settlement.simulation.headquarters.typeId,
      colonies: [...document.querySelectorAll("[data-colony-visit]")].map(button => button.textContent) };
  });
  report.home = home;
  assert.equal(home.home, 0);
  assert.equal(home.colonies.length, 1);
  await page.locator(".colony-tracker").screenshot({ path: resolve(output, "home-after-return.png") });
  const revisit = page.locator("[data-colony-visit]").first();
  await Promise.all([page.waitForEvent("load", { timeout: 60000 }), revisit.click()]);
  await ready(page);
  const revisited = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    const forts = simulation.buildings().filter((building: any) => (building.militaryFaction ?? 0) > 0);
    // Siege capture is covered headlessly; here every fort falls at once to review the outcome UI.
    for (const fort of forts) simulation.removeMilitaryScenarioBuilding(fort.uid);
    return { forts: forts.length, home: simulation.headquarters.typeId };
  });
  report.revisited = revisited;
  assert.equal(revisited.home, 39);
  const popup = page.locator(".settlement-popup__dialog");
  await popup.waitFor({ state: "visible", timeout: 10000 });
  assert.match(await popup.innerText(), /Island conquered!/);
  await page.screenshot({ path: resolve(output, "colony-conquered-popup.png") });
  await popup.getByRole("button", { name: "Build mines", exact: true }).click();
  await page.getByRole("button", { name: "Build", exact: true }).click();
  await page.getByRole("tab", { name: "Mines" }).click();
  await page.waitForTimeout(400);
  await page.screenshot({ path: resolve(output, "colony-mines-unlocked.png") });
  await page.keyboard.press("Escape");
  const storedBefore = 80 - 12;
  await page.locator(".colony-tracker__disband").first().click();
  await popup.waitFor({ state: "visible" });
  await popup.screenshot({ path: resolve(output, "colony-disband-confirm.png") });
  await Promise.all([page.waitForEvent("load", { timeout: 60000 }),
    popup.getByRole("button", { name: "Disband", exact: true }).click()]);
  await ready(page);
  await page.waitForTimeout(1200);
  const disbanded = await page.evaluate(() => {
    const simulation = (window as any).__settlement.simulation;
    return { home: simulation.headquarters.typeId, colonies: document.querySelectorAll("[data-colony-visit]").length,
      stored: simulation.militaryStoredTroops().reduce((sum: number, entry: any) => sum + entry.count, 0),
      taken: simulation.colonyIslands().filter((island: any) => island.taken).length };
  });
  report.disbanded = disbanded;
  assert.deepEqual({ ...disbanded, stored: undefined }, { colonies: 0, home: 0, stored: undefined, taken: 0 });
  assert.equal(disbanded.stored, storedBefore + 12);
  report.errors = errors;
  assert.deepEqual(errors, []);
} finally {
  writeFileSync(resolve(output, "review.json"), JSON.stringify(report, null, 2));
  await browser.close(); await server.close();
}
console.log(JSON.stringify(report, null, 1).slice(0, 1500));
