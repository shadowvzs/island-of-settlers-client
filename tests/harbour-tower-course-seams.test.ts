import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart } from "../src/render-common/buildings/building-recipe";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { ROMAN_HARBOR_BEACON_POSITION } from "../src/render-common/buildings/roman-harbor";
import { HARBOUR_TYPE_ID } from "../src/shared/settlement/building-type-ids";

/** The shared harbour beacon: six coursed rings of twelve stone-arc blocks each. */
const TOWER = { blocks: 12, courses: 6, step: .018, topDiameter: .86 } as const;
const BEACON_RADIUS = .1;
const [beaconX, , beaconZ] = ROMAN_HARBOR_BEACON_POSITION;

// Chinese intentionally replaces the shared courses with one continuous plaster shaft
// (chinese-harbour-tower-seams); it is covered by that lane's own test.
const beaconBlocks = (nation: "roman" | "nubian") =>
  leveledBuildingRecipe(getBuildingDefinition(HARBOUR_TYPE_ID), nation, true, 1).parts.filter(part =>
    part.shape === "stone-arc" &&
    Math.hypot(part.position[0] - beaconX, part.position[2] - beaconZ) < BEACON_RADIUS);

/** One course's blocks, ordered from the tower foot to its crown. */
const coursesOf = (blocks: readonly BuildingPart[]) => {
  const byHeight = new Map<string, BuildingPart[]>();
  for (const block of blocks) {
    const key = block.position[1].toFixed(3);
    byHeight.set(key, [...(byHeight.get(key) ?? []), block]);
  }
  return [...byHeight.values()].sort((a, b) => a[0]!.position[1] - b[0]!.position[1]);
};

const topRadius = (block: BuildingPart) => block.size[0] / 2 * (block.topScale?.[0] ?? 1);
const footRadius = (block: BuildingPart) => block.size[0] / 2;

describe.each(["roman", "nubian"] as const)("%s harbour beacon courses", nation => {
  const courses = coursesOf(beaconBlocks(nation));

  it("keeps six complete stacked courses", () => {
    expect(courses).toHaveLength(TOWER.courses);
    for (const course of courses) expect(course).toHaveLength(TOWER.blocks);
  });

  it("normalises every course top to the authored tower taper", () => {
    courses.forEach((course, row) => {
      const expected = (TOWER.topDiameter - row * TOWER.step) / 2;
      for (const block of course) expect(topRadius(block)).toBeCloseTo(expected, 9);
    });
  });

  it("overlaps adjacent courses and covers every lower top with the flared foot above", () => {
    for (let row = 1; row < courses.length; row++) {
      const below = courses[row - 1]!, above = courses[row]!;
      const belowTop = Math.min(...below.map(block => getRomanPartBounds(block).max[1]));
      const aboveBottom = Math.max(...above.map(block => getRomanPartBounds(block).min[1]));
      // The upper block runs below the lower course's top cap: no open bed joint.
      expect(aboveBottom).toBeLessThan(belowTop);
      // Its outer foot is wider than the widest lower top: the sunlit cap is hidden all round.
      const lowerTop = Math.max(...below.map(topRadius));
      const upperFoot = Math.min(...above.map(footRadius));
      expect(upperFoot - lowerTop).toBeGreaterThan(.0005);
    }
  });
});
