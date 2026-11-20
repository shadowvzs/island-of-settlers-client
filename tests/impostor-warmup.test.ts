import { Box3, DataTexture, Mesh, type Object3D, type WebGLRenderer, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { createPresentationScheduler } from "../src/render-common/presentation-scheduler";
import { createImpostorWarmup } from "../src/renderers/three/impostor-warmup";
import { createSlicedTextureUpload } from "../src/renderers/three/sliced-texture-upload";

interface Copy {
  dstLevel: number;
  generateMipmaps: boolean;
  rows: [number, number];
}

/** Records the renderer calls of the warm-up (no WebGL context). */
const createFakeRenderer = () => {
  const calls: string[] = [];
  const copies: Copy[] = [];
  const initialized: { dataReady: boolean }[] = [];
  const drawnParents: (Object3D | null)[] = [];
  let finishCompile = () => {};
  const fences = { signaled: true, waiting: 0 };
  const gl = {
    SIGNALED: 1,
    SYNC_GPU_COMMANDS_COMPLETE: 2,
    SYNC_STATUS: 3,
    deleteSync: () => {},
    fenceSync: () => ({}),
    flush: () => {},
    getSyncParameter: () => {
      if (!fences.signaled) fences.waiting++;
      return fences.signaled ? 1 : 0;
    },
    isContextLost: () => false
  };
  const compiled = new Promise<void>(resolve => { finishCompile = resolve; });
  const renderer = {
    clear: () => calls.push("clear"),
    compileAsync: () => {
      calls.push("compile");
      return compiled;
    },
    copyTextureToTexture: (_source: DataTexture, target: DataTexture, region: Box3, _position: unknown,
      _sourceLevel: number, dstLevel: number) => {
      copies.push({ dstLevel, generateMipmaps: target.generateMipmaps, rows: [region.min.y, region.max.y] });
    },
    getContext: () => gl,
    getRenderTarget: () => null,
    initTexture: (texture: DataTexture) => initialized.push({ dataReady: texture.source.dataReady }),
    render: (scene: Object3D) => {
      calls.push("render");
      drawnParents.push(...scene.children.map(child => child.parent));
    },
    setRenderTarget: (target: unknown) => calls.push(target ? "target" : "screen"),
    state: { pixelStorei: () => {} }
  };
  return { calls, copies, drawnParents, fences, finishCompile: () => finishCompile(), initialized,
    renderer: renderer as unknown as WebGLRenderer };
};

const createTexture = (size: number, mips: boolean) => {
  const texture = new DataTexture(new Uint8Array(size * size * 4), size, size);
  if (mips) {
    texture.mipmaps = [size, size / 2, size / 4].map(width => ({ data: new Uint8Array(width * width * 4),
      height: width, width }));
    texture.generateMipmaps = false;
  } else texture.generateMipmaps = true;
  return texture;
};

const coveredRows = (copies: Copy[], level: number) => copies.filter(copy => copy.dstLevel === level)
  .reduce((rows, copy) => rows + copy.rows[1] - copy.rows[0], 0);

describe("sliced texture upload", () => {
  it("allocates without data once, then copies every level in row bands", () => {
    const fake = createFakeRenderer();
    const texture = createTexture(8, true);
    const upload = createSlicedTextureUpload(fake.renderer, texture);
    const rowBytes = 8 * 4;
    let steps = 0;
    while (!upload.step(rowBytes * 3)) steps++;
    expect(fake.initialized).toEqual([{ dataReady: false }]);
    expect(texture.source.dataReady).toBe(true);
    expect([coveredRows(fake.copies, 0), coveredRows(fake.copies, 1), coveredRows(fake.copies, 2)])
      .toEqual([8, 4, 2]);
    expect(steps).toBeGreaterThan(1);
    expect(upload.bytes).toBe((64 + 16 + 4) * 4);
  });

  it("sends at least one row and generates GPU mips only after the last base band", () => {
    const fake = createFakeRenderer();
    const texture = createTexture(4, false);
    const upload = createSlicedTextureUpload(fake.renderer, texture);
    while (!upload.step(1));
    expect(fake.copies.map(copy => copy.rows)).toEqual([[0, 1], [1, 2], [2, 3], [3, 4]]);
    expect(fake.copies.map(copy => copy.generateMipmaps)).toEqual([false, false, false, true]);
    expect(texture.generateMipmaps).toBe(true);
  });
});

describe("impostor warm-up", () => {
  const bounds = new Box3(new Vector3(0, 0, 0), new Vector3(100, 5, 80));

  it("resolves after the uploads, the background link and one offscreen draw", async () => {
    const fake = createFakeRenderer();
    const scheduler = createPresentationScheduler();
    const layers = [new Mesh(), new Mesh()];
    let done = false;
    const warmup = createImpostorWarmup(fake.renderer, scheduler)([createTexture(8, true)], layers, bounds);
    void warmup.done.then(() => { done = true; });
    for (let frame = 0; frame < 20; frame++) scheduler.runBudget(4);
    await Promise.resolve();
    expect(done).toBe(false);
    expect(fake.calls).toEqual(["compile", "compile"]);
    fake.finishCompile();
    await new Promise(resolve => setTimeout(resolve, 0));
    for (let frame = 0; frame < 3; frame++) scheduler.runBudget(4);
    await warmup.done;
    expect(fake.calls.slice(2)).toEqual(["target", "clear", "render", "screen", "target", "clear", "render", "screen"]);
    expect(fake.drawnParents.every(parent => parent !== null)).toBe(true);
    expect(layers.every(layer => layer.parent === null)).toBe(true);
    expect(scheduler.size()).toBe(0);
  });

  it("issues the next band only after the previous band's GPU fence passed", () => {
    const fake = createFakeRenderer();
    const scheduler = createPresentationScheduler();
    createImpostorWarmup(fake.renderer, scheduler)([createTexture(2048, false)], [new Mesh()], bounds);
    scheduler.runBudget(4);
    expect(fake.copies).toHaveLength(1);
    fake.fences.signaled = false;
    for (let frame = 0; frame < 5; frame++) scheduler.runBudget(4);
    expect(fake.copies).toHaveLength(1);
    expect(fake.fences.waiting).toBe(5);
    fake.fences.signaled = true;
    scheduler.runBudget(4);
    expect(fake.copies).toHaveLength(2);
    expect(fake.copies[0]!.rows).toEqual([0, 256]);
  });

  it("cancel drops the job and settles done", async () => {
    const fake = createFakeRenderer();
    const scheduler = createPresentationScheduler();
    const warmup = createImpostorWarmup(fake.renderer, scheduler)([createTexture(8, true)], [new Mesh()], bounds);
    warmup.cancel();
    await warmup.done;
    expect(scheduler.size()).toBe(0);
    expect(fake.copies).toEqual([]);
  });
});
