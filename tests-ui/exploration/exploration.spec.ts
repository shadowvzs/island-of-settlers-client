import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { expect, type Page, test, type TestInfo } from "@playwright/test";

import { UI_TEST_URL } from "../fixtures/server";
import { expectInsideViewport, nextFrames } from "../fixtures/ui";

/**
 * EXPLORE-01H focused browser review. The suite is opt-in (its own config) and every case is
 * skipped until EXPLORE-01G exposes `window.__exploration`; it never claims acceptance from a
 * fixture that cannot enter the real mode.
 *
 * Fixed home fixture: 64², seed 123, fresh cache. It is deliberately the cheapest complete home
 * settlement; native 256²/512² performance belongs to tools/bench/home-exploration-review.ts.
 */

const READY_TIMEOUT = 180_000;
const HOOK_REASON =
  "Blocked until EXPLORE-01G: window.__exploration and the live exploration controller are not wired; " +
  "entry/leave/cooldown cannot be exercised from this build.";

const qualityFor = (projectName: string) => projectName.includes("high") ? "high" : "minimal";

const openHome = async (page: Page, quality: string) => {
  await page.routeWebSocket("**/*", () => {});
  await page.goto(`${UI_TEST_URL}?quality=${quality}&size=64&seed=123&cache=0`);
  await page.waitForFunction(() => Boolean((window as { __islandReady?: boolean }).__islandReady), null, {
    timeout: READY_TIMEOUT
  });
  await page.locator("#loading-screen").waitFor({ state: "detached", timeout: READY_TIMEOUT });
};

const waitPhase = (page: Page, phase: string) =>
  page.waitForFunction(expected => (window as unknown as {
    __exploration?: { controller: { phase: () => string } };
  }).__exploration?.controller.phase() === expected, phase, { timeout: 30_000 });

const waitLeaveUnlocked = (page: Page) =>
  page.waitForFunction(() => (window as unknown as {
    __exploration?: { controller: { snapshot: () => { leaveUnlockInMs: number } } };
  }).__exploration?.controller.snapshot().leaveUnlockInMs === 0, null, { timeout: 15_000 });

const buildingDetails = (page: Page) => page.locator(".settlement-ui__building-details-window");
const visibleNormalTooltips = (page: Page) =>
  page.locator(".hostile-building-tooltip:not([hidden]), .build-overlay__tooltip:not([hidden])");

type Box = { height: number; width: number; x: number; y: number };
const boxesOverlap = (first: Box, second: Box) =>
  first.x < second.x + second.width && first.x + first.width > second.x &&
  first.y < second.y + second.height && first.y + first.height > second.y;

/** Opt-in review screenshots; the normal focused test run writes no artifacts. */
const captureHudEvidence = async (page: Page, name: string) => {
  const directory = process.env.EXPLORATION_HUD_SHOTS;
  if (!directory) return;
  mkdirSync(directory, { recursive: true });
  await page.screenshot({ path: resolve(directory, `${name}.png`) });
};

/** Own event listeners via CDP: repeated possession must not attach a second minimap listener set. */
const ownListenerCount = async (page: Page, selector: string) => {
  const session = await page.context().newCDPSession(page);
  try {
    const { result } = await session.send("Runtime.evaluate", {
      expression: `document.querySelector(${JSON.stringify(selector)})`
    });
    const objectId = result.objectId as string | undefined;
    if (!objectId) return 0;
    const { listeners } = await session.send("DOMDebugger.getEventListeners", { objectId });
    return (listeners as unknown[]).length;
  } finally {
    await session.detach();
  }
};

/**
 * Gate the project before loading the expensive home fixture: beforeEach would otherwise load a
 * full desktop page only to skip a touch-only case (and the reverse).
 */
const setupHome = async (page: Page, testInfo: TestInfo, input: "desktop" | "touch") => {
  const touchProject = testInfo.project.name.includes("touch");
  test.skip(input === "touch" ? !touchProject : touchProject, `${input} input case.`);
  await openHome(page, qualityFor(testInfo.project.name));
  const wired = await page.evaluate(() => {
    const hook = (window as { __exploration?: { camera?: unknown; controller?: unknown } }).__exploration;
    return Boolean(hook?.camera && hook.controller &&
      typeof (hook.controller as { enter?: unknown }).enter === "function" &&
      typeof (hook.controller as { snapshot?: unknown }).snapshot === "function");
  });
  test.skip(!wired, HOOK_REASON);
};

