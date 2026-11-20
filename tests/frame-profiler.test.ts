import { afterEach, describe, expect, it } from "vitest";

import {
  activeFrameProfiler, currentFrameMark, markFrameStage, markRenderPass, startFrameProfiler, stopFrameProfiler
} from "../src/render-common/frame-profiler";
import {
  createGpuMemoryLedger, installGpuMemoryLedger, mipChainBytes, readGpuMemory, texelBytes
} from "../src/render-common/gpu-memory-ledger";
import { createPassLedger } from "../src/render-common/pass-ledger";

/** A WebGL2 stub whose timer queries resolve on the next poll with `nanoseconds`. */
const fakeTimerGl = (nanoseconds = 2e6, disjoint = () => false) => {
  const calls: string[] = [];
  const gl = {
    canvas: new EventTarget(),
    QUERY_RESULT: 1, QUERY_RESULT_AVAILABLE: 2,
    beginQuery: () => calls.push("begin"),
    createQuery: () => ({}),
    endQuery: () => calls.push("end"),
    getExtension: () => ({}),
    getParameter: () => disjoint(),
    getQueryParameter: (_query: unknown, parameter: number) => (parameter === 2 ? true : nanoseconds)
  };
  return { calls, gl: gl as unknown as WebGL2RenderingContext };
};

afterEach(() => stopFrameProfiler());

describe("pass ledger", () => {
  it("averages CPU, draws and triangles per frame and GPU per known frame", () => {
    const ledger = createPassLedger();
    ledger.addPass("world", 2, 10, 300);
    ledger.closeFrame(1, 4, ["world"]);
    ledger.addPass("world", 4, 30, 100);
    ledger.closeFrame(2, 6, ["world"]);
    expect(ledger.resolveGpu(1, 0, 3)).toBe(3);
    expect(ledger.resolveGpu(2, 0, null)).toBeNull();
    const report = ledger.report();
    expect(report).toMatchObject({ frameCpuMs: 5, frameGpuMs: 3, frames: 2, gpuFrames: 1, gpuUnknownFrames: 1 });
    expect(report.passes).toEqual([{ cpuMs: 3, drawCalls: 20, gpuMs: 3, name: "world", triangles: 200 }]);
  });

  it("counts a frame only when every pass result arrived; CPU-only stages have no GPU", () => {
    const ledger = createPassLedger();
    ledger.addPass("build", 1, 0, 0);
    ledger.addPass("shadows", 1, 5, 50);
    ledger.addPass("world", 1, 5, 50);
    ledger.closeFrame(7, 3, ["shadows", "world"]);
    expect(ledger.resolveGpu(7, 1, 2)).toBeNull();
    expect(ledger.report().gpuFrames).toBe(0);
    expect(ledger.resolveGpu(7, 0, 1)).toBe(3);
    const passes = Object.fromEntries(ledger.report().passes.map(pass => [pass.name, pass.gpuMs]));
    expect(passes).toEqual({ build: null, shadows: 1, world: 2 });
  });

  it("marks frames without a timer unknown and keeps results of frames closed before a reset", () => {
    const ledger = createPassLedger();
    ledger.closeFrame(1, 1, null);
    expect(ledger.report().gpuUnknownFrames).toBe(1);
    ledger.addPass("world", 1, 1, 1);
    ledger.closeFrame(2, 1, ["world"]);
    ledger.reset();
    expect(ledger.resolveGpu(2, 0, 5)).toBe(5);
    expect(ledger.report()).toMatchObject({ frameGpuMs: 5, frames: 0, gpuFrames: 1 });
  });
});

