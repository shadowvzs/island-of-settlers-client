import { type IUniform, OrthographicCamera, PerspectiveCamera, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";

import {
  EXPLORATION_CLOUD_SAMPLE_LIMIT,
  explorationCloudSampleCount
} from "../src/renderers/three/exploration-weather/exploration-sky-cloud-glsl";
import {
  createExplorationSkyObject,
  type ExplorationSkyObjectOptions
} from "../src/renderers/three/exploration-weather/exploration-sky-object";

const createUniforms = (): Record<string, IUniform> => ({
  uAmbientSky: { value: new Float32Array([0.3, 0.4, 0.6]) },
  uCloudCover: { value: 0.8 },
  uFogColor: { value: new Float32Array([0.5, 0.55, 0.6]) },
  uNoiseTexture: { value: null },
  uSunColor: { value: new Float32Array([0.9, 0.8, 0.6]) },
  uSunDirection: { value: new Float32Array([0.3, 0.5, 0.8]) },
  uWind: { value: new Float32Array([1.1, 0.3]) }
});

const createSky = (extra: Partial<ExplorationSkyObjectOptions> = {}) =>
  createExplorationSkyObject({
    background: 0x0b2238,
    uniforms: createUniforms(),
    ...extra
  });

describe("exploration sky object", () => {
  it("reports owned textures and releases them idempotently", () => {
    const loadImage = vi.fn(() => new Promise<HTMLImageElement>(() => undefined));
    expect(loadImage).not.toHaveBeenCalled();
    const sky = createSky({ moonImageLoader: loadImage });
    sky.update({ cloudDetail: 3, daylight: 1, flash: 0, timeSeconds: 0 });
    expect(loadImage).not.toHaveBeenCalled();
    expect(sky.stats().extraTextures).toBe(1);
    sky.update({ cloudDetail: 2, daylight: 0, flash: 0, timeSeconds: 0 });
    expect(loadImage).toHaveBeenCalledOnce();
    sky.update({ cloudDetail: 2, daylight: 0, flash: 0, timeSeconds: 1 });
    expect(loadImage).toHaveBeenCalledOnce();
    expect(sky.stats()).toMatchObject({
      cloudDetail: 2,
      disposed: false,
      drawCalls: 0,
      extraTextures: 2,
      geometries: 1,
      materials: 1,
      triangles: 1
    });

    sky.dispose();
    expect(sky.stats()).toMatchObject({
      disposed: true,
      drawCalls: 0,
      extraTextures: 0,
      geometries: 0,
      materials: 0,
      triangles: 0
    });
    sky.dispose();
    expect(loadImage).toHaveBeenCalledOnce();
  });

  it("skips orthographic cameras and restores autoClear after success or a render failure", () => {
    const render = vi.fn();
    const renderer = { autoClear: true, render } as unknown as WebGLRenderer;
    const sky = createSky();
    sky.render(renderer, new OrthographicCamera());
    expect(render).not.toHaveBeenCalled();
    expect(sky.stats().drawCalls).toBe(0);

    const camera = new PerspectiveCamera();
    render.mockImplementationOnce(() => {
      throw new Error("test render failure");
    });
    expect(() => sky.render(renderer, camera)).toThrow("test render failure");
    expect(renderer.autoClear).toBe(true);
    expect(sky.stats().drawCalls).toBe(0);

    sky.render(renderer, camera);
    expect(render).toHaveBeenCalledTimes(2);
    expect(renderer.autoClear).toBe(true);
    expect(sky.stats().drawCalls).toBe(1);

    sky.dispose();
    sky.render(renderer, camera);
    expect(render).toHaveBeenCalledTimes(2);
  });

  it("marches and resolves the volumetric clouds before the sky, then restores the target", () => {
    const targets: unknown[] = [];
    const render = vi.fn();
    const renderer = {
      autoClear: true,
      getDrawingBufferSize: (size: { set: (x: number, y: number) => void }) => size.set(1920, 1080),
      getRenderTarget: () => null,
      render,
      setRenderTarget: (target: unknown) => targets.push(target)
    } as unknown as WebGLRenderer;
    const sky = createSky();
    sky.update({ cloudCover: 0.5, cloudDetail: 3, daylight: 1, flash: 0, timeSeconds: 0 });
    sky.render(renderer, new PerspectiveCamera());
    expect(render).toHaveBeenCalledTimes(3);
    expect(targets.at(-1)).toBeNull();
    expect(targets.slice(0, 2).every(target => target !== null)).toBe(true);

    sky.update({ cloudCover: 0, cloudDetail: 3, daylight: 1, flash: 0, timeSeconds: 1 });
    sky.render(renderer, new PerspectiveCamera());
    expect(render).toHaveBeenCalledTimes(4);

    sky.update({ cloudCover: 0.5, cloudDetail: 1, daylight: 1, flash: 0, timeSeconds: 2 });
    sky.render(renderer, new PerspectiveCamera());
    expect(render).toHaveBeenCalledTimes(5);
    expect(sky.stats().extraTextures).toBe(0);
    sky.dispose();
  });

  it("reduces the cloud sampling budget with the device tier", () => {
    expect(EXPLORATION_CLOUD_SAMPLE_LIMIT).toBe(32);
    expect(explorationCloudSampleCount(3)).toBe(32);
    expect(explorationCloudSampleCount(2)).toBe(16);
    expect(explorationCloudSampleCount(1)).toBe(1);
    expect(explorationCloudSampleCount(0)).toBe(1);
  });
});
