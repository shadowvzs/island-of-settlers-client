import { BoxGeometry } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import {
  createRomanBuildingRecipe, type BuildingPart,type RoofOpening
} from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import {
  HARBOUR_TOWER_POSITION, HARBOUR_TOWER_ROOF_OPENING
} from "../src/render-common/buildings/harbour-tower-clearance";
import type { BuildingLevel } from "../src/render-common/buildings/levels/building-level";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { ROMAN_HARBOR_BEACON_POSITION } from "../src/render-common/buildings/roman-harbor";
import type { WorkerNation } from "../src/render-common/workers/worker-unit";
import { createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { clipRoofTowerOpening } from "../src/renderers/three/buildings/roof-opening-clip";
import { HARBOUR_TYPE_ID } from "../src/shared/settlement/building-type-ids";

const [towerX, , towerZ] = ROMAN_HARBOR_BEACON_POSITION;
const TOWER_NATIONS: readonly WorkerNation[] = ["japanese", "roman"];
const HARBOUR = getBuildingDefinition(HARBOUR_TYPE_ID);

const recipeFor = (nation: WorkerNation, detailed: boolean, level: BuildingLevel = 1) =>
  nation === "roman" ? createRomanBuildingRecipe(HARBOUR, detailed) :
    leveledBuildingRecipe(HARBOUR, nation, detailed, level);
const atTower = (part: BuildingPart) => !part.stock &&
  Math.hypot(part.position[0] - towerX, part.position[2] - towerZ) < .02;
const isRoofPart = (part: BuildingPart) => part.surface.startsWith("roof") ||
  part.roofLayer !== undefined || part.roofProfile !== undefined;
const nearHighRoof = (part: BuildingPart) => {
  const { max, min } = getRomanPartBounds(part);
  const gapX = Math.max(min[0]! - towerX, towerX - max[0]!, 0);
  const gapZ = Math.max(min[2]! - towerZ, towerZ - max[2]!, 0);
  return isRoofPart(part) && max[1] > 1 && min[1] < 2.2 &&
    Math.hypot(gapX, gapZ) < HARBOUR_TOWER_ROOF_OPENING.radius + .04;
};
const courseRows = (parts: readonly BuildingPart[]) => {
  const rows = new Map<string, BuildingPart[]>();
  for (const part of parts.filter(candidate => atTower(candidate) && candidate.shape === "stone-arc")) {
    const { max, min } = getRomanPartBounds(part), key = `${min[1].toFixed(3)}..${max[1].toFixed(3)}`;
    rows.set(key, [...(rows.get(key) ?? []), part]);
  }
  return [...rows.values()].sort((a, b) => getRomanPartBounds(a[0]!).min[1]! -
    getRomanPartBounds(b[0]!).min[1]!);
};

const triangleCentroids = (part: BuildingPart) => {
  const geometry = createRomanPartGeometry(part, true), positions = geometry.getAttribute("position");
  const centroids: [number, number, number][] = [];
  for (let index = 0; index < positions.count; index += 3) centroids.push([
    (positions.getX(index) + positions.getX(index + 1) + positions.getX(index + 2)) / 3,
    (positions.getY(index) + positions.getY(index + 1) + positions.getY(index + 2)) / 3,
    (positions.getZ(index) + positions.getZ(index + 1) + positions.getZ(index + 2)) / 3,
  ]);
  geometry.dispose();
  return centroids;
};

describe("harbour beacon tower courses", () => {
  it("keeps the canonical beacon position", () => {
    expect(ROMAN_HARBOR_BEACON_POSITION).toEqual(HARBOUR_TOWER_POSITION);
    expect(ROMAN_HARBOR_BEACON_POSITION).toEqual([-1.04, 2.39, -.18]);
  });

  it.each(TOWER_NATIONS)("%s High stacks six closed courses without ledges", nation => {
    const rows = courseRows(recipeFor(nation, true).parts);
    expect(rows).toHaveLength(6);
    for (const row of rows) expect(row).toHaveLength(12);
    for (let index = 0; index < rows.length; index++) {
      const row = rows[index]!;
      const expectedTop = (.86 - index * .018) / 2;
      for (const block of row) expect(block.size[0]! / 2 * (block.topScale?.[0] ?? 1)).toBeCloseTo(expectedTop, 6);
      if (index === 0) continue;
      const below = rows[index - 1]!, above = row;
      const belowTop = Math.min(...below.map(block => getRomanPartBounds(block).max[1]));
      const aboveBottom = Math.max(...above.map(block => getRomanPartBounds(block).min[1]));
      // The upper course runs below the lower top cap and its flared foot covers that cap all round.
      expect(aboveBottom, `${nation} course ${index}`).toBeLessThan(belowTop);
      const lowerTop = Math.max(...below.map(block => block.size[0]! / 2 * (block.topScale?.[0] ?? 1)));
      const upperFoot = Math.min(...above.map(block => block.size[0]! / 2));
      expect(upperFoot - lowerTop, `${nation} course ${index} ledge`).toBeGreaterThan(.0005);
    }
  });

  it("keeps the Minimal tower a single closed shaft", () => {
    const parts = recipeFor("roman", false).parts;
    expect(parts.filter(atTower).filter(part => part.shape === "stone-arc")).toHaveLength(0);
    expect(parts.filter(part => atTower(part) && part.shape === "ring")).toHaveLength(3);
  });
});

describe("harbour hall roof around the beacon", () => {
  it.each(TOWER_NATIONS.flatMap(nation =>
    ([1, 5] as const).flatMap(level => ([true, false] as const).map(detailed =>
      [nation, level, detailed] as const))))(
    "%s level %i detailed=%s opens every roof piece over the tower", (nation, level, detailed) => {
      const pieces = recipeFor(nation, detailed, level).parts.filter(nearHighRoof);
      expect(pieces.length).toBeGreaterThan(0);
      expect(pieces.filter(part => !part.roofOpening)).toEqual([]);
      expect(pieces.every(part => part.roofOpening!.radius === HARBOUR_TOWER_ROOF_OPENING.radius)).toBe(true);
    });

  it("cuts the Roman gable and the Japanese tiled roof inside the tower footprint", () => {
    const candidates = [
      ...recipeFor("roman", true).parts,
      ...recipeFor("japanese", true).parts,
    ].filter(part => part.roofOpening && ["nation-roof", "box"].includes(part.shape) &&
      part.size[0]! > 1 && part.size[2]! > 1);
    expect(candidates.length).toBeGreaterThan(0);
    for (const part of candidates) {
      const centroids = triangleCentroids(part);
      const inside = centroids.filter(([x, , z]) =>
        Math.hypot(x - towerX, z - towerZ) < HARBOUR_TOWER_ROOF_OPENING.radius - .02);
      expect(inside, `${part.shape} ${part.surface}`).toEqual([]);
    }
  });

  it("clips a coarse roof slab exactly at the opening", () => {
    const opening: RoofOpening = { radius: .4, x: 0, z: 0 };
    const source = new BoxGeometry(2, .1, 2, 4, 1, 4);
    const cut = clipRoofTowerOpening(source, opening), positions = cut.getAttribute("position");
    let missing = 0, outside = 0;
    for (let index = 0; index < positions.count; index += 3) {
      const x = (positions.getX(index) + positions.getX(index + 1) + positions.getX(index + 2)) / 3;
      const z = (positions.getZ(index) + positions.getZ(index + 1) + positions.getZ(index + 2)) / 3;
      if (Math.hypot(x, z) < opening.radius - .02) missing++;
      else outside++;
    }
    expect(missing).toBe(0);
    expect(outside).toBeGreaterThan(0);
    cut.dispose();
  });
});
