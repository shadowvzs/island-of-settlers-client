import { DoubleSide, FrontSide, type WebGPURenderer } from "three/webgpu";
import { describe, expect, it, vi } from "vitest";

import { createAsyncPipelineCompiler } from "../src/renderers/three/webgpu/async-pipeline-compiler";

interface FakeRenderObject {
  context: Record<string, unknown>;
  drawRange: unknown;
  group: unknown;
  key: string;
  material: { side: number };
  object: { name: string; parent: null; type: string };
  onDispose: () => void;
}

/** The r186 renderer members the compiler touches; one shader/pipeline per render object key. */
const createFakeRenderer = () => {
  const renderObjects = new Map<string, FakeRenderObject>();
  const nodeData = new Map<FakeRenderObject, { nodeBuilderState?: { fragmentShader: string; vertexShader: string } }>();
  const caches = new Map<string, unknown>();
  const vertex = new Map<string, object>();
  const fragment = new Map<string, object>();
  const built: string[] = [];
  const drawn: string[] = [];
  const stateOf = (renderObject: FakeRenderObject) =>
    ({ fragmentShader: `fs:${renderObject.key}`, vertexShader: `vs:${renderObject.key}` });
  const build = (renderObject: FakeRenderObject) => {
    built.push(`${renderObject.key}:${renderObject.material.side}:${String(renderer._renderTarget)}`);
    const state = stateOf(renderObject);
    nodeData.set(renderObject, { nodeBuilderState: state });
    return state;
  };
  const buildPipeline = (renderObject: FakeRenderObject) => {
    const state = nodeData.get(renderObject)?.nodeBuilderState ?? build(renderObject);
    vertex.set(state.vertexShader, {});
    fragment.set(state.fragmentShader, {});
    caches.set(renderObject.key, {});
  };
  const renderer = {
    _bindings: { updateForRender: vi.fn(), updateSharedForRender: vi.fn() },
    _currentRenderBundle: null,
    _currentRenderContext: {},
    _geometries: { updateForRender: vi.fn() },
    _isPreCompiling: false,
    _nodes: {
      get: (renderObject: FakeRenderObject) => nodeData.get(renderObject) ?? {},
      getForRender: build,
      getForRenderCacheKey: (renderObject: FakeRenderObject) => renderObject.key,
      needsRefresh: () => 2,
      nodeBuilderCache: new Map(),
      updateAfter: vi.fn(),
      updateBefore: vi.fn(),
      updateForRender: vi.fn()
    },
    _objects: {
      get: (object: { key: string; material: { side: number } }) => {
        let renderObject = renderObjects.get(object.key);
        if (renderObject === undefined) {
          renderObject = { context: {}, drawRange: null, group: null, key: object.key,
            material: object.material, object: { name: object.key, parent: null, type: "Mesh" },
            onDispose: () => undefined };
          renderObjects.set(object.key, renderObject);
        }
        return renderObject;
      }
    },
    _pipelines: {
      _getRenderCacheKey: (renderObject: FakeRenderObject) => renderObject.key,
      caches,
      getForRender: (renderObject: FakeRenderObject, promises?: Promise<unknown>[]) => {
        buildPipeline(renderObject);
        promises?.push(Promise.resolve());
      },
      isReady: (renderObject: FakeRenderObject) => caches.has(renderObject.key),
      programs: { fragment, vertex },
      updateForRender: buildPipeline
    },
    _renderObjectDirect: vi.fn(),
    _renderTarget: null as string | null,
    backend: { draw: (renderObject: FakeRenderObject) => drawn.push(renderObject.key) },
    getActiveCubeFace: () => 0,
    getActiveMipmapLevel: () => 0,
    getMRT: () => null,
    getRenderTarget: () => renderer._renderTarget,
    info: {},
    setMRT: vi.fn(),
    setRenderTarget: (target: string | null) => { renderer._renderTarget = target; }
  };
  const draw = (key: string, side: number = FrontSide) => {
    const material = { side };
    renderer._renderObjectDirect.call(renderer, { geometry: { drawRange: null }, key, material }, material,
      null, null, null, null, null, null);
  };
  return { built, draw, drawn, renderer };
};