describe("frame profiler", () => {
  it("is inert until started: marks are dropped and nothing is open", () => {
    markRenderPass("world");
    markFrameStage("loop");
    expect(activeFrameProfiler()).toBeNull();
    expect(currentFrameMark()).toBeNull();
  });

  it("times sequential, never nested passes and reports draw counts per mark", () => {
    const { calls, gl } = fakeTimerGl(4e6);
    const counter = { drawCalls: 0, triangles: 0 };
    let clock = 0;
    const profiler = startFrameProfiler(gl, counter, () => clock);
    markRenderPass("ignored outside a frame");
    profiler.beginFrame();
    markFrameStage("build");
    clock += 2;
    markRenderPass("shadows");
    expect(currentFrameMark()).toBe("shadows");
    counter.drawCalls += 3; counter.triangles += 30; clock += 1;
    markRenderPass("world");
    counter.drawCalls += 7; counter.triangles += 70; clock += 1;
    profiler.endFrame();
    const frameGpu: number[] = [];
    profiler.poll(ms => frameGpu.push(ms));
    expect(calls).toEqual(["begin", "end", "begin", "end"]);
    expect(frameGpu).toEqual([8]);
    const report = profiler.sessionReport();
    expect(report).toMatchObject({ frameCpuMs: 4, frameGpuMs: 8, frames: 1, gpuFrames: 1 });
    expect(report.passes).toEqual([
      { cpuMs: 2, drawCalls: 0, gpuMs: null, name: "build", triangles: 0 },
      { cpuMs: 1, drawCalls: 3, gpuMs: 4, name: "shadows", triangles: 30 },
      { cpuMs: 1, drawCalls: 7, gpuMs: 4, name: "world", triangles: 70 }
    ]);
    expect(profiler.rollWindow().frames).toBe(1);
    expect(profiler.rollWindow().frames).toBe(0);
    expect(profiler.sessionReport().frames).toBe(1);
  });

  it("drops a whole batch on a disjoint event", () => {
    const { gl } = fakeTimerGl(1e6, () => true);
    const profiler = startFrameProfiler(gl, { drawCalls: 0, triangles: 0 }, () => 0);
    profiler.beginFrame();
    markRenderPass("world");
    profiler.endFrame();
    profiler.poll(() => { throw new Error("no frame GPU expected"); });
    expect(profiler.sessionReport()).toMatchObject({ frameGpuMs: null, gpuUnknownFrames: 1 });
  });
});

describe("GPU memory ledger", () => {
  it("sizes formats and mip chains", () => {
    expect(texelBytes(0x8058)).toBe(4);
    expect(texelBytes(0x881a)).toBe(8);
    expect(texelBytes(0x1908, 0x1406)).toBe(16);
    expect(texelBytes(0x1907, 0x1401)).toBe(3);
    expect(mipChainBytes(4, 4, 4, 1, 3)).toBe((16 + 4 + 1) * 4);
  });

  it("keeps re-uploads replacing, targets separate and deletions out", () => {
    const ledger = createGpuMemoryLedger();
    const texture = {}, target = {}, buffer = {};
    ledger.setTextureImage(texture, "0", 100);
    ledger.setTextureImage(texture, "0", 120);
    ledger.setTextureImage(texture, "1", 30);
    ledger.setTextureStorage(target, 400);
    ledger.markTarget(target);
    ledger.setBuffer(buffer, 64);
    expect(ledger.report()).toEqual({ bufferBytes: 64, buffers: 1, renderbufferBytes: 0, targetTextureBytes: 400,
      textureBytes: 150, textures: 2 });
    ledger.deleteTexture(texture);
    ledger.deleteBuffer(buffer);
    expect(ledger.report()).toMatchObject({ bufferBytes: 0, textureBytes: 0, textures: 1 });
  });

  it("follows bindings through the wrapped context calls", () => {
    const prototype = {
      activeTexture() {}, bindBuffer() {}, bindRenderbuffer() {}, bindTexture() {}, bufferData() {},
      deleteTexture() {}, framebufferTexture2D() {}, renderbufferStorageMultisample() {}, texImage2D() {},
      texStorage2D() {}
    };
    installGpuMemoryLedger(prototype);
    const gl = Object.create(prototype) as Record<string, (...args: unknown[]) => void>;
    const colour = {}, depth = {}, renderbuffer = {}, buffer = {};
    gl.activeTexture!(0x84c0 + 2);
    gl.bindTexture!(0x0de1, colour);
    gl.texStorage2D!(0x0de1, 2, 0x8058, 8, 8);
    gl.bindTexture!(0x0de1, depth);
    gl.texImage2D!(0x0de1, 0, 0x88f0, 4, 4, 0, 0x84f9, 0x84fa, null);
    gl.framebufferTexture2D!(0x8d40, 0x821a, 0x0de1, depth, 0);
    gl.bindRenderbuffer!(0x8d41, renderbuffer);
    gl.renderbufferStorageMultisample!(0x8d41, 4, 0x8058, 2, 2);
    gl.bindBuffer!(0x8892, buffer);
    gl.bufferData!(0x8892, new Float32Array(10), 0x88e4);
    expect(readGpuMemory(gl)).toEqual({ bufferBytes: 40, buffers: 1, renderbufferBytes: 64,
      targetTextureBytes: 64, textureBytes: (64 + 16) * 4, textures: 2 });
  });
});
