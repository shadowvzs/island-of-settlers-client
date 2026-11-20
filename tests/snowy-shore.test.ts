import { DataTexture, type IUniform } from "three";
import { describe, expect, it } from "vitest";

import { createTerrainMaterial, createWaterMaterial, setTerrainVariant } from "../src/renderers/three/three-materials";

const texture = new DataTexture(new Uint8Array(4), 1, 1);
const SHORE_FUNCTIONS = ["coverSnowyShore", "freezeWetShore", "getSnowyShoreDepth"];

describe("snowy shore shader sources", () => {
  const plain: Record<string, IUniform> = {};
  const snowy = (): Record<string, IUniform> => ({ uSnowMap: { value: { userData: { hasSnow: true } } } });

  it("compiles the snowy shore only into worlds with snow areas", () => {
    for (const variant of ["full", "lite"] as const) {
      const plainSource = createTerrainMaterial(plain, texture, texture, variant).fragmentShader;
      const snowySource = createTerrainMaterial(snowy(), texture, texture, variant).fragmentShader;
      for (const name of SHORE_FUNCTIONS) {
        expect(plainSource).not.toContain(name);
        expect(snowySource).toContain(name);
      }
    }
  });

  it("keeps the snowy shore when the ground variant is swapped", () => {
    const material = createTerrainMaterial(snowy(), texture, texture, "full");
    setTerrainVariant(material, "lite");
    expect(material.fragmentShader).toContain("coverSnowyShore");
  });

  it("leaves the water of a snowy world on the shared winter source", () => {
    for (const refraction of [false, true]) {
      expect(createWaterMaterial(snowy(), refraction, true).fragmentShader)
        .toBe(createWaterMaterial(plain, refraction, true).fragmentShader);
    }
  });
});