test("desktop HUD lifecycle: hidden portrait fallback, hidden HUD, spyglass, dwell, leave and cooldown", async ({
  page
}, testInfo) => {
  await setupHome(page, testInfo, "desktop");

  const entry = page.locator("[data-exploration-entry]");
  await expect(entry).toBeVisible();
  await expect(entry).toHaveAttribute("aria-label", "Explore home island");

  // Keep the normal minimap visible and move it off its default corner: leaving possession must
  // restore this exact player-owned layout, not the temporary bottom-left box.
  await page.getByRole("button", { exact: true, name: "Map" }).click();
  const normalMinimap = page.locator(".minimap");
  await expect(normalMinimap).toBeVisible();
  await normalMinimap.locator(".minimap__header").focus();
  await page.keyboard.press("ArrowRight");
  await page.keyboard.press("ArrowUp");
  const normalMinimapBox = await normalMinimap.boundingBox();
  expect(normalMinimapBox).not.toBeNull();
  const minimapListeners = await ownListenerCount(page, ".minimap");
  const minimapCanvasListeners = await ownListenerCount(page, ".minimap__canvas");

  // The portrait can be hidden through the XP toggle; the entry action must stay available.
  await page.getByRole("button", { exact: true, name: "Hide portrait" }).click();
  await expect(entry).toBeVisible();
  await entry.click();

  await waitPhase(page, "entering");
  await expect(page.locator("html")).toHaveAttribute("data-exploration-hud", "hidden");
  await expect(page.locator(".settlement-ui__bar")).toBeHidden();
  await expect(page.getByTestId("exploration-ui")).toBeVisible();
  await expect(page.getByTestId("exploration-ui")).toHaveAttribute("data-phase", "entering");
  await waitPhase(page, "possessed");

  const spyglass = page.locator('[data-exploration-control="spyglass"]');
  const leave = page.locator('[data-exploration-control="leave"]');
  await expect(spyglass).toBeVisible();
  await expect(leave).toBeVisible();
  await expect(page.locator('[data-exploration-control="look-stick"]'), "desktop keeps drag-look")
    .toBeHidden();
  await expect(leave).toBeDisabled();
  await waitLeaveUnlocked(page);
  await expect(leave).toBeEnabled();

  const minimap = page.locator(".minimap--exploration");
  const keys = page.locator(".exploration-ui__keys");
  await expect(page.locator(".minimap")).toHaveCount(1);
  await expect(minimap).toBeVisible();
  await expect(keys).toBeVisible();
  const minimapBox = await minimap.boundingBox();
  const keysBox = await keys.boundingBox();
  expect(minimapBox).not.toBeNull();
  expect(keysBox).not.toBeNull();
  expect(minimapBox!.x).toBeLessThan(page.viewportSize()!.width / 2);
  expect(keysBox!.x + keysBox!.width).toBeGreaterThan(page.viewportSize()!.width / 2);

  expect(await minimap.evaluate((node) => getComputedStyle(node).pointerEvents)).toBe("none");
  const savedCameraBefore = await page.evaluate(() => (window as unknown as {
    __exploration: { camera: { savedRts: () => unknown } };
  }).__exploration.camera.savedRts());
  await page.mouse.click(minimapBox!.x + 12, minimapBox!.y + 12);
  await nextFrames(page);
  const savedCameraAfter = await page.evaluate(() => (window as unknown as {
    __exploration: { camera: { savedRts: () => unknown } };
  }).__exploration.camera.savedRts());
  expect(savedCameraAfter, "the passive possessed minimap never pans the saved RTS camera")
    .toEqual(savedCameraBefore);

  const explorer = page.locator(".minimap__explorer");
  await expect(explorer).toBeVisible();
  expect(await explorer.evaluate((node) => getComputedStyle(node).backgroundColor)).toBe("rgb(255, 255, 255)");
  const mapBox = await minimap.locator(".minimap__map").boundingBox();
  expect(mapBox).not.toBeNull();
  const dotBox = await explorer.boundingBox();
  expect(dotBox).not.toBeNull();
  expect(dotBox!.x + dotBox!.width).toBeGreaterThan(mapBox!.x);
  expect(dotBox!.x).toBeLessThan(mapBox!.x + mapBox!.width);
  expect(dotBox!.y + dotBox!.height).toBeGreaterThan(mapBox!.y);
  expect(dotBox!.y).toBeLessThan(mapBox!.y + mapBox!.height);

  const before = await explorer.evaluate((node) => `${node.style.left},${node.style.top}`);
  await page.evaluate(() => (window as unknown as {
    __exploration: { controller: { setMovement: (forward: number, right: number) => void } };
  }).__exploration.controller.setMovement(1, 0));
  await page.waitForTimeout(700);
  await page.evaluate(() => (window as unknown as {
    __exploration: { controller: { setMovement: (forward: number, right: number) => void } };
  }).__exploration.controller.setMovement(0, 0));
  await expect.poll(() => explorer.evaluate((node) => `${node.style.left},${node.style.top}`))
    .not.toBe(before);
  await captureHudEvidence(page, "desktop-possessed");

  const fovBefore = await page.evaluate(() => {
    const frame = (window as unknown as {
      __exploration: { camera: { frame: () => { camera?: { pose: { fov: number } } } } };
    }).__exploration.camera.frame();
    return frame.camera?.pose.fov ?? 0;
  });
  await spyglass.click();
  await expect(spyglass).toHaveAttribute("aria-pressed", "true");
  const fovAfter = await page.evaluate(() => {
    const frame = (window as unknown as {
      __exploration: { camera: { frame: () => { camera?: { pose: { fov: number } } } } };
    }).__exploration.camera.frame();
    return frame.camera?.pose.fov ?? 0;
  });
  expect(fovAfter).toBeGreaterThan(0);
  expect(fovAfter).toBeLessThan(fovBefore);

  await leave.click();
  await waitPhase(page, "returning");
  await expect(page.locator("html"), "HUD stays hidden through the return").toHaveAttribute(
    "data-exploration-hud", "hidden"
  );
  await waitPhase(page, "cooldown");
  await expect(page.locator("html")).not.toHaveAttribute("data-exploration-hud", "hidden");
  await expect(page.locator(".settlement-ui").first()).toBeVisible();
  await expect(entry).toBeDisabled();
  await expect(entry).toContainText("s");
  await expect(page.locator(".minimap--exploration")).toHaveCount(0);
  await expect(explorer).toBeHidden();
  await expect(normalMinimap).toBeVisible();
  const restoredMinimapBox = await normalMinimap.boundingBox();
  expect(restoredMinimapBox).not.toBeNull();
  expect(Math.abs(restoredMinimapBox!.x - normalMinimapBox!.x)).toBeLessThan(2);
  expect(Math.abs(restoredMinimapBox!.y - normalMinimapBox!.y)).toBeLessThan(2);
  expect(Math.abs(restoredMinimapBox!.width - normalMinimapBox!.width)).toBeLessThan(2);
  expect(Math.abs(restoredMinimapBox!.height - normalMinimapBox!.height)).toBeLessThan(2);
  expect(await ownListenerCount(page, ".minimap")).toBe(minimapListeners);
  expect(await ownListenerCount(page, ".minimap__canvas")).toBe(minimapCanvasListeners);
  await captureHudEvidence(page, "desktop-restored");

  await waitPhase(page, "idle");
  await expect(entry).toBeEnabled();
  await expect(entry).toHaveAttribute("aria-label", "Explore home island");

  // A second cycle must reuse the one minimap and marker, not add a second overlay or loop.
  await entry.click();
  await waitPhase(page, "possessed");
  await expect(page.locator(".minimap")).toHaveCount(1);
  await expect(page.locator(".minimap--exploration")).toHaveCount(1);
  await expect(page.locator(".minimap__explorer")).toHaveCount(1);
  await expect(page.locator(".minimap__explorer")).toBeVisible();
  await waitLeaveUnlocked(page);
  await page.locator('[data-exploration-control="leave"]').click();
  await waitPhase(page, "returning");
  await waitPhase(page, "cooldown");
  expect(await ownListenerCount(page, ".minimap")).toBe(minimapListeners);
  expect(await ownListenerCount(page, ".minimap__canvas")).toBe(minimapCanvasListeners);
});

