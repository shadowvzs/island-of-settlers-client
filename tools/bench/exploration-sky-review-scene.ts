/** Isolated native GPU review of the production FPS sky, including the zenith and lunar close-up. */
import { DataTexture, LinearFilter, PerspectiveCamera, RepeatWrapping, RGBAFormat, Vector3, WebGLRenderer } from "three";

import { createNoiseTexture, NOISE_TEXTURE_SIZE } from "../../src/render-common/noise-textures";
import { createExplorationSkyObject } from "../../src/renderers/three/exploration-weather/exploration-sky-object";

export interface SkyReviewCase {
  cover: number;
  daylight: number;
  detail: number;
  fov: number;
  pitch: number;
  sun: [number, number, number];
  /** Tone weight (uColorToneMapper): 0 Vivid (default) .. 1 Filmic, as Auto selects at dusk. */
  tone?: number;
  yaw: number;
}

const SETTLE_DRAWS = 24;

export const createSkyReview = () => {
  const renderer = new WebGLRenderer({ antialias: false, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(1920, 1080);
  document.body.style.margin = "0";
  document.body.append(renderer.domElement);
  const camera = new PerspectiveCamera(65, 1920 / 1080, 0.1, 1000);
  const direction = new Vector3();
  const noise = new DataTexture(createNoiseTexture(123), NOISE_TEXTURE_SIZE, NOISE_TEXTURE_SIZE, RGBAFormat);
  noise.wrapS = noise.wrapT = RepeatWrapping;
  noise.minFilter = noise.magFilter = LinearFilter;
  noise.needsUpdate = true;
  const uniforms = {
    uAmbientSky: { value: new Float32Array([0.52, 0.6, 0.72]) },
    uCloudCover: { value: 0.45 },
    uColorToneMapper: { value: 0 },
    uFogColor: { value: new Float32Array([0.74, 0.78, 0.84]) },
    uNoiseTexture: { value: noise },
    uRain: { value: 0 },
    uSunColor: { value: new Float32Array([1.08, 0.98, 0.84]) },
    uSunDirection: { value: new Float32Array([0.6, 0.6, 0.3]) },
    uWind: { value: new Float32Array([0.8, 0.35]) }
  };
  const make = () => createExplorationSkyObject({ background: 0x203140, uniforms });
  let sky = make();
  let current: SkyReviewCase;
  const render = () => {
    renderer.clear();
    sky.render(renderer, camera);
  };
  const set = (values: SkyReviewCase) => {
    current = values;
    camera.fov = values.fov;
    camera.up.set(0, 1, 0);
    camera.position.set(0, 2, 0);
    direction.set(
      Math.sin(values.yaw) * Math.cos(values.pitch), Math.sin(values.pitch),
      -Math.cos(values.yaw) * Math.cos(values.pitch)
    );
    camera.lookAt(direction.add(camera.position));
    camera.updateProjectionMatrix();
    uniforms.uCloudCover.value = values.cover;
    uniforms.uColorToneMapper.value = values.tone ?? 0;
    uniforms.uRain.value = values.cover > 0.85 ? 0.9 : 0;
    uniforms.uSunDirection.value.set(values.sun);
    const night = values.daylight < 0.2;
    uniforms.uAmbientSky.value.set(night ? [0.14, 0.19, 0.33] : [0.52, 0.6, 0.72]);
    uniforms.uFogColor.value.set(night ? [0.24, 0.27, 0.36] : [0.74, 0.78, 0.84]);
    uniforms.uSunColor.value.set(night ? [0.3, 0.36, 0.55] : [1.08, 0.98, 0.84]);
    sky.update({ cloudCover: values.cover, cloudDetail: values.detail, daylight: values.daylight, flash: 0, timeSeconds: 120 });
    // The volumetric clouds resolve temporally: settle their history like a held camera would.
    for (let draw = 0; draw < SETTLE_DRAWS; draw++) render();
  };
  const measure = async (gpuSamples = 12) => {
    // GPU timer excludes display/vsync and isolates the shader's cost at a fixed 1080p.
    const gl = renderer.getContext() as WebGL2RenderingContext;
    const timer = gl.getExtension("EXT_disjoint_timer_query_webgl2");
    const samples: number[] = [];
    const frame = () => new Promise<void>(resolve => requestAnimationFrame(() => resolve()));
    for (let index = 0; index < gpuSamples; index++) {
      if (!timer) break;
      const query = gl.createQuery()!;
      gl.beginQuery(timer.TIME_ELAPSED_EXT, query);
      render();
      gl.endQuery(timer.TIME_ELAPSED_EXT);
      for (let attempts = 0; attempts < 120; attempts++) {
        if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE)) break;
        await frame();
      }
      if (gl.getQueryParameter(query, gl.QUERY_RESULT_AVAILABLE) && !gl.getParameter(timer.GPU_DISJOINT_EXT))
        samples.push(Number(gl.getQueryParameter(query, gl.QUERY_RESULT)) / 1e6);
      gl.deleteQuery(query);
    }
    samples.sort((left, right) => left - right);
    render();
    const pixels = new Uint8Array(1920 * 1080 * 4);
    gl.readPixels(0, 0, 1920, 1080, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    let cloudChangedFraction: number | null = null;
    if (current.cover > 0.01) {
      uniforms.uCloudCover.value = 0;
      sky.update({ cloudCover: 0, cloudDetail: current.detail, daylight: current.daylight, flash: 0, timeSeconds: 120 });
      render();
      const clear = new Uint8Array(pixels.length);
      gl.readPixels(0, 0, 1920, 1080, gl.RGBA, gl.UNSIGNED_BYTE, clear);
      let changed = 0;
      let inspected = 0;
      for (let offset = 0; offset < pixels.length; offset += 64) {
        if (Math.abs(pixels[offset]! - clear[offset]!) > 3 ||
          Math.abs(pixels[offset + 1]! - clear[offset + 1]!) > 3) changed++;
        inspected++;
      }
      cloudChangedFraction = changed / inspected;
      uniforms.uCloudCover.value = current.cover;
      sky.update({ cloudCover: current.cover, cloudDetail: current.detail, daylight: current.daylight, flash: 0, timeSeconds: 120 });
      render();
    }
    return {
      cloudChangedFraction,
      gpu: (() => {
        const info = gl.getExtension("WEBGL_debug_renderer_info");
        return gl.getParameter(info?.UNMASKED_RENDERER_WEBGL ?? gl.RENDERER) as string;
      })(),
      gpuMedianMs: samples[Math.floor(samples.length / 2)] ?? null,
      gpuMaxMs: samples.at(-1) ?? null,
      gpuSamples: samples.length,
      resources: { ...renderer.info.memory },
      sky: sky.stats()
    };
  };
  const motion = (frames: { time: number; windX: number; windZ: number }[]) => {
    sky.dispose();
    sky = make();
    const gl = renderer.getContext();
    let previous: Uint8Array | null = null;
    let previousFrame: typeof frames[number] | null = null;
    const samples = [];
    for (const frame of frames) {
      const start = previousFrame ?? frame;
      const steps = Math.max(1, Math.ceil((frame.time - start.time) * 60));
      for (let step = 1; step <= steps; step++) {
        const fraction = step / steps;
        uniforms.uWind.value.set([start.windX + (frame.windX - start.windX) * fraction,
          start.windZ + (frame.windZ - start.windZ) * fraction]);
        sky.update({ cloudCover: current.cover, cloudDetail: current.detail,
          daylight: current.daylight, flash: 0, timeSeconds: start.time + (frame.time - start.time) * fraction });
      }
      previousFrame = frame;
      render();
      const pixels = new Uint8Array(1920 * 1080 * 4);
      gl.readPixels(0, 0, 1920, 1080, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      let changed = 0, difference = 0, inspected = 0;
      if (previous) {
        for (let offset = 0; offset < pixels.length; offset += 64) {
          const delta = Math.max(Math.abs(pixels[offset]! - previous[offset]!),
            Math.abs(pixels[offset + 1]! - previous[offset + 1]!));
          if (delta > 0) changed++;
          difference += delta;
          inspected++;
        }
      }
      samples.push({ ...frame, changedFraction: inspected ? changed / inspected : 0,
        meanDifference: inspected ? difference / inspected : 0 });
      previous = pixels;
    }
    return samples;
  };
  const lifecycle = () => {
    const released = [];
    for (let index = 0; index < 3; index++) {
      sky.dispose();
      sky.dispose();
      released.push({ ...renderer.info.memory });
      sky = make();
      set(current);
    }
    sky.dispose();
    released.push({ ...renderer.info.memory });
    return { released, sky: sky.stats() };
  };
  return { lifecycle, measure, motion, moonLoaded: () => sky.stats().moonLoaded, render, set };
};
