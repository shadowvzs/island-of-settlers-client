import { describe, expect, it } from "vitest";

import { getThemeParameters } from "../src/shared/world/generation/island-themes";
import { chooseShoreProp, NONE, type PropSample } from "../src/shared/world/generation/prop-rules";
import { createRandom } from "../src/shared/world/rng";
import { PROP } from "../src/shared/world/world-data";

/** A calm, moist spot at the open sea: the old calm-shore branch would plant reeds here. */
const SEA: PropSample = {
  cluster: 0.6,
  coast: 1,
  curvature: 0,
  depth: 0,
  exposure: 0,
  forest: 0,
  forestSlopeX: 0,
  forestSlopeZ: 0,
  grain: 0.4,
  grove: 0,
  heatLoad: 0.5,
  height: 0.4,
  moisture: 0.8,
  mountainDistance: 30,
  patches: 0,
  plateau: 0,
  riverDistance: 20,
  rock: 0,
  rockSkin: 0,
  sand: 0.8,
  seaDistance: 2,
  slope: 0.05,
  species: 0,
  stand: 0,
  surfaceSlope: 0.05,
  trunkDistance: 2,
  vegetation: getThemeParameters("meadow").vegetation
};

const RIVER: PropSample = { ...SEA, coast: 1, moisture: 0.6, riverDistance: 1, sand: 0, seaDistance: 20 };

const kinds = (sample: PropSample) => {
  const random = createRandom(17);
  return Array.from({ length: 2000 }, () => chooseShoreProp(sample, random));
};

describe("fresh-water shore plants", () => {
  it("keeps reeds, cattails and sedges off the open sea coast", () => {
    expect(kinds(SEA).every((kind) => kind === NONE)).toBe(true);
  });

  it("still plants the reed/cattail zone along a river bank", () => {
    const found = kinds(RIVER);
    expect(found.some((kind) => kind === PROP.reeds || kind === PROP.cattail)).toBe(true);
  });
});
