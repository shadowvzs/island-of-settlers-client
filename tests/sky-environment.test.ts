import {
  MeshStandardMaterial,
  Scene,
  ShaderChunk,
  type WebGLProgramParametersWithUniforms
} from "three";
import { describe, expect, it } from "vitest";

import { computeEnvironment, getSunVector, TIME_PRESETS } from "../src/render-common/environment";
import {
  createSkyEnvironmentSchedule,
  SKY_ENVIRONMENT_INTERVAL_SECONDS,
  SKY_ENVIRONMENT_MIN_SECONDS
} from "../src/render-common/lighting/sky-environment-schedule";
import {
  createSkyLight,
  SKY_RADIANCE_MAP_HEIGHT,
  SKY_RADIANCE_MAP_WIDTH,
  type SkyLight,
  writeSkyRadianceMap
} from "../src/render-common/lighting/sky-irradiance";
import { applyStandardAtmosphereShader } from
  "../src/renderers/three/atmosphere/standard-atmosphere-shader";
import { applySkyEnvironment } from "../src/renderers/three/sky-environment";
import { DEFAULT_SUN } from "../src/shared/world/lighting";

const WIDTH = SKY_RADIANCE_MAP_WIDTH, HEIGHT = SKY_RADIANCE_MAP_HEIGHT;

const environmentAt = (hour: number, rain = 0) =>
  computeEnvironment(DEFAULT_SUN, hour, rain, 0, 0.45 + rain * 0.5, 0);

const radianceMapOf = (hour: number) => {
  const environment = environmentAt(hour);
  const light = createSkyLight()(environment);
  const map = new Float32Array(WIDTH * HEIGHT * 4);
  writeSkyRadianceMap(environment, light, map);
  return { environment, map };
};

/** The map pixel of a world direction, inverting Three's `equirectUv`. */
const pixelToward = (map: Float32Array, [x, y, z]: readonly number[]) => {
  const u = Math.atan2(z!, x!) / (2 * Math.PI) + 0.5;
  const v = Math.asin(y!) / Math.PI + 0.5;
  const column = Math.min(WIDTH - 1, Math.floor(u * WIDTH));
  const row = Math.min(HEIGHT - 1, Math.floor(v * HEIGHT));
  const offset = (row * WIDTH + column) * 4;
  return [map[offset]!, map[offset + 1]!, map[offset + 2]!];
};

/** (1/π) ∫ L · max(0, n.y) dω of the map: what an up-facing diffuse surface receives. */
const upIrradiance = (map: Float32Array) => {
  const result = [0, 0, 0];
  const cell = (Math.PI / HEIGHT) * ((2 * Math.PI) / WIDTH);
  for (let row = 0; row < HEIGHT; row++) {
    const elevation = ((row + 0.5) / HEIGHT - 0.5) * Math.PI;
    const weight = Math.max(0, Math.sin(elevation)) * Math.cos(elevation) * cell / Math.PI;
    for (let column = 0; column < WIDTH; column++)
      for (let channel = 0; channel < 3; channel++)
        result[channel]! += map[(row * WIDTH + column) * 4 + channel]! * weight;
  }
  return result;
};

const lightWithRevision = (revision: number, scale = 1): SkyLight => ({
  irradiance: new Float32Array(27),
  radiance: new Float32Array(27).fill(scale),
  reflection: new Float32Array(27),
  revision,
  skyScale: new Float32Array(3),
  skyView: new Float32Array(0)
});

describe("sky environment radiance map", () => {
  it("integrates to the same up-facing ambient as the SH9 light", () => {
    for (const hour of [TIME_PRESETS.day, TIME_PRESETS.dusk, TIME_PRESETS.night]) {
      const { environment, map } = radianceMapOf(hour);
      const irradiance = upIrradiance(map);
      for (let channel = 0; channel < 3; channel++)
        expect(Math.abs(irradiance[channel]! / environment.ambientSky[channel]! - 1)).toBeLessThan(0.03);
    }
  });

  it("shows the ground below the horizon and the warm sun side at dusk", () => {
    const { environment, map } = radianceMapOf(TIME_PRESETS.dusk);
    expect(pixelToward(map, [0.3, -0.6, 0.74])).toEqual(
      environment.ambientGround.map(value => Math.fround(value)));
    const [x, , z] = getSunVector(environment.sun);
    const length = Math.hypot(x, z);
    const toward = pixelToward(map, [x / length, 0.05, z / length]);
    const away = pixelToward(map, [-x / length, 0.05, -z / length]);
    expect(toward[0]! / toward[2]!).toBeGreaterThan(away[0]! / away[2]!);
    expect(toward[0]!).toBeGreaterThan(away[0]!);
  });
});

describe("sky environment bake schedule", () => {
  it("bakes at once, then at most once a minute unless the light changes a lot", () => {
    const isDue = createSkyEnvironmentSchedule();
    expect(isDue(lightWithRevision(1), 0)).toBe(true);
    expect(isDue(lightWithRevision(1), 100)).toBe(false);
    expect(isDue(lightWithRevision(2, 1.05), 10)).toBe(false);
    expect(isDue(lightWithRevision(3, 1.05), SKY_ENVIRONMENT_INTERVAL_SECONDS)).toBe(true);
    const later = SKY_ENVIRONMENT_INTERVAL_SECONDS;
    expect(isDue(lightWithRevision(4, 2), later + SKY_ENVIRONMENT_MIN_SECONDS / 2)).toBe(false);
    expect(isDue(lightWithRevision(5, 2), later + SKY_ENVIRONMENT_MIN_SECONDS)).toBe(true);
  });
});

describe("sky environment on built-in materials", () => {
  it("keeps Three's environment specular and removes its environment diffuse", () => {
    const shader = {
      fragmentShader: `void main() {\n#include <lights_fragment_maps>\n#include <opaque_fragment>\n}`,
      uniforms: {},
      vertexShader: "void main() {\n#include <project_vertex>\n}"
    } as unknown as WebGLProgramParametersWithUniforms;
    expect(ShaderChunk.lights_fragment_maps).toContain("iblIrradiance += getIBLIrradiance");
    applyStandardAtmosphereShader(new MeshStandardMaterial(), {}, shader);
    expect(shader.fragmentShader).not.toContain("#include <lights_fragment_maps>");
    expect(shader.fragmentShader).not.toContain("getIBLIrradiance( geometryNormal )");
    expect(shader.fragmentShader).toContain("getIBLRadiance( geometryViewDir, geometryNormal");
  });

  it("leaves scenes without an environment while no renderer bakes one", () => {
    const scene = new Scene();
    applySkyEnvironment(scene);
    expect(scene.environment).toBeNull();
  });
});
