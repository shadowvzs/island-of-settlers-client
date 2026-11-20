import { expect, it } from "vitest";

import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createCatapultTowerRecipe } from "../src/render-common/buildings/catapult-tower-recipe";
import { createHostileCatapultRecipe } from "../src/render-common/buildings/hostile-catapult-recipe";
import { rotationFromEuler } from "../src/render-common/buildings/recipe-rotation";

it.each([true, false])("both hostile structures retain exact operational hardware and entry clearance (detailed %s)", detailed => {
  const reference = createCatapultTowerRecipe("maya", detailed);
  const hardware = reference.parts.slice(reference.parts.findIndex(part => part.shape === "catapult-deck"));
  const variants = ["bandit", "pirate"] as const;
  const structures = variants.map(variant => createHostileCatapultRecipe(variant, detailed));
  for (const recipe of structures) {
    const deck = recipe.parts.findIndex(part => part.shape === "catapult-deck");
    expect(recipe.parts.slice(deck)).toEqual(hardware);
    expect(recipe.door).toEqual(reference.door);
    expect(recipe.workPoint).toEqual(reference.workPoint);
    expect(recipe.workerExit).toEqual(reference.workerExit);
    expect(recipe.parts.filter(part => part.stock?.ware === "stone")).toHaveLength(2);
    for (const part of recipe.parts.slice(0, deck)) {
      const { max, min } = getRomanPartBounds(part);
      expect(Math.max(Math.abs(min[0]), Math.abs(max[0]))).toBeLessThanOrEqual(.83);
      expect(Math.max(Math.abs(min[2]), Math.abs(max[2]))).toBeLessThanOrEqual(.83);
      const intersectsEntry = max[0] > -.26 && min[0] < .26 && max[1] > .13 && min[1] < .84 &&
        max[2] > .58 && min[2] < .77;
      expect(intersectsEntry).toBe(false);
    }
  }
  const shell = (index: number) => structures[index]!.parts
    .slice(0, structures[index]!.parts.findIndex(part => part.shape === "catapult-deck"))
    .map(({ position, rotation, shape, size }) => ({ position, rotation, shape, size }));
  expect(shell(0)).not.toEqual(shell(1));
});

it.each([true, false])("pirate facets conserve the protected old stair room and enlarged NW hatch pocket (detailed %s)", detailed => {
  const recipe = createHostileCatapultRecipe("pirate", detailed);
  const shaft = recipe.parts.slice(0, recipe.parts.findIndex(part => part.shape === "catapult-deck"));
  const protectedPoints: [number, number, number][] = [];
  for (let y = .15; y < 2.47; y += .05) {
    for (const x of [-.535, 0, .535]) for (const z of [-.535, 0, .535]) protectedPoints.push([x, y, z]);
    if (y >= 1.775) protectedPoints.push([-.62, y, -.61], [-.62, y, -.38], [-.38, y, -.61]);
  }
  for (const part of shaft) for (const point of protectedPoints) {
    const matrix = rotationFromEuler(part.rotation ?? [0, 0, 0]);
    const delta = point.map((value, axis) => value - part.position[axis]!);
    const local = [0, 1, 2].map(axis => matrix[0][axis]! * delta[0]! +
      matrix[1][axis]! * delta[1]! + matrix[2][axis]! * delta[2]!);
    const inside = local.every((value, axis) => Math.abs(value) < part.size[axis]! / 2 - 1e-6);
    expect(inside).toBe(false);
  }
});

it("pirate inset floor covers all old stair-room corners and the complete doorway threshold", () => {
  const recipe = createHostileCatapultRecipe("pirate", false);
  const floor = recipe.parts.find(part => part.position[1] === .06)!;
  expect(floor.shape).toBe("cylinder");
  const inscribed = floor.size[0] / 2 * Math.cos(Math.PI / floor.radialSegments!);
  expect(inscribed).toBeGreaterThan(Math.hypot(.535, .535));
  expect(inscribed).toBeGreaterThan(Math.hypot(.23, .72));
});
