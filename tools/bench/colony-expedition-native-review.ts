import assert from "node:assert/strict";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const saved = JSON.parse(readFileSync("/home/shadowvzs/Downloads/island-settlers-2026-10-11.json", "utf8"));
// Isolated fixture: one idle ship in open water near the saved harbour; the owner save is never written.
// The saved half-built hull spot is too tight to turn in, so the ship starts on the nearest turnable cell.
saved.settlement.naval.sites = []; saved.settlement.naval.active = [];
saved.settlement.naval.fleet.ships = [{ id: 1, x: 188.5, z: 221.5, y: .18, yaw: 0,
  phase: "idle", cargoCount: 0, cargo: {}, route: [], cursor: 0, timer: 0 }];
saved.settlement.naval.fleet.nextShip = 2;
// NATION=viking|japanese|nubian reviews that nation's own ship loading at the harbour (default: the save's).
const nation = process.env.NATION;
if (nation) saved.settlement.playerNation = nation;
const output = resourcesPath("settlement-previews", "colony-expedition", nation ?? "");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const reports = [];
try {
  for (const quality of ["high", "minimal"]) {
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
    await page.goto(`${url}?quality=${quality}&view=176,193,2.4`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady), null, { timeout: 180000 });
    await page.locator("#loading-screen").waitFor({ state: "detached" });
    const harbour = await page.evaluate(() => {
      const settlement = (window as any).__settlement, simulation = settlement.simulation;
      simulation.startMilitaryTrainingEncounter();
      // Keep the shipwright's own building pier out of the dock review.
      for (const yard of simulation.buildings().filter((entry: any) => entry.typeId === 36))
        simulation.setShipyardMode(yard.uid, "boats");
      const building = simulation.buildings().find((entry: any) => entry.typeId === 39);
      Object.assign(building.inventory, { hammer: 1, planks: 20, shovel: 1, stone: 15 });
      settlement.focusGround(building.x, building.z);
      return { uid: building.uid, x: building.x, z: building.z };
    });
    await page.waitForTimeout(800);
    const point = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x, z), harbour);
    await page.mouse.click(point.x, point.y);
    const colonyButton = page.locator(`[data-harbour-colony="${harbour.uid}"]`).first();
    await colonyButton.waitFor({ state: "visible", timeout: 10000 });
    await colonyButton.click();
    const planner = page.getByRole("dialog", { name: "Colony expedition" });
    await planner.waitFor({ state: "visible" });
    await planner.locator('[data-colony-island="3"]').click();
    for (const [name, clicks] of [["More swordsmen", 6], ["More archers", 4], ["More cavalry", 2]] as const)
      for (let click = 0; click < clicks; click++) await planner.getByRole("button", { name, exact: true }).click();
    const plannerText = await planner.innerText();
    assert.match(plannerText, /12 \/ (20|35|50) troops/);
    assert.match(plannerText, /arrival ≈/);
    await planner.screenshot({ path: resolve(output, `${quality}-planner.png`) });
    await planner.getByRole("button", { name: "Start expedition", exact: true }).click();
    const tracker = page.getByRole("complementary", { name: "Colonies and expeditions" });
    await tracker.waitFor({ state: "visible" });
    await page.waitForFunction(uid => (document.querySelector(`[data-harbour-colony="${uid}"]`) as
      HTMLButtonElement | null)?.disabled === true, harbour.uid, { timeout: 5000 });
    await tracker.locator(".colony-tracker__summary").first().click();
    await page.waitForTimeout(700);
    await tracker.screenshot({ path: resolve(output, `${quality}-tracker-preparing.png`) });
    const loading = await page.evaluate(() => {
      const simulation = (window as any).__settlement.simulation;
      for (let second = 0; second < 400; second++) {
        const ship = simulation.ships()[0];
        if (ship?.phase === "loading" && ship.colony !== undefined) {
          const dock = simulation.shipSites().find((site: any) => site.kind === "dock");
          const work = dock?.workPier;
          (window as any).__settlement.focusGround(work ? (work.shore.x * 2 + work.point.x) / 3 : ship.x,
            work ? (work.shore.z * 2 + work.point.z) / 3 : ship.z);
          return { dock: Boolean(dock), ship: { x: ship.x, z: ship.z }, ware: dock?.porterWare };
        }
        simulation.update(1);
      }
      return { dock: false };
    });
    assert.equal(loading.dock, true, "A loading colony ship must show its harbour dock");
    await page.keyboard.press("Escape");
    await page.waitForTimeout(2500);
    await page.screenshot({ path: resolve(output, `${quality}-loading-dock.png`) });
    // The nation's own ship at the harbour while it loads.
    await page.evaluate(ship => (window as any).__settlement.focusGround(ship.x, ship.z), loading.ship!);
    await page.waitForTimeout(1500);
    await page.screenshot({ path: resolve(output, `${quality}-loading-ship.png`) });
    const departed = await page.evaluate(async () => {
      const simulation = (window as any).__settlement.simulation;
      for (let second = 0; second < 400; second++) {
        simulation.update(1);
        if (simulation.colonyExpeditions()[0]?.departed) return true;
      }
      const passengers = simulation.frames().filter((actor: any) => actor.navalOrder !== undefined)
        .map((actor: any) => `${actor.job}:${actor.phase}:${actor.home}`);
      return JSON.stringify({ expedition: simulation.colonyExpeditions()[0], ships: simulation.ships(),
        orders: simulation.seaOrders(), passengers });
    });
    assert.equal(departed, true, "Expedition must load and leave the map");
    await page.waitForTimeout(800);
    await tracker.screenshot({ path: resolve(output, `${quality}-tracker-sailing.png`) });
    await page.screenshot({ path: resolve(output, `${quality}-game.png`) });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.waitForTimeout(500);
    await page.screenshot({ path: resolve(output, `${quality}-phone.png`) });
    const status = await page.evaluate(() => (window as any).__settlement.simulation.colonyExpeditions()[0]);
    reports.push({ errors, quality, status });
    assert.deepEqual(errors, []);
    await page.close();
  }
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
} finally { await browser.close(); await server.close(); }
console.log(JSON.stringify(reports.map(report => ({ quality: report.quality, status: report.status.status,
  departed: report.status.departed, remaining: report.status.remainingSeconds })), null, 1));
