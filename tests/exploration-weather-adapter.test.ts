import { Group, type IUniform, PerspectiveCamera, PointLight, type WebGLRenderer } from "three";
import { describe, expect, it, vi } from "vitest";

import type {
  ExplorationThunderRequest,
  ExplorationWeatherAudioSink
} from "../src/app/audio/exploration-weather";
import type { EnvironmentState } from "../src/render-common/environment";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import {
  createExplorationWeatherAdapter,
  explorationWeatherBranch
} from "../src/renderers/three/exploration-weather";

const environment = (rain: number, snow = 0): EnvironmentState => ({
  ambientGround: [0.2, 0.2, 0.2],
  ambientSky: [0.3, 0.4, 0.6],
  bakedShadowWeight: 1,
  cloudCover: 0.8,
  daylight: 0.6,
  fogColor: [0.5, 0.55, 0.6],
  rain,
  shadowStrength: 1,
  snow,
  sun: { azimuthX: 0.3, azimuthZ: 0.8, elevation: 0.5 },
  sunColor: [0.9, 0.8, 0.6],
  windX: 1.1,
  windZ: 0.3
});

const weather = (timeSeconds = 0) => Object.freeze({
  active: true,
  rain: 1,
  cameraX: 12 + Math.sin(timeSeconds * 0.01),
  cameraY: 4,
  cameraZ: -3,
  timestamp: timeSeconds
});

const createSink = () => {
  const requests: ExplorationThunderRequest[] = [];
  const sink = {
    dispose: vi.fn(),
    play: vi.fn((request: ExplorationThunderRequest) => {
      requests.push(request);
      return true;
    }),
    requests,
    stats: () => ({
      bufferReady: true,
      disposed: false,
      maxVoices: 2,
      played: requests.length,
      rejected: 0,
      voices: 0
    })
  };
  return sink satisfies ExplorationWeatherAudioSink;
};

const createUniforms = (): Record<string, IUniform> => ({
  uAmbientSky: { value: new Float32Array([0.3, 0.4, 0.6]) },
  uCloudCover: { value: 0.8 },
  uFogColor: { value: new Float32Array([0.5, 0.55, 0.6]) },
  uNoiseTexture: { value: null },
  uSunColor: { value: new Float32Array([0.9, 0.8, 0.6]) },
  uSunDirection: { value: new Float32Array([0.3, 0.5, 0.8]) },
  uWind: { value: new Float32Array([1.1, 0.3]) }
});