test("normal map hover, tooltips and building picking stay off during exploration and resume after cooldown", async ({
  page
}, testInfo) => {
  await setupHome(page, testInfo, "desktop");

  const building = await page.evaluate(() => {
    const first = (window as unknown as {
      __settlement?: { simulation: { buildings: () => { x: number; z: number }[] } };
    }).__settlement?.simulation.buildings()[0];
    return first ? { x: first.x, z: first.z } : null;
  });
  test.skip(!building, "The fixed fixture has no building to probe.");
  if (!building) return;

  await page.evaluate(({ x, z }) => (window as unknown as {
    __settlement: { focusGround: (x: number, z: number) => void };
  }).__settlement.focusGround(x, z), building);
  await nextFrames(page);
  const point = await page.evaluate(({ x, z }) => (window as unknown as {
    __settlement: { projectGround: (x: number, z: number) => { x: number; y: number } };
  }).__settlement.projectGround(x, z), building);

  await page.locator("[data-exploration-entry]").click();
  await waitPhase(page, "possessed");
  for (const [dx, dy] of [[0, 0], [30, 0], [-30, 0], [0, 30], [0, -30]] as const) {
    await page.mouse.move(point.x + dx, point.y + dy);
    await page.waitForTimeout(50);
    await expect(visibleNormalTooltips(page)).toHaveCount(0);
    await expect(buildingDetails(page)).toBeHidden();
  }
  await page.mouse.click(point.x, point.y);
  await expect(buildingDetails(page), "picking is suppressed").toBeHidden();

  await waitLeaveUnlocked(page);
  await page.locator('[data-exploration-control="leave"]').click();
  await waitPhase(page, "cooldown");
  await page.evaluate(({ x, z }) => (window as unknown as {
    __settlement: { focusGround: (x: number, z: number) => void };
  }).__settlement.focusGround(x, z), building);
  await nextFrames(page);
  const restoredPoint = await page.evaluate(({ x, z }) => (window as unknown as {
    __settlement: { projectGround: (x: number, z: number) => { x: number; y: number } };
  }).__settlement.projectGround(x, z), building);
  await page.mouse.click(restoredPoint.x, restoredPoint.y);
  await expect(buildingDetails(page), "ordinary picking resumes after cooldown").toBeVisible();
});

