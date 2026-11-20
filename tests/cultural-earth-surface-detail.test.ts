import { expect, it } from "vitest";
import {
  nubianAdobeDetail, nubianPressedRoofDetail, persianStuccoDetail, persianVaultDetail
} from "../src/renderers/three/buildings/cultural-earth-surface-detail";
import { NATION_SURFACES } from "../src/renderers/three/buildings/building-surface-paint";

it("shows staggered Persian vertical joints without turning every course into a continuous groove", () => {
  const sample = (v: number) => persianStuccoDetail({ u: 0, v, grain: .5, mineral: .5, weather: .5 });
  const firstCourseJoint = sample(.125), nextCourseFace = sample(.375);
  expect(nextCourseFace.height - firstCourseJoint.height).toBeGreaterThan(.15);
  expect(nextCourseFace.brightness - firstCourseJoint.brightness).toBeGreaterThan(.10);
});

it("gives Persian stucco and Nubian adobe different relief and roof construction instead of recolouring one map", () => {
  let wallDifference = 0, roofDifference = 0, roughnessDifference = 0;
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const point = { u: x / 64, v: y / 64, grain: .5, mineral: .5, weather: .5 };
    const persian = persianStuccoDetail(point), nubian = nubianAdobeDetail(point);
    wallDifference += Math.abs(persian.height - nubian.height);
    roughnessDifference += nubian.roughness - persian.roughness;
    roofDifference += Math.abs(persianVaultDetail(point).height - nubianPressedRoofDetail(point).height);
  }
  expect(wallDifference / 4096).toBeGreaterThan(.12);
  expect(roofDifference / 4096).toBeGreaterThan(.07);
  expect(roughnessDifference / 4096).toBeGreaterThan(15);
  expect(NATION_SURFACES.persian!.plaster!.sample).toBe(persianStuccoDetail);
  expect(NATION_SURFACES.nubian!.plaster!.sample).toBe(nubianAdobeDetail);
  expect(NATION_SURFACES.persian!.roof!.sample).toBe(persianVaultDetail);
  expect(NATION_SURFACES.nubian!.roof!.sample).toBe(nubianPressedRoofDetail);
});

it("retains close face shades while joints, fibres and cracks provide the relief", () => {
  for (const sample of [persianStuccoDetail, nubianAdobeDetail]) {
    const face: number[] = [];
    for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
      const value = sample({ u: x / 128, v: y / 128, grain: .5, mineral: .5, weather: .5 });
      expect([value.brightness, value.height, value.roughness, ...value.colour].every(Number.isFinite)).toBe(true);
      if (value.height > .53) face.push(value.brightness);
    }
    expect(Math.max(...face) / Math.min(...face)).toBeLessThan(1.15);
  }
});
