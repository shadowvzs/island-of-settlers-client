import { DataTexture, type IUniform } from "three";
import { describe, expect, it } from "vitest";

import { createTerrainMaterial } from "../src/renderers/three/three-materials";

const texture = new DataTexture(new Uint8Array(4), 1, 1);
const snowUniforms = (userData: Record<string, boolean>): Record<string, IUniform> =>
  ({ uSnowMap: { value: { userData } } });

describe("shore wetness (TT-1)", () => {
  it("wets the ground sample before lighting and keeps the caustics after it", () => {
    for (const variant of ["full", "lite"] as const) {
      const source = createTerrainMaterial({}, texture, texture, variant).fragmentShader;
      const main = source.slice(source.indexOf("void main()"));
      expect(main.indexOf("wetShoreGround(")).toBeGreaterThan(main.indexOf("sampleGround("));
      expect(main.indexOf("wetShoreGround(")).toBeLessThan(main.indexOf("lightGround("));
      expect(main.indexOf("waterlineGround(")).toBeGreaterThan(main.indexOf("lightGround("));
    }
  });

  it("feeds the surface mask's river bank wetness into the shore wetness (TT-2, both variants)", () => {
    for (const variant of ["full", "lite"] as const) {
      const material = createTerrainMaterial({}, texture, texture, variant);
      expect(material.vertexShader).toContain("vSurface = surface;");
      // Ground-palette-3: the tidal silt flats' wetness joins the bank wetness (max(vSurface.x, tidal …)).
      expect(material.fragmentShader).toMatch(/wetShoreGround\([^;]*max\(vSurface\.x, [^;]*\);/);
    }
  });

  it("builds the swash sheet after the ground sample and before the wet shore", () => {
    for (const variant of ["full", "lite"] as const) {
      const source = createTerrainMaterial({}, texture, texture, variant).fragmentShader;
      const main = source.slice(source.indexOf("void main()"));
      expect(main).toContain("sampleGround(vWorld, ");
      expect(main.indexOf("getSwashSheet(")).toBeGreaterThan(main.indexOf("sampleGround("));
      expect(main.indexOf("getSwashSheet(")).toBeLessThan(main.indexOf("wetShoreGround("));
      expect(main).toContain("getWetGroundSheen(ground, wetFilm");
    }
  });

  it("gives the film sheen and the fine lace to the full ground only (Minimal: tint and roughness)", () => {
    const full = createTerrainMaterial({}, texture, texture, "full").fragmentShader;
    const lite = createTerrainMaterial({}, texture, texture, "lite").fragmentShader;
    expect(full).toContain("#define GROUND_WET_SHEEN");
    expect(full).toContain("#define SHORE_FOAM_FINE");
    expect(lite).not.toContain("#define GROUND_WET_SHEEN");
    expect(lite).not.toContain("#define SHORE_FOAM_FINE");
  });

  it("freezes the shore under the cosmetic global winter only", () => {
    const winter = createTerrainMaterial(snowUniforms({ visualWinter: true }), texture, texture, "full");
    const plain = createTerrainMaterial(snowUniforms({ hasSnow: true }), texture, texture, "full");
    expect(winter.defines).toHaveProperty("FROZEN_SHORE");
    expect(plain.defines ?? {}).not.toHaveProperty("FROZEN_SHORE");
    expect(plain.fragmentShader).toContain("getShoreFrozen(getSnowMap(xz))");
  });
});
