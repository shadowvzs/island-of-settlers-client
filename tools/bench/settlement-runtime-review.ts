import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Page } from "playwright-core";

import { getBuildingDefinition } from "../../src/render-common/buildings/building-catalog";
import { launchBrowser, startDevServer } from "./browser";

const output = resolve("../resources/settlement-previews/runtime");
mkdirSync(output, { recursive: true });
const { server, url } = await startDevServer();
const browser = await launchBrowser();
const reports: unknown[] = [];

const selectBuilding = async (page: Page, id: number, rotation: "keyboard" | "button") => {
  await page.getByRole("button", { name: "Build", exact: true }).click();
  if (id === 28) await page.getByRole("tab", { name: "Large buildings", exact: true }).click();
  await page.locator(`[data-building="${id}"]`).click();
  if (rotation === "keyboard") {
    await page.locator("canvas").first().focus();
    await page.keyboard.press("r");
  } else {
    do {
      await page.getByRole("button", { name: "Rotate selected building", exact: true }).click();
    } while ((await page.evaluate(() => (window as any).__settlement.controls.rotation())) !== 1);
  }
  if (await page.getByRole("button", { name: "Close settlement window", exact: true }).isVisible())
    await page.getByRole("button", { name: "Close settlement window", exact: true }).click();
  assert.equal(await page.evaluate(() => (window as any).__settlement.controls.rotation()), 1);
};

const candidate = async (page: Page, id: number, rotation: number) => {
  const [baseWidth, baseDepth] = getBuildingDefinition(id).gridFootprint;
  const width = rotation % 2 ? baseDepth : baseWidth;
  const depth = rotation % 2 ? baseWidth : baseDepth;
  return page.evaluate(
    ({ depth, id, rotation, width }) => {
      const live = (window as any).__settlement;
      const hq = live.simulation.headquarters;
      const candidates: any[] = [];
      const canvas = document.querySelector("canvas")!.getBoundingClientRect();
      for (let dz = -14; dz <= 14; dz++)
        for (let dx = -14; dx <= 14; dx++) {
          const x = Math.floor(hq.x) + dx + (width % 2 ? 0.5 : 0);
          const z = Math.floor(hq.z) + dz + (depth % 2 ? 0.5 : 0);
          if (live.simulation.validatePlacement(id, x, z, rotation)) continue;
          const projected = (window as any).__worker.projectGround(x, z);
          if (!projected) continue;
          const px = projected.x + canvas.x,
            py = projected.y + canvas.y;
          if (px < 40 || px > innerWidth - 40 || py < 90 || py > innerHeight - 150) continue;
          candidates.push({ x, z, px, py, distance: Math.hypot(x - hq.x, z - hq.z) });
        }
      candidates.sort((a, b) => a.distance - b.distance || a.z - b.z || a.x - b.x);
      return candidates[0];
    },
    { id, rotation, width, depth }
  );
};