describe("exploration weather adapter", () => {
  it("allocates nothing before setActive and reports the default iso branch", () => {
    const adapter = createExplorationWeatherAdapter({
      maxDrops: 8,
      maxSplashes: 4,
      quality: QUALITY_PRESETS.high
    });
    expect(explorationWeatherBranch(false).mode).toBe("iso");
    expect(adapter.stats()).toMatchObject({
      active: false,
      drops: { capacity: 0 },
      mode: "iso",
      resources: { geometries: 0, lights: 0, materials: 0, renderTargets: 0, textures: 0 }
    });
    adapter.update(weather());
    expect(adapter.stats().resources.geometries).toBe(0);
    adapter.setActive(true);
    expect(adapter.stats().mode).toBe("fps");
    adapter.update(weather());
    expect(adapter.stats().drops.capacity).toBe(8);
    expect(adapter.stats().wetness).toBe(1);
    expect(adapter.stats().resources.geometries).toBe(0);
    adapter.dispose();
  });

  it("draws snow as slow flakes and keeps splashes rain-only", () => {
    let nowMs = 0;
    const adapter = createExplorationWeatherAdapter({
      environment: () => environment(0, 1),
      groundHeight: () => 0,
      maxDrops: 8,
      maxSplashes: 4,
      now: () => nowMs,
      quality: QUALITY_PRESETS.high,
      seed: 17
    });
    adapter.setActive(true);
    for (let frame = 0; frame < 3; frame++) adapter.update(weather(nowMs += 17));
    const stats = adapter.stats();
    expect(stats.drops.count).toBeGreaterThan(0);
    expect(stats.drops.snowShare).toBe(1);
    expect(stats.splashes.spawns).toBe(0);
    expect(stats.wetness).toBe(0);
    adapter.dispose();
  });

  it("owns the FPS sky/rain/splash/light resources and releases every one on dispose", () => {
    const parent = new Group();
    const sink = createSink();
    let nowMs = 0;
    const adapter = createExplorationWeatherAdapter({
      audio: sink,
      cameraView: () => ({ forwardX: 0, forwardY: 0, forwardZ: 1, yaw: 0.3 }),
      environment: () => environment(1),
      groundHeight: () => 0,
      maxAudioVoices: 1,
      maxDrops: 8,
      maxSplashes: 4,
      now: () => nowMs,
      parent,
      quality: QUALITY_PRESETS.high,
      render: { background: 0x0b2238, uniforms: createUniforms() },
      seed: 17,
      shelterAt: () => 0
    });
    adapter.setActive(true);
    adapter.update(weather());
    const first = adapter.stats();
    expect(first.camera).toMatchObject({ x: 12, y: 4, z: -3, yaw: 0.3 });
    expect(first.drops.capacity).toBe(8);
    expect(first.splashes.splashCapacity).toBe(4);
    expect(first.resources).toMatchObject({
      geometries: 5, lights: 1, materials: 6, renderTargets: 0, textures: 1
    });
    expect(first.wetness).toBe(1);
    expect(parent.children).toHaveLength(1);
    expect(parent.children[0]!.name).toBe("exploration-lightning-world-light");
    expect(parent.children[0]).toBeInstanceOf(PointLight);
    expect((parent.children[0] as PointLight).castShadow).toBe(false);

    for (let index = 1; index <= 400; index++) {
      nowMs = index * 100;
      adapter.update(weather(nowMs / 1000));
    }
    const storm = adapter.stats();
    expect(storm.lightning.strikes).toBeGreaterThan(0);
    expect(sink.requests).toHaveLength(storm.lightning.strikes);
    expect(sink.requests.length).toBeLessThanOrEqual(5);
    for (const request of sink.requests) {
      expect(request.delaySeconds).toBeGreaterThanOrEqual(0.02);
      expect(request.delaySeconds).toBeLessThanOrEqual(0.45);
      expect(Math.abs(request.pan)).toBeLessThanOrEqual(1);
    }
    expect(storm.splashes.spawns).toBeGreaterThan(0);

    adapter.dispose();
    const released = adapter.stats();
    expect(released.disposed).toBe(true);
    expect(released.resources).toEqual({
      geometries: 0, lights: 0, materials: 0, renderTargets: 0, textures: 0
    });
    expect(released.drops.count).toBe(0);
    expect(parent.children).toHaveLength(0);
    expect(sink.dispose).toHaveBeenCalledTimes(1);
    adapter.dispose();
    expect(sink.dispose).toHaveBeenCalledTimes(1);
    adapter.setActive(true);
    adapter.update(weather(nowMs / 1000));
    expect(adapter.stats().resources.geometries).toBe(0);
  });

  it("does not force optional effects on Minimal while preserving wetness", () => {
    const sink = createSink();
    let nowMs = 0;
    const adapter = createExplorationWeatherAdapter({
      audio: sink,
      environment: () => environment(1),
      now: () => nowMs,
      quality: QUALITY_PRESETS.minimal
    });
    adapter.setActive(true);
    for (let index = 0; index <= 400; index++) {
      nowMs = index * 100;
      adapter.update(weather(nowMs / 1000));
    }
    const stats = adapter.stats();
    expect(stats.budget.drops).toBe(0);
    expect(stats.budget.splashes).toBe(0);
    expect(stats.budget.lightning).toBe(false);
    expect(stats.budget.audioVoices).toBe(0);
    expect(stats.lightning.strikes).toBe(0);
    expect(sink.requests).toHaveLength(0);
    expect(stats.wetness).toBe(1);
    expect(stats.resources.geometries).toBe(0);
    adapter.dispose();
  });

  it("copies the environment and frame and never calls Math.random", () => {
    const random = vi.spyOn(Math, "random");
    const source = environment(0.7);
    const frame = weather(2);
    const sourceSnapshot = JSON.stringify(source);
    const frameSnapshot = JSON.stringify(frame);
    const nowMs = 5_000;
    const adapter = createExplorationWeatherAdapter({
      environment: () => source,
      maxDrops: 4,
      now: () => nowMs,
      quality: QUALITY_PRESETS.high
    });
    adapter.setActive(true);
    adapter.update(frame);
    expect(JSON.stringify(source)).toBe(sourceSnapshot);
    expect(JSON.stringify(frame)).toBe(frameSnapshot);
    expect(nowMs).toBe(5_000);
    expect(random).not.toHaveBeenCalled();
    random.mockRestore();
    adapter.dispose();
  });

  it("renders the optional sky/effect objects without clearing the exhausted frame", () => {
    const adapter = createExplorationWeatherAdapter({
      cameraView: () => ({ forwardX: 0, forwardY: 0, forwardZ: 1, yaw: 0 }),
      environment: () => environment(1),
      maxDrops: 8,
      maxSplashes: 4,
      quality: QUALITY_PRESETS.high,
      render: { background: 0x0b2238, uniforms: createUniforms() }
    });
    const render = vi.fn();
    // CLOUDS-3D: on High the sky draws its half-resolution cloud march + resolve into private targets first.
    const renderer = {
      autoClear: false, compileAsync: vi.fn(async () => undefined),
      getDrawingBufferSize: (target: { set: (x: number, y: number) => unknown }) => target.set(1920, 1080),
      getRenderTarget: () => null, render, setRenderTarget: vi.fn()
    } as unknown as WebGLRenderer;
    const camera = new PerspectiveCamera();
    adapter.renderSky(renderer, camera);
    expect(render).not.toHaveBeenCalled();
    adapter.setActive(true);
    adapter.update(weather());
    adapter.renderSky(renderer, camera);
    expect(render.mock.calls.length).toBeGreaterThanOrEqual(1);
    expect(renderer.autoClear).toBe(false);
    adapter.renderEffects(renderer, camera);
    expect(render.mock.calls.length).toBeGreaterThan(1);
    expect(renderer.autoClear).toBe(false);
    const beforeDispose = render.mock.calls.length;
    adapter.dispose();
    adapter.renderSky(renderer, camera);
    adapter.renderEffects(renderer, camera);
    expect(render).toHaveBeenCalledTimes(beforeDispose);
  });

  it("hides without disposing when the weather frame clears, then reuses the same pools", () => {
    const adapter = createExplorationWeatherAdapter({
      environment: () => environment(1),
      maxDrops: 4,
      maxSplashes: 2,
      quality: QUALITY_PRESETS.high
    });
    adapter.setActive(true);
    adapter.update(weather());
    expect(adapter.stats().drops.capacity).toBe(4);
    adapter.update(null);
    expect(adapter.stats().drops.count).toBe(0);
    expect(adapter.stats().splashes.splashCount).toBe(0);
    adapter.setActive(false);
    expect(adapter.stats().mode).toBe("iso");
    adapter.setActive(true);
    adapter.update(weather());
    expect(adapter.stats().drops.capacity).toBe(4);
    adapter.dispose();
  });
});
