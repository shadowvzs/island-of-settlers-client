import { MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingPart, BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createWareRecipe } from "../src/render-common/wares/ware-recipe";
import { getJobAction, getWorkerHeldProp } from "../src/render-common/workers/worker-job-actions";
import {
  createRomanBuilding,
  createRomanPartGeometry
} from "../src/renderers/three/buildings/roman-building";

const material = new MeshStandardMaterial();
const surfaces: BuildingSurface[] = [
  "mosaic", "rope",
  "paint",
  "plaster",
  "stone",
  "wood",
  "bark",
  "endgrain",
  "fish",
  "sacking",
  "straw",
  "amber", "copper", "cut-stone", "bread",
  "roof",
  "steel",
  "iron",
  "cloth",
  "leaf",
  "dark",
  "gold"
];
const materials = Object.fromEntries(surfaces.map((surface) => [surface, material])) as Record<
  BuildingSurface,
  MeshStandardMaterial
>;

it.each([true, false])(
  "sawmill bench timber stays rounded, textured and seated on its table (%s)",
  (detailed) => {
    const model = createRomanBuilding(getBuildingDefinition(33), materials, detailed);
    const log = model.recipe.parts.find(
      (part) => !part.stock && part.surface === "bark" && part.shape === "cylinder"
    )!;
    expect(log).toBeDefined();
    const tabletop = model.recipe.parts.find((part) => part.surface === "wood" &&
      part.position[0] === log.position[0] && part.size[0] === 0.65)!;
    const bodyGeometry = createRomanPartGeometry(log, detailed); bodyGeometry.computeBoundingBox();
    expect(bodyGeometry.boundingBox!.min.y)
      .toBeCloseTo(tabletop.position[1] + tabletop.size[1] / 2, 6);
    bodyGeometry.dispose();
    const cuts = model.recipe.parts.filter(
      (part) =>
        part.surface === "endgrain" &&
        part.position[0] === log.position[0] &&
        part.position[1] === log.position[1]
    );
    expect(cuts).toHaveLength(2);
    for (const part of [log, ...cuts]) {
      const geometry = createRomanPartGeometry(part, detailed);
      const vertices = geometry.getAttribute("position");
      const angles = new Set<number>();
      for (let i = 0; i < vertices.count; i++) {
        const dx = vertices.getX(i) - part.position[0],
          dy = vertices.getY(i) - part.position[1];
        if (Math.hypot(dx, dy) > part.size[0] * .1) angles.add(Math.round(Math.atan2(dy, dx) * 100));
      }
      expect(angles.size).toBeGreaterThanOrEqual(8);
      expect(geometry.getAttribute("uv").count).toBe(vertices.count);
      geometry.dispose();
    }
    model.dispose();
  }
);

it.each([true, false])(
  "stock log geometry preserves round sides and taper at %s detail",
  (detailed) => {
    const part: BuildingPart = {
      surface: "bark",
      shape: "cylinder",
      position: [0, 0, 0],
      size: [1, 1, 1],
      stage: 3,
      stock: { kind: "output", ware: "logs", slot: 0 }
    };
    const geometry = createRomanPartGeometry(part, detailed);
    const vertices = geometry.getAttribute("position");
    const topRadii: number[] = [],
      bottomRadii: number[] = [];
    const sides = new Set<number>();
    for (let i = 0; i < vertices.count; i++) {
      const radius = Math.hypot(vertices.getX(i), vertices.getZ(i));
      if (vertices.getY(i) === 0.5) topRadii.push(radius);
      if (vertices.getY(i) === -0.5) bottomRadii.push(radius);
      sides.add(Math.round(Math.atan2(vertices.getZ(i), vertices.getX(i)) * 100));
    }
    expect(sides.size).toBeGreaterThanOrEqual(8);
    expect(Math.max(...topRadii)).toBeLessThan(Math.max(...bottomRadii));
    expect(Math.max(...bottomRadii) - Math.min(...bottomRadii)).toBeGreaterThan(0.01);
    geometry.dispose();
  }
);

it.each(["logs", "planks"])(
  "carriers resolve %s to the shared shoulder ware instead of a pack placeholder",
  (ware) => {
    expect(getJobAction("Carrier", "carry", ware)).toBe("carry_shoulder");
    expect(getWorkerHeldProp({ action: "carry_shoulder", carryingWare: ware })).toEqual({
      id: ware,
      source: "ware"
    });
    const recipe = createWareRecipe(ware, true);
    if (ware === "logs")
      expect(recipe.parts.map((part) => part.surface)).toEqual([
        "bark", "bark", "endgrain", "bark", "endgrain", "endgrain", "endgrain"
      ]);
    else {
      expect(recipe.parts.filter((part) => part.surface === "wood")).toHaveLength(3);
      expect(recipe.parts.some(part => part.surface === "rope")).toBe(false);
    }
  }
);