const drainQueue = () => new Promise(resolve => setTimeout(resolve, 20));
const passThrough = <T>(build: () => T) => build();

describe("WebGPU async pipeline compiler", () => {
  it("draws synchronously until enabled", () => {
    const fake = createFakeRenderer();
    createAsyncPipelineCompiler(fake.renderer as unknown as WebGPURenderer, passThrough);
    fake.draw("cart");
    expect(fake.drawn).toEqual(["cart"]);
  });

  it("hides an uncompiled object until its pipeline compiled between frames", async () => {
    const fake = createFakeRenderer();
    const compiler = createAsyncPipelineCompiler(fake.renderer as unknown as WebGPURenderer, passThrough);
    compiler.enable();
    fake.draw("crowd");
    expect(fake.drawn).toEqual([]);
    expect(compiler.stats().hidden).toBe(1);
    fake.draw("crowd");
    expect(fake.built).toEqual([]);
    compiler.endFrame();
    await drainQueue();
    expect(compiler.stats().hidden).toBe(0);
    fake.draw("crowd");
    expect(fake.drawn).toEqual(["crowd"]);
    expect(compiler.stats()).toMatchObject({ completed: 1, maxHiddenFrames: 1, queued: 1 });
  });

  it("draws an object whose node state and pipeline are cached at once", async () => {
    const fake = createFakeRenderer();
    const compiler = createAsyncPipelineCompiler(fake.renderer as unknown as WebGPURenderer, passThrough);
    fake.draw("roof");
    compiler.enable();
    fake.draw("roof");
    expect(fake.drawn).toEqual(["roof", "roof"]);
    expect(compiler.stats().queued).toBe(0);
  });

  it("builds under the draw's side and render target, then restores the current ones", async () => {
    const fake = createFakeRenderer();
    const compiler = createAsyncPipelineCompiler(fake.renderer as unknown as WebGPURenderer, passThrough);
    compiler.enable();
    const material = { side: FrontSide as number };
    fake.renderer.setRenderTarget("scene-target");
    fake.renderer._renderObjectDirect.call(fake.renderer, { geometry: { drawRange: null }, key: "glass", material },
      material, null, null, null, null, null, null);
    material.side = DoubleSide;
    fake.renderer.setRenderTarget(null);
    await drainQueue();
    expect(fake.built).toEqual([`glass:${FrontSide}:scene-target`]);
    expect(material.side).toBe(DoubleSide);
    expect(fake.renderer.getRenderTarget()).toBeNull();
  });

  it("prewarms an object not drawn yet with its scene's captured draw", async () => {
    const fake = createFakeRenderer();
    const compiler = createAsyncPipelineCompiler(fake.renderer as unknown as WebGPURenderer, passThrough);
    fake.draw("road");
    compiler.enable();
    const cart = { geometry: { drawRange: null }, key: "cart", material: { isNodeMaterial: true, side: FrontSide } };
    expect(compiler.prewarm(cart as never, null)).toBe("later");
    compiler.requestSceneDraws();
    fake.draw("road");
    compiler.endFrame();
    expect(compiler.prewarm(cart as never, null)).toBe("done");
    await drainQueue();
    fake.draw("cart");
    expect(fake.drawn).toEqual(["road", "road", "cart"]);
    expect(compiler.stats()).toMatchObject({ completed: 0, prewarmed: 1, queued: 0 });
  });

  it("restores Three's draw method on dispose", () => {
    const fake = createFakeRenderer();
    const stock = fake.renderer._renderObjectDirect;
    const compiler = createAsyncPipelineCompiler(fake.renderer as unknown as WebGPURenderer, passThrough);
    expect(fake.renderer._renderObjectDirect).not.toBe(stock);
    compiler.dispose();
    expect(fake.renderer._renderObjectDirect).toBe(stock);
  });
});
