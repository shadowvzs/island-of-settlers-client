import { afterEach, describe, expect, it, vi } from "vitest";

import { settingsStorage } from "../src/app/settings/graphics-settings";
import { BUTTON_ZOOM_STEP, zoomAroundCentre } from "../src/render-common/camera-controller";
import {
  canZoom,
  createCamera,
  getMinZoom,
  MAX_ZOOM
} from "../src/render-common/camera-state";

const CELLS: [number, number] = [128, 128];

const createViewCamera = (zoom: number) => ({
  ...createCamera(60, 70, zoom),
  viewportHeight: 844,
  viewportWidth: 390
});

describe("zoom buttons", () => {
  it("zooms one step around the screen centre", () => {
    const camera = createViewCamera(1);
    zoomAroundCentre(camera, BUTTON_ZOOM_STEP, CELLS);
    expect(camera.zoom).toBeCloseTo(BUTTON_ZOOM_STEP);
    expect(camera.centerX).toBeCloseTo(60);
    expect(camera.centerZ).toBeCloseTo(70);
    zoomAroundCentre(camera, 1 / BUTTON_ZOOM_STEP, CELLS);
    expect(camera.zoom).toBeCloseTo(1);
  });

  it("keeps the centre when rotated", () => {
    const camera = { ...createViewCamera(1), yaw: 0.8 };
    zoomAroundCentre(camera, 1 / BUTTON_ZOOM_STEP, CELLS);
    expect(camera.centerX).toBeCloseTo(60);
    expect(camera.centerZ).toBeCloseTo(70);
  });

  it("stops at the wheel's zoom limits and reports them", () => {
    const camera = createViewCamera(MAX_ZOOM / 1.1);
    expect(canZoom(camera, 1, ...CELLS)).toBe(true);
    zoomAroundCentre(camera, BUTTON_ZOOM_STEP, CELLS);
    expect(camera.zoom).toBe(MAX_ZOOM);
    expect(canZoom(camera, 1, ...CELLS)).toBe(false);
    expect(canZoom(camera, -1, ...CELLS)).toBe(true);
    for (let step = 0; step < 40; step++) zoomAroundCentre(camera, 1 / BUTTON_ZOOM_STEP, CELLS);
    expect(camera.zoom).toBe(getMinZoom(...CELLS));
    expect(canZoom(camera, -1, ...CELLS)).toBe(false);
    expect(canZoom(camera, 1, ...CELLS)).toBe(true);
  });
});

describe("map editor setting", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("starts the information box hidden and preserves explicit preferences", () => {
    const stored = new Map<string, string>();
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value)
    });
    expect(settingsStorage.readInfoBox()).toBe(false);
    settingsStorage.writeInfoBox(true);
    expect(settingsStorage.readInfoBox()).toBe(true);
    settingsStorage.writeInfoBox(false);
    expect(settingsStorage.readInfoBox()).toBe(false);
  });
});
