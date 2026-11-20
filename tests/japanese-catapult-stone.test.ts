import { expect, it } from "vitest";

import { catapultNationalWallSurface } from "../src/render-common/buildings/catapult-national-wall-finish";
import { garrisonSlots } from "../src/render-common/buildings/military-garrison-slots";
import { NATION_SURFACES, nationSurfaceResolution } from "../src/renderers/three/buildings/building-surface-paint";
import { createJapaneseCatapultStoneDetail } from "../src/renderers/three/buildings/japanese-catapult-stone-detail";
import {
  japaneseWhiteStoneBaseDetail, japaneseWhiteStoneDetail
} from "../src/renderers/three/buildings/japanese-white-stone-detail";

const point = (u: number, v: number) => ({grain:.5,mineral:.5,u,v,weather:0});
it("darkens narrow joints while preserving clean white faces at both map resolutions", () => {
  for (const resolution of [512,256]) {
    const sample=createJapaneseCatapultStoneDetail(resolution);
    const face=point(.25,1/12), joint=point(0,1/12);
    expect(sample(face).brightness).toBeCloseTo(japaneseWhiteStoneBaseDetail(face).brightness,5);
    expect(sample(joint).brightness).toBeLessThan(japaneseWhiteStoneBaseDetail(joint).brightness-.07);
    expect(sample(point(.025,1/12)).brightness).toBeGreaterThan(.985);
    expect(sample(joint).height).toBeLessThan(sample(face).height);
  }
  expect(catapultNationalWallSurface("japanese")).toBe("japanese-catapult-stone");
  expect(NATION_SURFACES.japanese?.["japanese-white-stone"]?.sample).toBe(japaneseWhiteStoneDetail);
  expect(nationSurfaceResolution("japanese","japanese-catapult-stone",true)).toBe(512);
  expect(nationSurfaceResolution("japanese","japanese-catapult-stone",false)).toBe(256);
});

it("retains ordinary white faces and makes shallow fine joints readable on the existing Minimal texel grid",()=>{
  const face=point(.25,1/12),joint=point(0,1/12),nearMinimalJoint=point(.25,21/128);
  expect(japaneseWhiteStoneDetail(face).brightness).toBeCloseTo(japaneseWhiteStoneBaseDetail(face).brightness,5);
  expect(japaneseWhiteStoneDetail(joint).brightness).toBeLessThan(.85);
  expect(japaneseWhiteStoneDetail(nearMinimalJoint).brightness).toBeLessThan(.98);
  expect(japaneseWhiteStoneDetail(joint).height).toBeGreaterThan(.46);
  expect(japaneseWhiteStoneDetail(point(.025,1/12)).brightness).toBeGreaterThan(.985);
  expect(nationSurfaceResolution("japanese","japanese-white-stone",true)).toBe(1024);
  expect(nationSurfaceResolution("japanese","japanese-white-stone",false)).toBe(128);
});

it("keeps Catapult windows decorative rather than occupied soldier slots", () => {
  for(const nation of ["roman","chinese","japanese","persian","nubian","indigenous","viking","maya"] as const)
    for(const detailed of [true,false]) {
      const slots=garrisonSlots(16,nation,detailed);
      expect(slots.map(slot=>slot.kind),`${nation}/${detailed}`).toEqual(["crew"]);
    }
});
