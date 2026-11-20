import { describe, expect, it } from "vitest";

import { applyPinch } from "../src/render-common/camera-controller";
import {
  type CameraState,
  createCamera,
  MAX_ZOOM,
  rotateAroundUp} from "../src/render-common/camera-state";
import { projectToScreen, unprojectToPlane } from "../src/render-common/iso-projection";
import {
  classifyPress,
  getPinchZoomFactor,
  LONG_PRESS_MS,
  measurePinch,
  TAP_MAX_MOVE_PIXELS,
  TAP_MAX_MS
} from "../src/render-common/pointer-gestures";

const CENTRE = { x: 200, y: 400 };
const CELLS: [number, number] = [128, 128];

/** The ground point (height 0) under a client pixel, the inverse of the camera's pan math. */
const groundUnder = (camera: CameraState, x: number, y: number) => {
  const centre = projectToScreen(camera.centerX, 0, camera.centerZ);
  const moved = unprojectToPlane(
    centre.screenX + (x - CENTRE.x) / camera.zoom,
    centre.screenY + (y - CENTRE.y) / camera.zoom,
    0
  );
  const turned = rotateAroundUp(moved.x - camera.centerX, moved.z - camera.centerZ, camera.yaw);
  return { x: camera.centerX + turned.x, z: camera.centerZ + turned.z };
};

const pinchOf = (ax: number, ay: number, bx: number, by: number) =>
  measurePinch({ x: ax, y: ay }, { x: bx, y: by });

describe("pinch math", () => {
  it("measures the finger distance and midpoint", () => {
    expect(pinchOf(100, 100, 400, 500)).toEqual({ distance: 500, midX: 250, midY: 300 });
  });

  it("zooms by the spread ratio and ignores a zero distance", () => {
    const from = pinchOf(0, 0, 100, 0);
    expect(getPinchZoomFactor(from, pinchOf(0, 0, 200, 0))).toBe(2);
    expect(getPinchZoomFactor(from, pinchOf(0, 0, 50, 0))).toBe(0.5);
    expect(getPinchZoomFactor(pinchOf(5, 5, 5, 5), from)).toBe(1);
  });

  it.each([0, 0.7])("keeps the ground under the fingers (yaw %s)", (yaw) => {
    const camera = createCamera(64, 64, 1);
    camera.yaw = yaw;
    const from = pinchOf(120, 300, 220, 420);
    const to = pinchOf(60, 260, 300, 500);
    const anchored = groundUnder(camera, from.midX, from.midY);
    applyPinch(camera, from, to, CENTRE, CELLS);
    expect(camera.zoom).toBeGreaterThan(1);
    const after = groundUnder(camera, to.midX, to.midY);
    expect(after.x).toBeCloseTo(anchored.x, 6);
    expect(after.z).toBeCloseTo(anchored.z, 6);
  });

  it("pans with the midpoint when the spread stays", () => {
    const camera = createCamera(64, 64, 1.5);
    const anchored = groundUnder(camera, 150, 350);
    applyPinch(camera, pinchOf(100, 350, 200, 350), pinchOf(140, 300, 240, 300), CENTRE, CELLS);
    expect(camera.zoom).toBe(1.5);
    const after = groundUnder(camera, 190, 300);
    expect(after.x).toBeCloseTo(anchored.x, 6);
    expect(after.z).toBeCloseTo(anchored.z, 6);
  });

  it("stops at the wheel's zoom limit", () => {
    const camera = createCamera(64, 64, 2.5);
    applyPinch(camera, pinchOf(100, 400, 300, 400), pinchOf(0, 400, 400, 400), CENTRE, CELLS);
    expect(camera.zoom).toBe(MAX_ZOOM);
  });
});

describe("press classification", () => {
  const press = { durationMs: 120, maxPointers: 1, movedPixels: 2 };

  it("a short still press is a tap", () => {
    expect(classifyPress(press)).toBe("tap");
    expect(classifyPress({ ...press, movedPixels: TAP_MAX_MOVE_PIXELS })).toBe("tap");
  });

  it("moving makes a drag", () => {
    expect(classifyPress({ ...press, movedPixels: TAP_MAX_MOVE_PIXELS + 1 })).toBe("drag");
  });

  it("a second finger makes a pinch, even a quick still one", () => {
    expect(classifyPress({ ...press, maxPointers: 2 })).toBe("pinch");
  });

  it("holding still makes a slow press, then a long press", () => {
    expect(classifyPress({ ...press, durationMs: TAP_MAX_MS + 1 })).toBe("slow");
    expect(classifyPress({ ...press, durationMs: LONG_PRESS_MS })).toBe("long-press");
  });
});
