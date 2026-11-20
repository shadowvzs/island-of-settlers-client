import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import { getBuildingDefinition } from "../../../src/render-common/buildings/building-catalog";
import { STONEMASON_RADIUS } from "../../../src/shared/settlement/settlement-stone-area";

export type GroundPoint = { x: number; z: number };

export const clickGround = async (page: Page, point: GroundPoint) => {
  const screen = await page.evaluate(({ x, z }) => {
    const live = (window as any).__settlement;
    if (!live?.projectGround) throw new Error("Ground projection diagnostics are unavailable");
    return live.projectGround(x, z);
  }, point);
  const viewport = page.viewportSize();
  assert(viewport && screen.x > 0 && screen.y > 0 && screen.x < viewport.width && screen.y < viewport.height,
    `Ground target is off screen: ${JSON.stringify({ point, screen })}`);
  await page.mouse.move(screen.x, screen.y);
  await page.mouse.click(screen.x, screen.y);
};

export const hideBuildPanel = async (page: Page) => {
  const heading = page.getByRole("heading", { name: "Build your settlement", exact: true });
  if (await heading.isVisible()) await page.getByRole("button", { name: "Build", exact: true }).click();
};

export const selectBuilding = async (page: Page, type: number) => {
  await page.keyboard.press("Escape");
  if (!await page.getByRole("heading", { name: "Build your settlement", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Build", exact: true }).click();
  }
  const card = page.locator(`[data-building='${type}']`);
  const tabs = page.getByRole("tablist", { name: "Building categories" }).getByRole("tab");
  for (let index = 0; index < await tabs.count(); index++) {
    await tabs.nth(index).click();
    if (await card.isVisible()) break;
  }
  assert(await card.isVisible(), `Building ${type} has no visible, allowed UI card`);
  await card.click();
  await hideBuildPanel(page);
  // Pin a known orientation through the user's rotate hotkey, rather than overriding controls.
  await page.keyboard.press("r");
};

export const choosePlot = async (page: Page, type: number) => page.evaluate(({ footprint, treeRange, typeId }) => {
  const live = (window as any).__settlement;
  const sim = live.simulation;
  const home = sim.buildings().find((building: any) => building.typeId === 0);
  if (!home) throw new Error("Natural construction requires an ordinary home HQ");
  const rotation = live.controls.rotation();
  const [rawWidth, rawDepth] = footprint;
  const width = rotation % 2 ? rawDepth : rawWidth;
  const depth = rotation % 2 ? rawWidth : rawDepth;
  const props = (window as any).__fullE2E?.world?.props;
  const trees: GroundPoint[] = [];
  if (typeId === 17) {
    if (!props) throw new Error("Read-only world props are required to preflight existing woodcutter targets");
    for (let index = 0; index < props.count; index++) {
      if ([0, 1, 2, 18].includes(props.types[index]) && props.scale[index] >= .7) {
        trees.push({ x: props.x[index], z: props.z[index] });
      }
    }
  }
  for (let radius = 10; radius <= 26; radius += 2) {
    for (let step = 0; step < 32; step++) {
      const angle = step * Math.PI / 16;
      const x = Math.round(home.x + Math.cos(angle) * radius) + width % 2 / 2;
      const z = Math.round(home.z + Math.sin(angle) * radius) + depth % 2 / 2;
      if (sim.validatePlacement(typeId, x, z, rotation)) continue;
      if (typeId === 17) {
        let targets = 0;
        for (const tree of trees) {
          if (Math.hypot(tree.x - x, tree.z - z) <= treeRange) targets++;
          if (targets >= 3) break;
        }
        if (targets < 3) continue;
      }
      const screen = live.projectGround(x, z);
      if (screen.x < 130 || screen.x > innerWidth - 130 || screen.y < 160 || screen.y > innerHeight - 160) continue;
      return { x, z, rotation };
    }
  }
  throw new Error(`No legal on-screen building ${typeId} plot near HQ; fixture/camera prerequisite failed`);
}, { typeId: type, footprint: getBuildingDefinition(type).gridFootprint, treeRange: STONEMASON_RADIUS });

export const connectBuildingUi = async (page: Page, uid: number) => {
  const endpoints = await page.evaluate((buildingUid) => {
    const live = (window as any).__settlement;
    const sim = live.simulation;
    const building = sim.buildings().find((item: any) => item.uid === buildingUid);
    const home = sim.buildings().find((item: any) => item.typeId === 0);
    if (!building || !home) throw new Error("Road endpoint building disappeared");
    if (!sim.planRoad(home.access, building.access, "dirt")) {
      throw new Error(`No legal dirt road from HQ to natural building ${buildingUid}`);
    }
    return { start: { ...home.access }, end: { ...building.access }, revision: sim.roadRevision(),
      preexisting: Boolean(live.roads.route(home.access, building.access)?.points.length) };
  }, uid);
  await page.keyboard.press("Escape");
  if (!await page.getByRole("heading", { name: "Build your settlement", exact: true }).isVisible()) {
    await page.getByRole("button", { name: "Build", exact: true }).click();
  }
  await page.getByRole("tab", { name: "Roads", exact: true }).click();
  await page.getByRole("button", { name: "Dirt road", exact: true }).click();
  await hideBuildPanel(page);
  await clickGround(page, endpoints.start);
  await clickGround(page, endpoints.end);
  await page.getByRole("status").filter({ hasText: /^Dirt road connected\.$/ }).first()
    .waitFor({ state: "visible", timeout: 10_000 });
  await page.waitForFunction(({ end, start }) => {
    const route = (window as any).__settlement.roads.route(start, end);
    if (!route?.points.length) return false;
    return route.points.length > 1 || (start.x === end.x && start.z === end.z);
  }, endpoints, { timeout: 10_000 });
  const connected = await page.evaluate(({ end, start }) => {
    const live = (window as any).__settlement;
    const route = live.roads.route(start, end);
    return { finalRevision: live.simulation.roadRevision(), routePoints: route.points.length,
      routeLength: route.length };
  }, endpoints);
  await page.keyboard.press("Escape");
  return { ...endpoints, ...connected };
};

/** Open the lazy camera panel through its real toggle before checking its zoom limits. */
export const checkCameraZoomLimits = async (page: Page) => {
  const panel = page.locator(".camera-controls-panel");
  if (!await panel.isVisible()) {
    await page.getByRole("button", { exact: true, name: "Camera controls" }).click();
  }
  await panel.waitFor({ state: "visible", timeout: 10_000 });
  const zoomLimits = [];
  try {
    for (const direction of ["Zoom in", "Zoom out"]) {
      const control = panel.getByRole("button", { exact: true, name: direction });
      // Visibility of the panel alone does not imply its lazy React content is mounted.
      await control.waitFor({ state: "visible", timeout: 10_000 });
      let presses = 0;
      while (await control.isEnabled() && presses < 70) {
        await control.click();
        presses++;
        // The camera service publishes disabled limits on its next animation frame.
        await page.evaluate(() => new Promise<void>(resolve => requestAnimationFrame(() => resolve())));
      }
      assert(await control.isDisabled(), `${direction} never reached its documented limit after 70 clicks`);
      zoomLimits.push({ direction, presses, reachedDisabledLimit: true });
    }
  } finally {
    await panel.getByRole("button", { exact: true, name: "Close camera controls panel" }).click();
  }
  return zoomLimits;
};
