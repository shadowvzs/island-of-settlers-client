import { describe, expect, it } from "vitest";

import {
  BUILDING_EYE_DETAIL_HYSTERESIS, isBuildingDetailed, isBuildingDetailedInView
} from "../src/render-common/buildings/building-detail";
import { QUALITY_PRESETS } from "../src/render-common/quality";
import { explorationBuildingEye } from "../src/renderers/three/exploration/exploration-lod";

const eye = { radius: 70, x: 0, y: 0, z: 0 };
const at = (x: number) => ({ x, y: 0, z: 0 });

describe("R16b building detail in the possessed view", () => {
  it("keeps the strategic zoom rule without an eye", () => {
    for (const zoom of [1, 1.49, 1.5, 3])
      for (const shown of [false, true])
        expect(isBuildingDetailedInView(true, zoom, undefined, at(500), shown)).toBe(isBuildingDetailed(true, zoom));
  });

  it("ignores the strategic zoom within and beyond the eye radius", () => {
    expect(isBuildingDetailedInView(true, 1, eye, at(69), false)).toBe(true);
    expect(isBuildingDetailedInView(true, 3, eye, at(71), false)).toBe(false);
  });

  it("holds the drawn recipe inside the hysteresis band", () => {
    const edge = eye.radius + BUILDING_EYE_DETAIL_HYSTERESIS / 2;
    expect(isBuildingDetailedInView(true, 1, eye, at(edge), true)).toBe(true);
    expect(isBuildingDetailedInView(true, 1, eye, at(edge), false)).toBe(false);
    expect(isBuildingDetailedInView(true, 1, eye, at(eye.radius + BUILDING_EYE_DETAIL_HYSTERESIS + 1), true))
      .toBe(false);
  });

  it("never details on the lite (Minimal) path", () => {
    expect(isBuildingDetailedInView(false, 3, eye, at(0), true)).toBe(false);
  });

  it("widens the radius with the spyglass up to the detail cap and stays off without a radius", () => {
    const target = { radius: 0, x: 0, y: 0, z: 0 };
    expect(explorationBuildingEye(target, 70, 1, { x: 1, y: 2, z: 3 })).toEqual({ radius: 70, x: 1, y: 2, z: 3 });
    expect(explorationBuildingEye(target, 70, 2, at(0))?.radius).toBe(140);
    expect(explorationBuildingEye(target, 70, 8, at(0))?.radius).toBe(160);
    expect(explorationBuildingEye(target, QUALITY_PRESETS.minimal.buildingEyeDetailRadius, 1, at(0)))
      .toBeUndefined();
  });

  it("orders the radius by preset", () => {
    const { high, low, medium } = QUALITY_PRESETS;
    expect(high.buildingEyeDetailRadius).toBeGreaterThan(medium.buildingEyeDetailRadius);
    expect(medium.buildingEyeDetailRadius).toBeGreaterThan(low.buildingEyeDetailRadius);
  });
});
