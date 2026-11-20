import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { ROAD_PLACEMENT_WIDTH } from "../src/shared/settlement/road-types";
import { BUILDING_FOOTPRINTS, MINE_FOOTPRINT } from "../src/shared/world/building-footprints";
import { type BuildSite, countAllFootprints, fitsFootprint, packAround } from "../src/shared/world/building-space";
import { START_AREA } from "../src/shared/world/generation/clearings";
import { getStarterPackingFootprints } from "../src/shared/world/generation/starter-packing-footprints";
import { BUILD } from "../src/shared/world/world-data";

const flatSite = (size: number): BuildSite => ({ cellsX: size, cellsZ: size,
  buildClass: new Uint8Array(size * size).fill(BUILD.large), heights: new Float32Array((size + 1) ** 2).fill(1) });

it("uses actual representative catalog plots and a rounded complete reserved-road access strip", () => {
  const footprints = getStarterPackingFootprints();
  for (const [kind, id] of [["large", 0], ["standard", 57]] as const) {
    const [width, depth] = getBuildingDefinition(id).gridFootprint;
    expect(footprints[kind]).toMatchObject({ width, depth, accessMargin: Math.ceil(ROAD_PLACEMENT_WIDTH) });
  }
  const site = flatSite(16), footprint = footprints.standard;
  const width = footprint.width!, depth = footprint.depth!, margin = footprint.accessMargin!;
  site.buildClass[(depth + margin - 1) * site.cellsX + width] = BUILD.none;
  expect(fitsFootprint(site, new Uint8Array(256), 0, 0, footprint)).toBe(false);
});

it("keeps legacy forest/minimum/mine estimators unchanged and does not promise eight real starter plots", () => {
  const before = structuredClone({ BUILDING_FOOTPRINTS, MINE_FOOTPRINT });
  const site = flatSite(12), centre = { x: 6, z: 6 };
  const legacy = packAround(site, centre, 12, START_AREA.plan);
  const current = packAround(site, centre, 12, START_AREA.plan, getStarterPackingFootprints());
  expect(current).toBeLessThan(legacy);
  expect(current).toBeLessThan(START_AREA.plan.length);
  expect(countAllFootprints(site)).toEqual({ large: 9, standard: 16, tower: 36 });
  expect({ BUILDING_FOOTPRINTS, MINE_FOOTPRINT }).toEqual(before);
  expect(START_AREA.maxRadius).toBe(12);
});
