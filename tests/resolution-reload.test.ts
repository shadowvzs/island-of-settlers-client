import { afterEach, describe, expect, it, vi } from "vitest";

import { startRenderLoop } from "../src/app/render-loop";
import {
  applyResolution,
  createResolutionSession,
  settingsStorage
} from "../src/app/settings/graphics-settings";
import { sizeRefractionTarget } from "../src/renderers/three/three-renderer-refraction";

vi.mock("../src/render-common/camera-controller", () => ({
  createCameraController: () => ({ dispose: () => {}, update: () => {} })
}));

const noop = () => {};

const stubStorage = () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value)
  });
  return values;
};

/** Frames queued by requestAnimationFrame, run one at a time by the test. */
const stubAnimationFrames = (devicePixelRatio: number) => {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => queue.push(callback));
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("window", { devicePixelRatio });
  let now = 0;
  return { step: () => { now += 16; queue.shift()?.(now); } };
};

const fakeRenderer = () => {
  const drawingBuffer = { height: 0, width: 0 };
  const resizes: [number, number, number][] = [];
  const render = vi.fn();
  const renderer = {
    gl: {
      canvas: new EventTarget(), drawArrays: noop, drawArraysInstanced: noop, drawElements: noop,
      drawElementsInstanced: noop, getExtension: () => null
    },
    render,
    resize: (width: number, height: number, pixelRatio: number) => {
      resizes.push([width, height, pixelRatio]);
      drawingBuffer.width = Math.floor(width * pixelRatio);
      drawingBuffer.height = Math.floor(height * pixelRatio);
    }
  };
  return { drawingBuffer, render, renderer, resizes };
};

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("live resolution profiles", () => {
  it("applies a same-antialias change to the active pixel-ratio profile without reloading", () => {
    stubStorage();
    const session = createResolutionSession("sharp", false);
    const reload = vi.fn();
    expect(applyResolution(session, "balanced", reload)).toBe("live");
    expect(reload).not.toHaveBeenCalled();
    expect(session.mode).toBe("balanced");
    expect(session.state.profile).toEqual({ antialias: true, maxPixelRatio: 1.5 });
    expect(session.state.revision).toBe(1);
    expect(settingsStorage.readResolution()).toBe("balanced");
  });

  it("resolves Auto before comparing: the same profile lives, a different antialias reloads", () => {
    stubStorage();
    const desktop = createResolutionSession("auto", false);
    expect(desktop.state.profile).toEqual(createResolutionSession("sharp", false).state.profile);
    const desktopReload = vi.fn();
    expect(applyResolution(desktop, "sharp", desktopReload)).toBe("live");
    expect(desktopReload).not.toHaveBeenCalled();

    const touch = createResolutionSession("auto", true);
    expect(touch.state.profile).toEqual({ antialias: false, maxPixelRatio: 1 });
    const touchReload = vi.fn();
    expect(applyResolution(touch, "balanced", touchReload)).toBe("reload");
    expect(touchReload).toHaveBeenCalledOnce();
    expect(touch.state.profile).toEqual({ antialias: false, maxPixelRatio: 1 });
    expect(touch.state.revision).toBe(0);
  });

  it("keeps the reload for an antialias change and leaves the running profile untouched", () => {
    stubStorage();
    const session = createResolutionSession("sharp", false);
    const reload = vi.fn();
    expect(applyResolution(session, "fast", reload)).toBe("reload");
    expect(reload).toHaveBeenCalledOnce();
    expect(session.mode).toBe("sharp");
    expect(session.state.profile).toEqual({ antialias: true, maxPixelRatio: Infinity });
    expect(session.state.revision).toBe(0);
    // The stored choice is already the one the reload will start with.
    expect(settingsStorage.readResolution()).toBe("fast");
  });
});

describe("live resolution resize", () => {
  it("updates the drawing buffer for a changed profile even when the CSS viewport did not change", () => {
    stubStorage();
    const frames = stubAnimationFrames(2);
    const { drawingBuffer, render, renderer, resizes } = fakeRenderer();
    const session = createResolutionSession("sharp", false);
    const reload = vi.fn();
    const settlement = { ticks: 0 };
    const updateSettlement = vi.fn(() => {
      settlement.ticks += 1;
      return { buildings: [], roads: [], roadRevision: 0 };
    });
    const loop = startRenderLoop({
      camera: { viewportHeight: 0, viewportWidth: 0 },
      canvas: {}, onStats: noop,
      renderer, resolution: session.state, stress: null,
      updateAnimals: noop, updateBirds: noop, updateButterflies: noop, updateCritters: noop,
      updateEnvironment: noop, updateFelling: noop, updateGrowth: noop, updateSettlement,
      viewport: { clientHeight: 600, clientWidth: 800 },
      world: { cellsX: 8, cellsZ: 8 }
    } as unknown as Parameters<typeof startRenderLoop>[0]);

    frames.step();
    expect(resizes).toEqual([[800, 600, 2]]);
    expect(drawingBuffer).toEqual({ height: 1200, width: 1600 });

    // The viewport is unchanged; the new profile's revision must still force the resize.
    expect(applyResolution(session, "balanced", reload)).toBe("live");
    frames.step();
    loop.stop();
    expect(reload).not.toHaveBeenCalled();
    expect(resizes).toEqual([[800, 600, 2], [800, 600, 1.5]]);
    expect(drawingBuffer).toEqual({ height: 900, width: 1200 });
    // The same scene and simulation advanced once per frame; the live change did not rerun either.
    expect(render).toHaveBeenCalledTimes(2);
    expect(updateSettlement).toHaveBeenCalledTimes(2);
    expect(settlement.ticks).toBe(2);
  });

  it("also resizes the refraction target that depends on the drawing buffer", () => {
    const target = {
      height: 1,
      setSize: vi.fn((width: number, height: number) => {
        target.width = width;
        target.height = height;
      }),
      width: 1
    };
    const viewport = { x: 1200, y: 900 };
    sizeRefractionTarget(
      target as unknown as Parameters<typeof sizeRefractionTarget>[0],
      viewport as unknown as Parameters<typeof sizeRefractionTarget>[1],
      0.5
    );
    expect(target.setSize).toHaveBeenCalledWith(600, 450);
    sizeRefractionTarget(
      target as unknown as Parameters<typeof sizeRefractionTarget>[0],
      viewport as unknown as Parameters<typeof sizeRefractionTarget>[1],
      0.5
    );
    expect(target.setSize).toHaveBeenCalledTimes(1);
  });
});
