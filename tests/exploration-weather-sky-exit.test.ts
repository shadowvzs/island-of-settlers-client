import { PerspectiveCamera, type WebGLRenderer } from "three";
import { expect, it, vi } from "vitest";

import { QUALITY_PRESETS } from "../src/render-common/quality";
import { createExplorationWeatherAdapter } from "../src/renderers/three/exploration-weather";

it("releases the FPS sky on each return to isometric and recreates it on the next visit", () => {
  const adapter = createExplorationWeatherAdapter({
    quality: QUALITY_PRESETS.minimal,
    render: { background: 0x102030, uniforms: {} }
  });
  const render = vi.fn();
  const renderer = { autoClear: false, render } as unknown as WebGLRenderer;
  const camera = new PerspectiveCamera();
  adapter.setEnvironment({
    ambientGround: [0.3, 0.3, 0.3], ambientSky: [0.5, 0.6, 0.7], bakedShadowWeight: 1,
    cloudCover: 0.45, daylight: 1, fogColor: [0.7, 0.8, 0.9], rain: 0, shadowStrength: 1,
    snow: 0, sun: { azimuthX: 1, azimuthZ: 0, elevation: 0.5 }, sunColor: [1, 1, 1], windX: 1, windZ: 0
  });
  const frame = { active: true, cameraX: 0, cameraY: 2, cameraZ: 0, rain: 0, timestamp: 0 };
  expect(adapter.stats().resources.textures).toBe(0);
  for (let visit = 0; visit < 3; visit++) {
    adapter.setActive(true);
    adapter.update(frame);
    adapter.renderSky(renderer, camera);
    expect(adapter.stats().resources.geometries).toBe(1);
    // Minimal daytime visits borrow the existing renderer atlas and allocate no owned texture.
    expect(adapter.stats().resources.textures).toBe(0);
    adapter.setActive(false);
    expect(adapter.stats().resources).toMatchObject({ geometries: 0, materials: 0, textures: 0 });
    const calls = render.mock.calls.length;
    adapter.renderSky(renderer, camera);
    expect(render).toHaveBeenCalledTimes(calls);
  }
  adapter.dispose();
});
