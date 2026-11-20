import assert from "node:assert/strict";
import type { Page } from "playwright-core";

import {
  checkCameraZoomLimits, choosePlot, clickGround, connectBuildingUi, selectBuilding
} from "./natural-ui-helpers";

type RunCase = (id: string, title: string, action: () => Promise<unknown>) => Promise<void>;

interface CameraPose {
  centerX: number;
  centerZ: number;
  tilt: number;
  yaw: number;
  zoom: number;
}

interface WorkerFrame {
  job: string;
  phase: string;
  uid: number;
  visible?: boolean;
  x: number;
  z: number;
}

const cameraPose = (page: Page) => page.evaluate((): CameraPose => {
  const camera = (window as any).__fullE2E?.camera;
  if (!camera) throw new Error("The camera state is unavailable");
  return { centerX: camera.centerX, centerZ: camera.centerZ, tilt: camera.tilt, yaw: camera.yaw, zoom: camera.zoom };
});

const distance = (a: { centerX: number; centerZ: number }, b: { x: number; z: number }) =>
  Math.hypot(a.centerX - b.x, a.centerZ - b.z);

const changed = (a: CameraPose, b: CameraPose) =>
  Math.hypot(a.centerX - b.centerX, a.centerZ - b.centerZ) > 0.5 || Math.abs(a.yaw - b.yaw) > 0.01 ||
  Math.abs(a.zoom - b.zoom) > 0.001;

/** Visible, non-military actors the game's own worker picker accepts. */
const eligibleWorkers = (page: Page) => page.evaluate((): WorkerFrame[] => {
  const simulation = (window as any).__settlement?.simulation;
  if (!simulation) throw new Error("The settlement simulation is unavailable");
  return simulation.frames().filter((actor: any) => actor.visible !== false && actor.phase !== "retired" &&
    actor.job !== "Soldier" && !(actor.combat?.faction > 0))
    .map((actor: any) => ({ job: actor.job, phase: actor.phase, uid: actor.uid, visible: actor.visible,
      x: actor.x, z: actor.z }));
});

const workerAt = (page: Page, uid: number) => page.evaluate((id): WorkerFrame | undefined => {
  const actor = (window as any).__settlement.simulation.frames().find((frame: any) => frame.uid === id);
  return actor && { job: actor.job, phase: actor.phase, uid: actor.uid, visible: actor.visible,
    x: actor.x, z: actor.z };
}, uid);

/** Keyboard panning preserves the real camera path; the fixture does not write the camera directly. */
const revealPoint = async (page: Page, point: { x: number; z: number }) => {
  const viewport = page.viewportSize()!;
  for (let attempt = 0; attempt < 60; attempt++) {
    const screen = await page.evaluate(({ x, z }) => {
      const live = (window as any).__settlement;
      if (!live?.projectGround) throw new Error("Ground projection diagnostics are unavailable");
      return live.projectGround(x, z);
    }, point);
    if (screen.x > 80 && screen.x < viewport.width - 80 && screen.y > 110 && screen.y < viewport.height - 110)
      return screen;
    const dx = screen.x - viewport.width / 2, dy = screen.y - viewport.height / 2;
    let key: "ArrowRight" | "ArrowLeft" | "ArrowDown" | "ArrowUp";
    if (Math.abs(dx) > Math.abs(dy)) key = dx > 0 ? "ArrowRight" : "ArrowLeft";
    else key = dy > 0 ? "ArrowDown" : "ArrowUp";
    await page.keyboard.down(key);
    try { await page.waitForTimeout(140); } finally { await page.keyboard.up(key); }
  }
  throw new Error(`Camera could not reveal worker through arrow-key panning: ${JSON.stringify(point)}`);
};

/**
 * A follow subject must be a real moving actor. A resumed economy normally supplies one; a fresh
 * baseline has only idle settlers in its HQ, so place the cheapest legal foundation and connect it
 * through the ordinary build and road UI to make the game recruit a builder.
 */
