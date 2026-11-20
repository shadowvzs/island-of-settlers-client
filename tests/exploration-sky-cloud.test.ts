import { describe, expect, it } from "vitest";

import {
  EXPLORATION_CLOUD_GLSL,
  EXPLORATION_CLOUD_SAMPLE_LIMIT,
  explorationCloudSampleCount
} from "../src/renderers/three/exploration-weather/exploration-sky-cloud-glsl";
import { createSkyNoiseVoxels, SKY_NOISE_SIZE } from "../src/renderers/three/exploration-weather/exploration-sky-noise";

describe("exploration cloud volume", () => {
  it("keeps the fixed march budget per tier", () => {
    expect(explorationCloudSampleCount(1)).toBe(1);
    expect(explorationCloudSampleCount(2)).toBe(16);
    expect(explorationCloudSampleCount(3)).toBe(32);
    expect(EXPLORATION_CLOUD_SAMPLE_LIMIT).toBe(32);
  });

  it("marches a jittered volume with a light march, phase and powder terms", () => {
    expect(EXPLORATION_CLOUD_GLSL).toContain(
      "vec4 explorationCloudMarch(vec3 direction, float cameraAltitude, float jitter)"
    );
    expect(EXPLORATION_CLOUD_GLSL).toContain("(float(stepIndex) + jitter) * stepLength");
    expect(EXPLORATION_CLOUD_GLSL).toContain("skyLightOpticalDepth");
    expect(EXPLORATION_CLOUD_GLSL).toContain("float powder");
    expect(EXPLORATION_CLOUD_GLSL).toContain("skyPhase(cosine, 0.5 * eccentricity)");
  });

  it("builds a tiling two-channel noise volume that spans the 8-bit range", () => {
    const voxels = createSkyNoiseVoxels();
    expect(voxels.length).toBe(SKY_NOISE_SIZE ** 3 * 2);
    expect(createSkyNoiseVoxels()).toBe(voxels);
    for (const channel of [0, 1]) {
      let low = 255, high = 0, total = 0;
      for (let index = channel; index < voxels.length; index += 2) {
        low = Math.min(low, voxels[index]!);
        high = Math.max(high, voxels[index]!);
        total += voxels[index]!;
      }
      expect(low).toBe(0);
      expect(high).toBe(255);
      expect(total / (voxels.length / 2)).toBeGreaterThan(70);
      expect(total / (voxels.length / 2)).toBeLessThan(185);
    }
    // Opposite faces are neighbours: the volume wraps without a seam.
    const at = (x: number, y: number, z: number) => voxels[((z * SKY_NOISE_SIZE + y) * SKY_NOISE_SIZE + x) * 2]!;
    let seam = 0, interior = 0;
    for (let z = 0; z < SKY_NOISE_SIZE; z++) for (let y = 0; y < SKY_NOISE_SIZE; y++) {
      seam += Math.abs(at(SKY_NOISE_SIZE - 1, y, z) - at(0, y, z));
      interior += Math.abs(at(31, y, z) - at(32, y, z));
    }
    expect(seam).toBeLessThan(interior * 1.5);
  });
});