const review = async (quality: string, viewport: { width: number; height: number }) => {
  const page = await browser.newPage({ viewport });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") errors.push(message.text());
  });
  await page.routeWebSocket("**/*", () => {});
  await page.route("**/favicon.ico", (route) => route.fulfill({ status: 204 }));
  page.on("response", (response) => {
    if (response.status() >= 400) console.log("HTTP error", response.status(), response.url());
  });
  await page.addInitScript("window.__name = (value) => value;");
  await page.goto(`${url}?quality=${quality}&seed=123&reveal=1&cache=0`);
  await page.waitForFunction(
    () => Boolean((window as any).__islandReady && (window as any).__settlement),
    null,
    { timeout: 120_000 }
  );
  const initial = await page.evaluate(() => (window as any).__settlement.simulation.snapshot());
  assert.equal(initial.settlersInside, 20);
  assert.equal(initial.actors.length, 0);
  assert.equal(initial.buildings.length, 1);
  assert.equal(initial.buildings[0].typeId, 0);
  await page.screenshot({ path: resolve(output, `${quality}-headquarters.png`) });

  await selectBuilding(page, 17, "keyboard");
  const plot = await candidate(page, 17, 1);
  assert(plot, `${quality}: no visible valid rotated woodcutter plot`);
  await page.mouse.move(plot.px, plot.py);
  await page.screenshot({ path: resolve(output, `${quality}-rotated-preview.png`) });
  await page.mouse.click(plot.px, plot.py);
  await page.waitForTimeout(300);
  let snapshot = await page.evaluate(() => (window as any).__settlement.simulation.snapshot());
  const woodcutter = snapshot.buildings.find((building: any) => building.typeId === 17);
  assert(woodcutter, `${quality}: actual canvas click failed to place woodcutter`);
  assert.equal(woodcutter.rotation, 1);
  assert.equal(woodcutter.width, getBuildingDefinition(17).gridFootprint[1]);
  assert.equal(woodcutter.depth, getBuildingDefinition(17).gridFootprint[0]);
  const connected = await page.evaluate(() => {
    const live = (window as any).__settlement;
    const building = live.simulation.buildings().find((b: any) => b.typeId === 17);
    return live.simulation.connectRoads(live.simulation.headquarters.access, building.access);
  });
  assert(connected, `${quality}: road could not connect the rotated entrance to headquarters`);
  // Actual picker and button rotation verify the opposite rectangular footprint as well.
  await selectBuilding(page, 28, "button");
  const pigPlot = await candidate(page, 28, 1);
  assert(pigPlot, `${quality}: no visible valid rotated pig farm plot`);
  await page.mouse.click(pigPlot.px, pigPlot.py);
  snapshot = await page.evaluate(() => (window as any).__settlement.simulation.snapshot());
  const pig = snapshot.buildings.find((building: any) => building.typeId === 28);
  assert(pig, "Actual canvas click failed to place pig farm");
  assert.equal(pig.width, getBuildingDefinition(28).gridFootprint[1]);
  assert.equal(pig.depth, getBuildingDefinition(28).gridFootprint[0]);
  await page.getByRole("button", { name: "Cancel placement or road tool", exact: true }).click();

  const evidence: Record<string, boolean> = {};
  let final: any;
  for (let chunk = 0; chunk < 100; chunk++) {
    const observed = await page.evaluate(() => {
      const live = (window as any).__settlement;
      const found: Record<string, boolean> = {};
      for (let step = 0; step < 40; step++) {
        const renderState = live.update(0.05);
        const snap = live.simulation.snapshot();
        for (const frame of live.workerFrames) {
          if (
            frame.visible &&
            frame.workerJob === "Builder" &&
            frame.action === "build_hammer" &&
            frame.workerTool === "hammer"
          )
            found.builderClip = true;
          if (frame.visible && frame.action === "carry_shoulder" && frame.carryingWare === "logs")
            found.actualLogMesh = true;
        }
        const active = snap.actors.filter((actor: any) => actor.phase !== "retired" && actor.job !== "Mount");
        if (snap.settlersInside + active.length !== 20)
          throw new Error("Population accounting failed");
        for (const actor of snap.actors) {
          if (actor.job === "Builder" && actor.phase === "construct") found.builderHammer = true;
          if (actor.job === "Settler" && actor.phase === "retire" && actor.tool === "hammer")
            found.returningHammer = true;
          if (actor.phase === "retired" && !actor.tool) found.retiredBuilder = true;
          if (actor.job === "Woodcutter" && actor.action === "chop") found.chopping = true;
          if (actor.job === "Woodcutter" && actor.ware === "logs") found.carryingLog = true;
          if (actor.job === "Woodcutter" && actor.wareTransfer?.direction === "putdown")
            found.outdoorLogPutdown = true;
          if (actor.job === "Carrier" && actor.wareTransfer?.direction === "pickup" && actor.ware === "logs")
            found.outdoorLogPickup = true;
        }
        const wood = snap.buildings.find((b: any) => b.typeId === 17);
        const woodFrame = renderState.buildings.find((frame: any) => frame.type === 17);
        if ((woodFrame.outputStock?.logs ?? 0) !== (wood.output.logs ?? 0))
          throw new Error("Visible output stock frame diverged from simulation");
        if ((wood.output.logs ?? 0) > 6) throw new Error("Woodcutter output exceeds six units");
        if ((wood.output.logs ?? 0) > 0) found.logOutput = true;
        if ((snap.buildings[0].inventory.logs ?? 0) > 24) found.storedLog = true;
      }
      return {
        found,
        waitingForTree: live.simulation.frames().some((actor: any) => actor.phase === "waitTreeFall"),
        snapshot: live.simulation.snapshot(),
        frames: live.workerFrames.map((f: any) => ({
          action: f.action,
          workerTool: f.workerTool,
          visible: f.visible,
          carryingWare: f.carryingWare
        }))
      };
    });
    for (const key of Object.keys(observed.found)) {
      if (!evidence[key]) {
        evidence[key] = true;
        await page.waitForTimeout(120);
        await page.screenshot({ path: resolve(output, `${quality}-${key}.png`) });
      }
    }
    final = observed.snapshot;
    // Felling uses the renderer's real animation clock, not this accelerated economy loop.
    if (observed.waitingForTree) await page.waitForTimeout(350);
    if (evidence.storedLog && evidence.retiredBuilder) break;
  }
  const report = { quality, initial, woodcutter, pig, evidence, final, errors };
  reports.push(report);
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  assert(
    evidence.builderHammer && evidence.builderClip,
    `${quality}: builder never visibly constructed`
  );
  assert(
    evidence.returningHammer && evidence.retiredBuilder,
    `${quality}: builder did not return with tool and retire`
  );
  assert(
    evidence.chopping &&
      evidence.carryingLog &&
      evidence.actualLogMesh &&
      evidence.outdoorLogPutdown &&
      evidence.outdoorLogPickup &&
      evidence.logOutput &&
      evidence.storedLog,
    `${quality}: full tree/log production cycle incomplete: ${JSON.stringify(evidence)}`
  );
  for (const ware of ["planks", "stone"]) {
    const total =
      final.buildings.reduce(
        (sum: number, building: any) =>
          sum +
          (building.inventory[ware] ?? 0) +
          (building.input[ware] ?? 0) +
          (building.output[ware] ?? 0),
        0
      ) + final.actors.filter((actor: any) => actor.ware === ware).length;
    assert.equal(
      total,
      initial.buildings[0].inventory[ware] - (woodcutter.required[ware] ?? 0),
      `${ware} accounting`
    );
  }
  for (const tool of ["hammer", "axe"]) {
    const total =
      final.buildings.reduce(
        (sum: number, building: any) => sum + (building.inventory[tool] ?? 0),
        0
      ) + final.actors.filter((actor: any) => actor.tool === tool).length;
    assert.equal(total, initial.buildings[0].inventory[tool], `${tool} accounting`);
  }
  assert.equal(
    final.buildings.find((building: any) => building.typeId === 28).construction,
    0,
    "An unconnected plot must not receive supplies or construct"
  );
  const upgrade = await page.evaluate(() => {
    const live = (window as any).__settlement,
      hq = live.simulation.headquarters;
    const building = live.simulation.buildings().find((entry: any) => entry.typeId === 17);
    const before = hq.inventory.stone,
      oldRoute = live.roads.route(hq.access, building.access);
    const ok = live.simulation.upgradeRoad(hq.access, building.access);
    live.update(0.5);
    return {
      ok,
      paid: before - hq.inventory.stone,
      beforeCost: oldRoute.cost,
      afterCost: live.roads.route(hq.access, building.access).cost,
      speed: live.roads.speedAt(hq.access),
      segments: live.roads.segments().length
    };
  });
  assert.equal(upgrade.ok, true);
  assert.equal(upgrade.paid, upgrade.segments);
  assert.equal(upgrade.speed, 1.5);
  assert(upgrade.afterCost < upgrade.beforeCost);
  Object.assign(report, { upgrade });
  writeFileSync(resolve(output, "review.json"), JSON.stringify(reports, null, 2));
  assert.deepEqual(errors, []);
  await page.waitForTimeout(150);
  await page.screenshot({ path: resolve(output, `${quality}-production.png`) });
  await page.close();
};

try {
  if (process.env.REVIEW_QUALITY !== "minimal") await review("high", { width: 1440, height: 1000 });
  if (process.env.REVIEW_QUALITY !== "high") await review("minimal", { width: 390, height: 844 });
  console.log(`Live settlement review passed; screenshots and report: ${output}`);
} finally {
  await browser.close();
  await server.close();
}
