import { afterEach, describe, expect, it, vi } from "vitest";

import { startRenderLoop } from "../src/app/render-loop";
import { activeFrameProfiler, markRenderPass } from "../src/render-common/frame-profiler";
import { createResolutionState } from "../src/render-common/resolution";

vi.mock("../src/render-common/camera-controller", () => ({
  createCameraController: () => ({ dispose: () => {}, update: () => {} })
}));

/** Frames queued by requestAnimationFrame, run one at a time by the test. */
const stubAnimationFrames = () => {
  const queue: FrameRequestCallback[] = [];
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => queue.push(callback));
  vi.stubGlobal("document", { hidden: false });
  vi.stubGlobal("window", { devicePixelRatio: 1 });
  let now = 0;
  return { pending: () => queue.length, step: () => { now += 16; queue.shift()?.(now); } };
};

const noop = () => {};
const fakeRenderer = (render: () => void) => ({
  gl: {
    canvas: new EventTarget(), drawArrays: noop, drawArraysInstanced: noop, drawElements: noop,
    drawElementsInstanced: noop, getExtension: () => null
  },
  render,
  resize: noop
});

afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("render loop resilience", () => {
  it("keeps scheduling and rendering frames after one frame throws", () => {
    const frames = stubAnimationFrames();
    const error = vi.spyOn(console, "error").mockImplementation(noop);
    let renders = 0;
    const renderer = fakeRenderer(() => {
      renders++;
      if (renders === 2) throw new Error("bad frame");
    });
    const loop = startRenderLoop({
      camera: { viewportHeight: 0, viewportWidth: 0 }, canvas: {}, onStats: noop,
      renderer, resolution: createResolutionState({ antialias: false, maxPixelRatio: 1 }),
      stress: null, viewport: { clientHeight: 0, clientWidth: 0 },
      world: { cellsX: 8, cellsZ: 8 },
      updateAnimals: noop, updateBirds: noop, updateButterflies: noop, updateCritters: noop,
      updateEnvironment: noop, updateFelling: noop, updateGrowth: noop
    } as unknown as Parameters<typeof startRenderLoop>[0]);
    for (let frame = 0; frame < 5; frame++) frames.step();
    loop.stop();
    expect(renders).toBe(5);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it("hands a requested frame to the screenshot sink right after its render", () => {
    const frames = stubAnimationFrames();
    const events: string[] = [];
    const loop = startRenderLoop({
      camera: { viewportHeight: 0, viewportWidth: 0 }, canvas: {}, onStats: noop,
      onScreenshot: () => events.push("capture"),
      renderer: fakeRenderer(() => events.push("render")),
      resolution: createResolutionState({ antialias: false, maxPixelRatio: 1 }),
      stress: null, viewport: { clientHeight: 0, clientWidth: 0 },
      world: { cellsX: 8, cellsZ: 8 },
      updateAnimals: noop, updateBirds: noop, updateButterflies: noop, updateCritters: noop,
      updateEnvironment: noop, updateFelling: noop, updateGrowth: noop
    } as unknown as Parameters<typeof startRenderLoop>[0]);
    frames.step();
    expect(events).toEqual(["render"]);
    loop.requestScreenshot();
    frames.step();
    expect(events).toEqual(["render", "render", "capture"]);
    frames.step();
    expect(events).toEqual(["render", "render", "capture", "render"]);
    loop.stop();
  });

  it("profiles every frame's stages behind the dev flag and stops with the loop", () => {
    const frames = stubAnimationFrames();
    const renderer = fakeRenderer(() => markRenderPass("world"));
    const loop = startRenderLoop({
      camera: { viewportHeight: 0, viewportWidth: 0 }, canvas: {}, onStats: noop, passProfile: true,
      renderer, resolution: createResolutionState({ antialias: false, maxPixelRatio: 1 }),
      stress: null, viewport: { clientHeight: 0, clientWidth: 0 },
      world: { cellsX: 8, cellsZ: 8 },
      updateAnimals: noop, updateBirds: noop, updateButterflies: noop, updateCritters: noop,
      updateEnvironment: noop, updateFelling: noop, updateGrowth: noop
    } as unknown as Parameters<typeof startRenderLoop>[0]);
    for (let frame = 0; frame < 3; frame++) frames.step();
    const report = activeFrameProfiler()!.sessionReport();
    loop.stop();
    expect(report.frames).toBe(3);
    // No timer extension in the stub: GPU time stays unknown instead of reading as zero.
    expect(report).toMatchObject({ frameGpuMs: null, gpuUnknownFrames: 3 });
    expect(report.passes.map(pass => pass.name)).toEqual([
      "loop.environment", "loop.settlement", "loop.workersMounts", "loop.beforeRender", "loop.ambient", "world",
      "loop.afterRender"
    ]);
    expect(activeFrameProfiler()).toBeNull();
  });
});