test("touch HUD keeps separated 48 px controls, turns with the right stick and restores after cooldown", async ({
  page
}, testInfo) => {
  await setupHome(page, testInfo, "touch");

  const entry = page.locator("[data-exploration-entry]");
  await expect(entry).toBeVisible();
  await entry.tap();
  await waitPhase(page, "possessed");

  const joystick = page.locator('[data-exploration-control="joystick"]');
  const look = page.locator('[data-exploration-control="look"]');
  const lookStick = page.locator('[data-exploration-control="look-stick"]');
  const spyglass = page.locator('[data-exploration-control="spyglass"]');
  const leave = page.locator('[data-exploration-control="leave"]');
  const minimap = page.locator(".minimap--exploration");
  const controls = [
    { locator: joystick, name: "joystick" },
    { locator: look, name: "look surface" },
    { locator: lookStick, name: "look stick" },
    { locator: spyglass, name: "spyglass" },
    { locator: leave, name: "leave" }
  ];
  for (const { locator: control, name } of controls) {
    await expect(control).toBeVisible();
    const box = await control.boundingBox();
    expect(box, `${name} is rendered`).not.toBeNull();
    expect(box!.width, "48 px touch target").toBeGreaterThanOrEqual(48);
    expect(box!.height, "48 px touch target").toBeGreaterThanOrEqual(48);
    await expectInsideViewport(page, control);
  }

  await expect(minimap).toBeVisible();
  await expectInsideViewport(page, minimap);
  const joystickBox = await joystick.boundingBox();
  const minimapBox = await minimap.boundingBox();
  const lookStickBox = await lookStick.boundingBox();
  const spyglassBox = await spyglass.boundingBox();
  const leaveBox = await leave.boundingBox();
  expect(boxesOverlap(joystickBox!, minimapBox!), "joystick stays clear of the minimap").toBe(false);
  expect(boxesOverlap(lookStickBox!, minimapBox!), "look stick stays clear of the minimap").toBe(false);
  expect(boxesOverlap(lookStickBox!, joystickBox!), "look stick stays clear of the joystick").toBe(false);
  expect(boxesOverlap(lookStickBox!, spyglassBox!), "look stick stays clear of the spyglass").toBe(false);
  expect(boxesOverlap(lookStickBox!, leaveBox!), "look stick stays clear of Leave").toBe(false);
  await captureHudEvidence(page, "phone-portrait-possessed");

  // Two-finger CDP touch: walk forward on the left stick while the right stick turns.
  const pose = () => page.evaluate(() => {
    const frame = (window as unknown as {
      __exploration: { camera: { frame: () => { camera?: { pose: { pitch: number; yaw: number } } } } };
    }).__exploration.camera.frame();
    return frame.camera?.pose ?? null;
  });
  const explorerPosition = () => page.locator(".minimap__explorer")
    .evaluate(node => `${node.style.left},${node.style.top}`);
  const beforePose = await pose();
  const beforePosition = await explorerPosition();
  expect(beforePose).not.toBeNull();
  const center = (box: Box) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 });
  const joystickCenter = center(joystickBox!);
  const lookCenter = center(lookStickBox!);
  const session = await page.context().newCDPSession(page);
  try {
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: [
        { id: 1, x: joystickCenter.x, y: joystickCenter.y },
        { id: 2, x: lookCenter.x, y: lookCenter.y }
      ],
      type: "touchStart"
    });
    await session.send("Input.dispatchTouchEvent", {
      touchPoints: [
        { id: 1, x: joystickCenter.x, y: joystickCenter.y - 40 },
        { id: 2, x: lookCenter.x + 44, y: lookCenter.y }
      ],
      type: "touchMove"
    });
    await page.waitForTimeout(800);
    const duringPose = await pose();
    const duringPosition = await explorerPosition();
    expect(duringPose, "two-finger gesture keeps the camera alive").not.toBeNull();
    expect(duringPose!.yaw, "right deflection turns the view").not.toBe(beforePose!.yaw);
    expect(duringPose!.yaw - beforePose!.yaw, "right stick turns towards screen-right")
      .toBeLessThan(0);
    expect(duringPosition, "the left stick walks while the right stick turns").not.toBe(beforePosition);
    await session.send("Input.dispatchTouchEvent", { touchPoints: [], type: "touchEnd" });
    const releasedPose = await pose();
    await nextFrames(page);
    const settlePose = await pose();
    expect(Math.abs(settlePose!.yaw - releasedPose!.yaw), "releasing the look stick stops the turn")
      .toBeLessThan(0.01);
  } finally {
    await session.detach();
  }

  // The portrait spyglass zoom owns the look stick's corner while it is raised.
  await waitLeaveUnlocked(page);
  await spyglass.tap();
  await expect(spyglass).toHaveAttribute("aria-pressed", "true");
  const zoom = page.locator(".exploration-ui__spyglass-zoom");
  await expect(zoom).toBeVisible();
  await expect(lookStick).toBeHidden();
  await expectInsideViewport(page, zoom);
  const zoomBox = await zoom.boundingBox();
  const zoomMinimapBox = await minimap.boundingBox();
  const zoomJoystickBox = await joystick.boundingBox();
  expect(boxesOverlap(zoomBox!, zoomMinimapBox!), "zoom stays clear of the minimap").toBe(false);
  expect(boxesOverlap(zoomBox!, zoomJoystickBox!), "zoom stays clear of the joystick").toBe(false);
  await spyglass.tap();
  await expect(zoom).toBeHidden();
  await expect(lookStick).toBeVisible();

  // Rotation keeps the same corners usable and returns to the drag-look surface.
  await page.setViewportSize({ height: 390, width: 844 });
  await nextFrames(page);
  await expectInsideViewport(page, minimap);
  await expect(lookStick).toBeHidden();
  for (const { locator: control } of controls.slice(0, 2).concat(controls.slice(3)))
    await expectInsideViewport(page, control);
  const landscapeJoystickBox = await joystick.boundingBox();
  const landscapeMinimapBox = await minimap.boundingBox();
  expect(boxesOverlap(landscapeJoystickBox!, landscapeMinimapBox!), "landscape joystick stays clear")
    .toBe(false);

  await waitLeaveUnlocked(page);
  await spyglass.tap();
  await expect(spyglass).toHaveAttribute("aria-pressed", "true");
  await expect(zoom).toBeVisible();
  await expectInsideViewport(page, zoom);
  const landscapeZoomBox = await zoom.boundingBox();
  const landscapeZoomMinimapBox = await minimap.boundingBox();
  const landscapeZoomJoystickBox = await joystick.boundingBox();
  expect(boxesOverlap(landscapeZoomBox!, landscapeZoomMinimapBox!), "zoom stays clear of the minimap").toBe(false);
  expect(boxesOverlap(landscapeZoomBox!, landscapeZoomJoystickBox!), "zoom stays clear of the joystick").toBe(false);
  await captureHudEvidence(page, "phone-landscape-spyglass");
  await leave.tap();
  await waitPhase(page, "cooldown");
  await expect(page.locator("html")).not.toHaveAttribute("data-exploration-hud", "hidden");
  await expect(entry).toBeDisabled();
  await expect(entry).toContainText("s");
});