const ensureFollowWorker = async (page: Page) => {
  const existing = await eligibleWorkers(page);
  if (existing.length) return { source: "existing", worker: existing[0]! };

  const before = await page.evaluate(() => (window as any).__settlement.simulation.buildings()
    .filter((building: any) => building.typeId === 35).length);
  await selectBuilding(page, 35);
  const plot = await choosePlot(page, 35);
  await clickGround(page, plot);
  await page.waitForFunction((count) => (window as any).__settlement.simulation.buildings()
    .filter((building: any) => building.typeId === 35).length > count, before, { timeout: 20_000 });
  const site = await page.evaluate(() => {
    const sites = (window as any).__settlement.simulation.buildings().filter((building: any) => building.typeId === 35);
    return sites.at(-1);
  });
  assert(site, "The well foundation was not created through the build UI");
  await connectBuildingUi(page, site.uid);
  await page.waitForFunction((uid) => (window as any).__settlement.simulation.frames()
    .some((actor: any) => actor.building === uid && actor.visible !== false), site.uid, { timeout: 30_000 });
  const workers = await eligibleWorkers(page);
  const worker = workers.find(candidate => candidate.phase !== "retired");
  if (!worker) throw new Error("Construction UI did not recruit a visible builder for the follow fixture");
  return { source: "constructed-well-foundation", worker, siteUid: site.uid, plot };
};

const clickWorker = async (page: Page, uid: number) => {
  const status = page.locator(".settlement-ui__observation-window").getByRole("status");
  for (let attempt = 0; attempt < 10; attempt++) {
    const worker = await workerAt(page, uid);
    if (!worker) return false;
    const screen = await revealPoint(page, worker);
    await page.mouse.move(screen.x, screen.y);
    await page.mouse.down();
    await page.mouse.up();
    await page.waitForTimeout(300);
    if (!(await status.innerText()).startsWith("Select a visible worker")) return true;
  }
  return false;
};

