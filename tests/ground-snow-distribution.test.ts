import { DataTexture } from "three";
import { describe, expect, it } from "vitest";

import { GROUND_VARIANT_GLSL } from "../src/render-common/shaders/ground-variants-glsl";
import { createTerrainMaterial } from "../src/renderers/three/three-materials";

const texture = () => new DataTexture(new Uint8Array(4), 1, 1);

describe("snow distribution in the ground shaders", () => {
  it("guards the keep redistribution in both variants", () => {
    for (const source of [GROUND_VARIANT_GLSL.full, GROUND_VARIANT_GLSL.lite]) {
      expect(source).toContain("#ifdef SNOW_DISTRIBUTION");
      expect(source).toContain("getSnowKeep");
      expect(source).toContain("movedSnow");
      expect(source).toContain("getSnowReturnShares");
    }
  });

  it("sets the define only when the snow map carries the keep field", () => {
    const albedo = texture();
    const normal = texture();
    const distributed = createTerrainMaterial(
      { uSnowMap: { value: { userData: { distribution: true } } } },
      albedo,
      normal,
      "full"
    );
    expect(distributed.defines?.SNOW_DISTRIBUTION).toBe("");
    distributed.dispose();

    const plain = createTerrainMaterial({}, albedo, normal, "full");
    expect(plain.defines?.SNOW_DISTRIBUTION).toBeUndefined();
    plain.dispose();
    albedo.dispose();
    normal.dispose();
  });
});
