import { Euler, Vector3 } from "three";
import { describe, expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds } from "../src/render-common/buildings/building-recipe-fit";
import { createNationBuildingRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { DRAGON_ATLAS } from "../src/renderers/three/buildings/japanese-dragon-atlas";
import { createDragonCoilGeometry } from "../src/renderers/three/buildings/japanese-dragon-geometry";

/** The Japanese HQ's porch dragon: coil diameter, height, body thickness (recipe units). */
const SIZE = [.1963, 1.02, .078] as const;
const COLUMN = SIZE[0] / 2 - SIZE[2] / 2 * .85;
/** Below the head (whose horns sweep back over the column top): only the legs' claws are ivory. */
const CLAW_ZONE_TOP = .3;

const geometryOf = (detailed: boolean) => createDragonCoilGeometry(SIZE, detailed);

/** Vertex positions back in recipe units. */
const points = (detailed: boolean) => {
  const position = geometryOf(detailed).getAttribute("position");
  return Array.from({ length: position.count }, (_, index) => new Vector3(position.getX(index) * SIZE[0],
    position.getY(index) * SIZE[1], position.getZ(index) * SIZE[2]));
};

describe("Japanese column dragon", () => {
  it("stays inside the High and Minimal triangle budgets", () => {
    expect(geometryOf(true).index!.count / 3).toBeLessThan(8000);
    expect(geometryOf(false).index!.count / 3).toBeLessThan(1150);
  });

  it("faces its triangles outwards (only a few fold in at the elbows' inner bend)", () => {
    for (const detailed of [true, false]) {
      const geometry = geometryOf(detailed), index = geometry.index!.array, normal = geometry.getAttribute("normal");
      const vertices = points(detailed);
      let inward = 0;
      for (let face = 0; face < index.length; face += 3) {
        const [a, b, c] = [index[face]!, index[face + 1]!, index[face + 2]!];
        const facing = vertices[b]!.clone().sub(vertices[a]!).cross(vertices[c]!.clone().sub(vertices[a]!));
        // Normals back in recipe units: the inverse transpose of the 1/size scale.
        const outward = new Vector3(normal.getX(a) / SIZE[0], normal.getY(a) / SIZE[1], normal.getZ(a) / SIZE[2]);
        if (facing.dot(outward) < 0) inward++;
      }
      expect(inward / (index.length / 3), `detailed ${detailed}`).toBeLessThan(.02);
    }
  });

  it("grips the column: pale claw tips reach its surface without passing through it", () => {
    for (const detailed of [true, false]) {
      const uv = geometryOf(detailed).getAttribute("uv");
      const claws = points(detailed).filter((point, index) => point.y < CLAW_ZONE_TOP &&
        uv.getX(index) >= DRAGON_ATLAS.ivory.u0 && uv.getX(index) <= DRAGON_ATLAS.ivory.u1)
        .map(point => Math.hypot(point.x, point.z));
      expect(claws.length).toBeGreaterThan(0);
      expect(Math.min(...claws)).toBeGreaterThan(COLUMN - SIZE[2] * .1);
      expect(claws.some(distance => distance < COLUMN)).toBe(true);
    }
  });

  it("maps the body onto the scale and belly strips of the atlas", () => {
    const uv = geometryOf(true).getAttribute("uv");
    const us = Array.from({ length: uv.count }, (_, index) => uv.getX(index));
    expect(us.some(u => u < DRAGON_ATLAS.scales.u1)).toBe(true);
    expect(us.some(u => u > DRAGON_ATLAS.belly.u0 && u < DRAGON_ATLAS.belly.u1)).toBe(true);
    expect(us.some(u => u > DRAGON_ATLAS.pearl.u0 && u < DRAGON_ATLAS.pearl.u1)).toBe(true);
  });

  it("puts one dragon on each HQ porch column", () => {
    for (const detailed of [true, false]) {
      const dragons = createNationBuildingRecipe(getBuildingDefinition(0), "japanese", detailed).parts
        .filter(part => part.shape === "dragon-coil");
      expect(dragons).toHaveLength(2);
    }
  });

  it.each([true, false])("keeps the Storehouse dragon mesh outside its walls (detail: %s)", detailed => {
    const recipe = createNationBuildingRecipe(getBuildingDefinition(29), "japanese", detailed);
    const walls = recipe.parts.filter(part => part.shape === "box" && part.surface === "plaster")
      .map(getRomanPartBounds);
    const dragons = recipe.parts.filter(part => part.shape === "dragon-coil");
    expect(dragons).toHaveLength(1);
    for (const dragon of dragons) {
      const vertices = createDragonCoilGeometry(dragon.size, detailed).getAttribute("position");
      const size = new Vector3(...dragon.size), offset = new Vector3(...dragon.position);
      const rotation = new Euler(...(dragon.rotation ?? [0, 0, 0]), "ZYX");
      let embedded = 0;
      for (let index = 0; index < vertices.count; index++) {
        const point = new Vector3().fromBufferAttribute(vertices, index).multiply(size).applyEuler(rotation).add(offset);
        if (walls.some(wall => [point.x, point.y, point.z].every((value, axis) =>
          value > wall.min[axis]! && value < wall.max[axis]!))) embedded++;
      }
      expect(embedded).toBe(0);
    }
  });
});
