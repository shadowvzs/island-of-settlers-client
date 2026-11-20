import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { launchBrowser, startDevServer } from "./browser";
import { resourcesPath } from "./resources-path";

const item = "roadDecoration:indigenous-flower-pot:native";
const offerId = "road-decoration-indigenous-flower-pot-native";
const run = process.argv.find(argument => argument.startsWith("--run="))?.slice(6) ?? "initial";
if (!/^[a-z0-9-]+$/.test(run)) throw new Error("Invalid road interaction run name");
const output = resourcesPath("project-reviews", "road-decoration-interaction-2026-11-03", run);
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer(), browser = await launchBrowser();
const errors: string[] = [], rows: unknown[] = [];
let status = "failed";
let activePage: Page | undefined;
const count = (page: Page) => page.evaluate(item => (window as any).__settlement.playerSession.progress().inventory?.[item] ?? 0, item);
const inventory = async (page: Page) => {
  if (!await page.getByRole("button", { name: "Inventory", exact: true }).isVisible())
    await page.getByRole("button", { name: "Menu", exact: true }).click();
  await page.getByRole("button", { name: "Inventory", exact: true }).click();
  await page.getByRole("tab", { name: "Decoration", exact: true }).click();
  await page.locator(`[data-item-id="${item}"]`).click();
};
try {
  for (const quality of ["high", "minimal"] as const) {
    const steps: string[] = [], receipt = { quality, steps }; rows.push(receipt);
    console.log(`${quality}: booting actual guest game`);
    const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
    await context.addInitScript(quality => {
      (window as any).__name = (value: unknown) => value;
      localStorage.setItem("island-of-settlers.graphics.detail", quality);
      localStorage.setItem("island-of-settlers.graphics.resolution", "fast");
    }, quality);
    const page = await context.newPage(); activePage = page; page.on("pageerror", error => errors.push(error.message));
    await page.goto(`${url}admin.html?seed=123&size=96&forest=0&cache=0&time=day&terrainVariation=0`);
    await page.waitForFunction(() => Boolean((window as any).__islandReady && (window as any).__settlement?.playerSession), null, { timeout: 180000 });
    steps.push("booted");
    // Isolated guest fixture balance only; purchases below use the real displayed shop and private port.
    await page.evaluate(() => { const settlement = (window as any).__settlement; settlement.removeFog(); settlement.playerSession.progress().gems = 100; });
    await page.locator(".player-hud__gems").click();
    await page.getByRole("tab", { name: "Decorations", exact: true }).click();
    assert.equal(await page.getByRole("tab", { name: "Arches", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.locator('[data-offer-id^="road-decoration-"]').count(), 16);
    await page.getByRole("tab", { name: "Trees", exact: true }).click();
    assert.equal(await page.locator('[data-offer-id^="road-decoration-"]').count(), 0);
    await page.getByText("No decorations are available in this category yet.", { exact: true }).waitFor();
    await page.getByRole("tab", { name: "Lanterns", exact: true }).click();
    assert.equal(await page.locator('[data-offer-id^="road-decoration-"]').count(), 2);
    await page.getByRole("tab", { name: "Plants", exact: true }).click();
    assert.equal(await page.locator('[data-offer-id^="road-decoration-"]').count(), 2);
    steps.push("decoration-filters-and-honest-empty-trees");
    const offer = page.locator(`[data-offer-id="${offerId}"]`);
    await offer.getByRole("button").click();
    await page.waitForFunction(item => (window as any).__settlement.playerSession.progress().inventory?.[item] === 1, item);
    await offer.getByRole("button").click();
    await page.waitForFunction(item => (window as any).__settlement.playerSession.progress().inventory?.[item] === 2, item);
    assert.equal(await page.evaluate(() => (window as any).__settlement.playerSession.progress().gems), 90);
    await page.waitForFunction(() => document.querySelector('[data-toast-kind="success"] .app-toast__count')?.textContent === "×2");
    assert.equal(await page.locator('[data-toast-kind="success"]').count(), 1);
    const toastBounds = await page.locator('[data-toast-kind="success"]').evaluate(element => {
      const box = element.getBoundingClientRect(); return { width: box.width, height: box.height, right: box.right, bottom: box.bottom };
    });
    assert(toastBounds.width <= 301 && toastBounds.height <= 48, JSON.stringify(toastBounds));
    Object.assign(receipt, { toastBounds, twoAcceptedPurchasesOneDeduplicatedToastCountTwo: true });
    steps.push("bought-stack-two"); console.log(`${quality}: real shop stack purchased`);
    await page.screenshot({ path: resolve(output, `${quality}-stack-shop.png`) });
    await page.locator(".settlement-ui__gem-shop-window").getByRole("button", { name: /^Close .* window$/ }).click();
    await page.locator(".player-hud__gems").click();
    assert.equal(await page.getByRole("tab", { name: "Decorations", exact: true }).getAttribute("aria-selected"), "true");
    assert.equal(await page.getByRole("tab", { name: "Plants", exact: true }).getAttribute("aria-selected"), "true");
    await page.locator(".settlement-ui__gem-shop-window").getByRole("button", { name: /^Close .* window$/ }).click();
    const candidate = await page.evaluate(item => {
      const settlement = (window as any).__settlement, sim = settlement.simulation, hq = sim.buildings().find((row: any) => row.typeId === 0);
      const farFromRoads = (point: { x: number; z: number }) => sim.roadSegments().every((road: any) => {
        const dx = road.end.x - road.start.x, dz = road.end.z - road.start.z, length = dx * dx + dz * dz;
        const t = length ? Math.max(0, Math.min(1, ((point.x - road.start.x) * dx + (point.z - road.start.z) * dz) / length)) : 0;
        return Math.hypot(point.x - road.start.x - t * dx, point.z - road.start.z - t * dz) >= 3;
      });
      for (let radius = 4; radius <= 12; radius++) for (let dz = -radius; dz <= radius; dz++) for (const dx of [-radius, radius]) {
        const position = { x: Math.round((hq.x + dx) * 2) / 2, z: Math.round((hq.z + dz) * 2) / 2 };
        const order = { item, position, yaw: 0 };
        if (!farFromRoads(position)) continue;
        const plan = sim.planRoadDecoration(order); if (!plan.ok) continue;
        const point = settlement.projectGround(position.x, position.z);
        if (point && point.x > 420 && point.x < 1000 && point.y > 530 && point.y < 740)
          return { order, point, position: plan.position, offRoadDistanceAtLeast: 3 };
      }
      throw new Error("No real valid visible off-road owned terrain in guest fixture");
    }, item);
    Object.assign(receipt, { candidate });
    await inventory(page);
    await page.mouse.move(candidate.point.x, candidate.point.y);
    await page.waitForFunction(() => (window as any).__settlement.controls.roadDecorationGhost()?.valid === true);
    await page.keyboard.press("r");
    await page.waitForFunction(() => Math.abs((window as any).__settlement.controls.roadDecorationGhost()?.yaw - Math.PI / 4) < 1e-6);
    assert.equal(await count(page), 2);
    await page.screenshot({ path: resolve(output, `${quality}-ghost.png`) });
    await page.mouse.click(candidate.point.x, candidate.point.y, { button: "right" });
    assert.equal(await count(page), 2);
    assert.equal(await page.evaluate(() => (window as any).__settlement.isInteracting()), false);
    steps.push("right-click-cancel-keeps-stack");
    await inventory(page); await page.mouse.move(candidate.point.x, candidate.point.y);
    await page.waitForFunction(() => (window as any).__settlement.controls.roadDecorationGhost()?.valid === true);
    await page.keyboard.press("r");
    await page.mouse.click(candidate.point.x, candidate.point.y);
    await page.waitForFunction(() => (window as any).__settlement.simulation.roadDecorations().length === 1);
    assert.equal(await count(page), 1);
    steps.push("actual-ghost-click-consumed-one");
    assert(Math.abs(await page.evaluate(() => (window as any).__settlement.simulation.saveState().roadDecorations.placed[0].yaw) - Math.PI / 4) < 1e-6);
    // Reload the actual simulation save; UID/ownership survives without a second debit.
    await page.evaluate(() => { const sim = (window as any).__settlement.simulation, saved = sim.saveState();
      const loaded = sim.loadState(saved); if (!loaded.ok) throw new Error(loaded.reason); });
    assert.equal(await count(page), 1);
    steps.push("simulation-save-load-conserves");
    const hit = await page.evaluate(() => { const settlement = (window as any).__settlement, frame = settlement.simulation.roadDecorations()[0];
      return settlement.project(frame.position[0], frame.position[1] + .2, frame.position[2]); });
    Object.assign(receipt, { projectedHit: hit });
    assert(hit); await page.mouse.move(hit.x, hit.y); await page.waitForTimeout(200);
    assert.equal(await page.evaluate(point => (document.elementFromPoint(point.x, point.y) as HTMLElement)?.style.cursor, hit), "pointer");
    await page.screenshot({ path: resolve(output, `${quality}-hover.png`) });
    steps.push("actual-hover-cursor-and-outline"); await page.mouse.click(hit.x, hit.y);
    const panel = page.locator(".road-decoration-window:not([hidden])");
    await panel.getByRole("button", { name: "Pick up", exact: true }).waitFor();
    steps.push("ray-opened-real-panel");
    await page.screenshot({ path: resolve(output, `${quality}-pickup-panel.png`) });
    await panel.getByRole("button", { name: "Pick up", exact: true }).click();
    await page.waitForFunction(item => (window as any).__settlement.playerSession.progress().inventory?.[item] === 2, item);
    assert.equal(await page.evaluate(() => (window as any).__settlement.simulation.roadDecorations().length), 0);
    steps.push("unforced-panel-pickup-restores-one"); console.log(`${quality}: real pointer placement and panel pickup passed`);
    await inventory(page); await page.mouse.move(candidate.point.x, candidate.point.y);
    await page.waitForFunction(() => (window as any).__settlement.controls.roadDecorationGhost()?.valid === true);
    await page.mouse.click(candidate.point.x, candidate.point.y);
    await page.waitForFunction(() => (window as any).__settlement.simulation.roadDecorations().length === 1);
    const removal = await page.evaluate(() => {
      const sim = (window as any).__settlement.simulation, saved = structuredClone(sim.saveState().roadDecorations.placed);
      const position = saved[0].position;
      let edge = sim.roadSegments()[0];
      for (let offset = 2; !edge && offset <= 4; offset++) {
        sim.connectRoads({ x: position.x + offset, z: position.z - 1 }, { x: position.x + offset, z: position.z + 1 });
        edge = sim.roadSegments()[0];
      }
      if (!edge || !sim.removeRoad(edge.start, edge.end)) throw new Error("Fixture road deletion refused");
      return { saved, after: sim.saveState().roadDecorations.placed };
    });
    assert.deepEqual(removal.after, removal.saved); assert.equal(await count(page), 1);
    steps.push("road-removal-preserves-same-absolute-uid-item-position-yaw");
    const secondHit = await page.evaluate(() => { const settlement = (window as any).__settlement, frame = settlement.simulation.roadDecorations()[0];
      return settlement.project(frame.position[0], frame.position[1] + .2, frame.position[2]); });
    await page.mouse.click(secondHit.x, secondHit.y);
    await panel.getByRole("button", { name: "Pick up", exact: true }).click();
    await page.waitForFunction(item => (window as any).__settlement.playerSession.progress().inventory?.[item] === 2, item);
    steps.push("manual-pickup-after-road-removal-restores-one");
    Object.assign(receipt, { stackedPurchase: true, rightClickCancelKeepsItem: true, actualGhostClickConsumesOne: true,
      actualRayPickAndPanelReturnsOne: true, simulationSaveLoadConserves: true, freeOffRoadPlacement: true,
      keyboardRotation: true, roadRemovalKeepsSameIdentity: true, candidate });
    await context.close();
    activePage = undefined;
  }
  assert.deepEqual(errors, []); status = "passed";
} finally {
  if (status !== "passed" && activePage && !activePage.isClosed()) await activePage.screenshot({ path: resolve(output, "failure.png") }).catch(() => undefined);
  await browser.close(); await server.close();
  writeFileSync(resolve(output, "report.json"), JSON.stringify({ status, rows, errors,
    scope: "Real guest shop/inventory/ghost/pointer/ray-panel/save/road-removal integration in High and Minimal. Online authority separately covered by actual worker + disposable PostgreSQL; no full authenticated UI claim." }, null, 2));
}