/** Stable desktop controls: minimap, main selection, ordinary camera input and Observe follow. */
export const runControlsCases = async (page: Page, runCase: RunCase) => {
  await runCase("E2E-14-camera-picking", "Normal camera gestures preserve ground/building picking", async () => {
    await page.keyboard.press("Escape");
    const home = await page.evaluate(() => {
      const live = (window as any).__settlement;
      const building = live.simulation.buildings().find((item: any) => item.typeId === 0);
      return { x: building.x, z: building.z, uid: building.uid,
        before: live.projectGround(building.x + 6, building.z) };
    });
    await page.keyboard.down("q");
    await page.waitForTimeout(600);
    await page.keyboard.up("q");
    const viewport = page.viewportSize()!;
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.wheel(0, -350);
    await page.waitForTimeout(500);
    const rotated = await page.evaluate(({ x, z }) => (window as any).__settlement.projectGround(x + 6, z), home);
    assert(Math.hypot(rotated.x - home.before.x, rotated.y - home.before.y) > 2,
      "Camera rotation/zoom did not change off-centre ground projection");
    await clickGround(page, home);
    await page.getByRole("dialog", { name: "Headquarters", exact: true }).waitFor({ state: "visible", timeout: 10_000 });
    await page.getByRole("button", { name: "Close building details window", exact: true }).click();
    await page.mouse.wheel(0, 350);
    await page.keyboard.down("e");
    await page.waitForTimeout(600);
    await page.keyboard.up("e");
    await page.mouse.move(viewport.width / 2, viewport.height / 2);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(viewport.width / 2 + 70, viewport.height / 2 + 30, { steps: 8 });
    await page.mouse.up({ button: "right" });
    const zoomLimits = await checkCameraZoomLimits(page);
    return { home, rotated, zoomLimits, selectedByActualMapClick: true };
  });

  await runCase("E2E-14-minimap", "Map opens the minimap and a minimap click locates the camera", async () => {
    const map = page.getByRole("button", { exact: true, name: "Map" });
    const minimap = page.locator(".minimap");
    await map.waitFor({ state: "visible", timeout: 15_000 });
    if (await map.getAttribute("aria-pressed") === "true") await map.click();
    await minimap.waitFor({ state: "hidden" });
    await map.click();
    await minimap.waitFor({ state: "visible" });
    assert.equal(await map.getAttribute("aria-pressed"), "true", "Map did not report the minimap as open");
    await minimap.getByRole("button", { exact: true, name: "Show occupied territory" })
      .waitFor({ state: "visible", timeout: 15_000 });
    const canvas = minimap.locator(".minimap__canvas");
    const bounds = await canvas.boundingBox();
    assert(bounds && bounds.width > 0 && bounds.height > 0, "The minimap canvas has no visible bounds");
    const before = await cameraPose(page);
    await page.mouse.click(bounds.x + bounds.width * 0.3, bounds.y + bounds.height * 0.55);
    await page.waitForTimeout(250);
    const located = await cameraPose(page);
    assert(Math.hypot(located.centerX - before.centerX, located.centerZ - before.centerZ) > 2,
      "A minimap click did not locate the camera at another ground position");
    await map.click();
    await minimap.waitFor({ state: "hidden" });
    assert.equal(await map.getAttribute("aria-pressed"), "false", "Map did not report the minimap as closed");
    await map.click();
    await minimap.waitFor({ state: "visible" });
    return { before, located, openedAndClosed: true, minimapCanvas: bounds };
  });

  await runCase("E2E-14-menu", "Menu opens Main selection and closes through its launcher and Escape", async () => {
    const menu = page.getByRole("button", { exact: true, name: "Menu" });
    const dialog = page.getByRole("dialog", { exact: true, name: "Main selection" });
    await menu.click();
    await dialog.waitFor({ state: "visible", timeout: 15_000 });
    for (const name of ["Buildings", "Overview", "Ships", "Settings"])
      assert(await dialog.getByRole("button", { exact: true, name }).isVisible(), `Main selection is missing ${name}`);
    const bounds = await dialog.boundingBox();
    const viewport = page.viewportSize()!;
    assert(bounds && bounds.x >= 0 && bounds.y >= 0 &&
      bounds.x + bounds.width <= viewport.width + 1 && bounds.y + bounds.height <= viewport.height + 1,
    `Main selection is outside the viewport: ${JSON.stringify(bounds)}`);
    await menu.click();
    await dialog.waitFor({ state: "hidden" });
    await menu.click();
    await dialog.waitFor({ state: "visible" });
    await page.keyboard.press("Escape");
    await dialog.waitFor({ state: "hidden" });
    return { entries: ["Buildings", "Overview", "Ships", "Settings"], launcherClosed: true,
      escapeClosed: true, bounds };
  });

  await runCase("E2E-14-camera-input", "Arrow keys and left-drag pan the ordinary camera", async () => {
    await page.keyboard.press("Escape");
    const initial = await cameraPose(page);
    await page.keyboard.down("ArrowRight");
    await page.waitForTimeout(400);
    await page.keyboard.up("ArrowRight");
    await page.waitForTimeout(120);
    const afterKey = await cameraPose(page);
    assert(changed(initial, afterKey), "Holding ArrowRight did not move the camera");
    await page.keyboard.down("ArrowUp");
    await page.waitForTimeout(300);
    await page.keyboard.up("ArrowUp");
    await page.waitForTimeout(120);
    const afterArrow = await cameraPose(page);
    assert(changed(afterKey, afterArrow), "Holding ArrowUp did not move the camera");
    const canvas = page.locator("canvas").first();
    const bounds = await canvas.boundingBox();
    assert(bounds, "The map canvas has no visible bounds");
    const startX = bounds.x + bounds.width / 2, startY = bounds.y + bounds.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 120, startY + 60, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(120);
    const afterDrag = await cameraPose(page);
    assert(changed(afterArrow, afterDrag), "Left-drag did not pan the camera");
    return { initial, afterKey, afterArrow, afterDrag, gestures: ["KeyD", "ArrowUp", "left-drag"] };
  });

  await runCase("E2E-14-follow", "Observe a real worker, follow it and stop on a camera key", async () => {
    await page.keyboard.press("Escape");
    const fixture = await ensureFollowWorker(page);
    const worker = fixture.worker;
    await revealPoint(page, worker);
    await page.getByRole("button", { exact: true, name: "Camera controls" }).click();
    await page.getByRole("button", { exact: true, name: "Inspect a worker without issuing an order" })
      .waitFor({ state: "visible", timeout: 15_000 });
    await page.getByRole("button", { exact: true, name: "Inspect a worker without issuing an order" }).click();
    const observe = page.locator(".settlement-ui__observation-window");
    await observe.waitFor({ state: "visible", timeout: 15_000 });
    const status = observe.getByRole("status");
    await status.waitFor({ state: "visible" });
    assert((await status.innerText()).startsWith("Select a visible worker"),
      "Watch worker did not enter picking mode");
    const picked = await clickWorker(page, worker.uid);
    assert(picked, "Clicking the actual worker did not open its observation");
    const pickedTitle = await observe.locator("h2").innerText();
    assert(!/^Observe$/i.test(pickedTitle), "Observe kept its generic title after picking a worker");

    const follow = observe.getByRole("button", { exact: true, name: "Follow this worker or ship" });
    const stop = observe.getByRole("button", { exact: true, name: "Stop following" });
    await follow.waitFor({ state: "visible" });
    assert(await follow.isEnabled(), "Follow is disabled for the picked worker");
    assert(await stop.isDisabled(), "Stop following is enabled before following starts");

    // Move away first so the converging camera has a visible, measurable effect.
    await page.keyboard.down("ArrowLeft");
    await page.waitForTimeout(700);
    await page.keyboard.up("ArrowLeft");
    const beforeFollow = await cameraPose(page);
    const workerBefore = await workerAt(page, worker.uid);
    assert(workerBefore, "The observed worker disappeared before following");
    const startDistance = distance(beforeFollow, workerBefore);
    assert(startDistance > 2, `The camera was too close to measure follow: ${startDistance}`);

    await follow.click();
    await page.waitForFunction(() => document.querySelector(".settlement-ui__observation-window [role='status']")
      ?.textContent?.includes("Following"), undefined, { timeout: 10_000 });
    await page.waitForTimeout(1500);
    const following = await cameraPose(page);
    const workerDuring = await workerAt(page, worker.uid);
    assert(workerDuring, "The observed worker disappeared while following");
    const followDistance = distance(following, workerDuring);
    assert(followDistance < startDistance - 1 || followDistance < 2,
      `Follow did not move the camera towards the worker: ${JSON.stringify({ startDistance, followDistance })}`);
    assert(await stop.isEnabled(), "Stop following stayed disabled while following");

    await page.keyboard.press("ArrowLeft");
    await page.waitForFunction(() => !document.querySelector(".settlement-ui__observation-window [role='status']")
      ?.textContent?.includes("Following"), undefined, { timeout: 10_000 });
    assert(await stop.isDisabled(), "A camera key did not stop following");
    assert(await follow.isEnabled(), "Follow did not become available again after stopping");
    const stopped = await cameraPose(page);
    await observe.getByRole("button", { exact: true, name: "Close observe window" }).click();
    await observe.waitFor({ state: "hidden" });
    return { fixture: fixture.source, worker: { uid: worker.uid, job: worker.job, title: pickedTitle },
      startDistance, followDistance, stoppedBy: "ArrowLeft", beforeFollow, following, stopped };
  });
};
