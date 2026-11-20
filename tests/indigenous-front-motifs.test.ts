import { Box3, Mesh, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { indigenousDrinkPainting } from "../src/render-common/buildings/indigenous-front-paint";
import { leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { indigenousCaveMineral } from "../src/renderers/three/buildings/indigenous-cave-art-minerals";
import { indigenousCaveScene } from "../src/renderers/three/buildings/indigenous-cave-art-scenes";
import { createRomanBuilding, createRomanPartGeometry } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const paintedBounds = (id: number, detailed: boolean, level: 1 | 5) => {
  const recipe = leveledBuildingRecipe(getBuildingDefinition(id), "indigenous", detailed, level);
  const paint = recipe.parts.find(part => part.indigenousPigment)!;
  expect(paint, `${id} has its own front-facing painting`).toBeDefined();
  const geometry = createRomanPartGeometry(paint, detailed);
  try {
    expect(geometry.getAttribute("position").count).toBeGreaterThan(0);
    geometry.computeBoundingBox();
    const box = geometry.boundingBox!.clone();
    return { box, paint, recipe };
  } finally { geometry.dispose(); }
};

it.each([true, false])("moves mine paintings to the front shoulder instead of wrapping the side (%s)", detailed => {
  for (const id of [10, 11, 12, 13]) for (const level of [1, 5] as const) {
    const { box, paint, recipe } = paintedBounds(id, detailed, level);
    expect(paint.indigenousPigmentProjection).toBe("front");
    expect(box.min.x).toBeGreaterThan(recipe.door[0] + recipe.doorDimensions!.width);
    expect(box.min.z).toBeGreaterThan(paint.position[2]);
  }
});

it.each([true, false])("keeps the requested pig head on the door's right (%s)", detailed => {
  for (const id of [21]) for (const level of [1, 5] as const) {
    const { box, recipe } = paintedBounds(id, detailed, level);
    expect(box.min.x).toBeGreaterThan(recipe.door[0] + recipe.doorDimensions!.width);
    expect(box.getSize(new Vector3()).x).toBeGreaterThan(.15);
  }
});

it.each([true, false])("keeps the bison and eagle above the real door opening (%s)", detailed => {
  for (const id of [4, 22, 40]) for (const level of [1, 5] as const) {
    const { box, paint, recipe } = paintedBounds(id, detailed, level);
    expect(box.min.y).toBeGreaterThan(recipe.doorDimensions!.height + .07);
    const motif = new Map([[4, "watchful-owl"], [22, "bison"], [40, "eagle"]]);
    expect(paint.indigenousPigment).toBe(motif.get(id));
    expect(box.getSize(new Vector3()).x).toBeGreaterThan(.20);
  }
});

it("paints the complete existing drink-house reed bay without adding or moving structural model parts", () => {
  for (const detailed of [true, false]) for (const level of [1, 5] as const) {
    const recipe = leveledBuildingRecipe(getBuildingDefinition(6), "indigenous", detailed, level);
    const before = JSON.stringify(recipe);
    const paint = indigenousDrinkPainting(recipe)!;
    expect(JSON.stringify(recipe)).toBe(before);
    expect(paint.indigenousPigment).toBe("berry-drink");
    const { box } = paintedBounds(6, detailed, level);
    const reed = recipe.parts.find(part => part.surface === "cloth-reeds" &&
      part.size[2] < .04 && Math.abs(part.position[0] + .045 - paint.position[0]) < 1e-8)!;
    const reedBounds = new Box3(new Vector3(...reed.position).sub(new Vector3(...reed.size).multiplyScalar(.5)),
      new Vector3(...reed.position).add(new Vector3(...reed.size).multiplyScalar(.5)));
    expect(box.min.x).toBeGreaterThan(reedBounds.min.x + .05);
    expect(box.max.x).toBeLessThan(reedBounds.max.x - .05);
    expect(box.min.y).toBeGreaterThan(reedBounds.min.y);
    expect(box.max.y).toBeLessThan(reedBounds.max.y);
    expect(box.min.z - reedBounds.max.z).toBeCloseTo(.0008, 6);
  }
});

it("keeps every sampled ink point on real front textile, clear of opaque model geometry", () => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const id of [4, 6, 10, 11, 12, 13, 19, 21, 22, 43, 47, 51, 55, 40])
      for (const detailed of [true, false]) for (const level of [1, 2, 3, 4, 5] as const) {
      const definition = getBuildingDefinition(id), recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
      const part = recipe.parts.find(part => part.indigenousPigment)!;
      const model = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
      try {
        model.root.updateMatrixWorld(true);
        let paint: Mesh | undefined;
        const opaque: Mesh[] = [];
        model.root.traverse(object => {
          if (!(object instanceof Mesh)) return;
          if (object.userData.visualPigment) paint = object;
          const surfaces = Array.isArray(object.material) ? object.material : [object.material];
          if (surfaces.every(surface => !surface.transparent)) opaque.push(object);
        });
        expect(paint).toBeDefined();
        const [u, v, width, height] = part.indigenousPigmentRegion!;
        const direction = new Vector3(0, 0, -1).transformDirection(model.root.matrixWorld);
        for (let row = 0; row < 16; row++) for (let column = 0; column < 16; column++) {
          const x = (column + .5) / 8 - 1, y = (row + .5) / 8 - 1;
          if (!indigenousCaveScene(part.indigenousPigment!, x, y) &&
            !indigenousCaveMineral(part.indigenousPigment!, x, y)) continue;
          const target = new Vector3(part.position[0] + (u + width * x - .5) * part.size[0],
            part.position[1] + (.5 - v - height * y) * part.size[1], part.position[2] + part.size[2] * .7)
            .applyMatrix4(model.root.matrixWorld);
          const ray = new Raycaster(target.clone().addScaledVector(direction, -4), direction, 0, 8);
          const pigmentHit = ray.intersectObject(paint!, false)[0];
          expect(pigmentHit, `${id}/L${level}/${detailed}: entire ink at ${x},${y} has an existing front carrier`).toBeDefined();
          if (!pigmentHit) continue;
          const blocker = ray.intersectObjects(opaque, false)[0];
          expect(!blocker || blocker.distance >= pigmentHit.distance - .0002,
            `${id}/L${level}/${detailed}: ink ${x},${y} must not be hidden by ${String(blocker?.object.userData.buildingSurface)}` +
            ` ${blocker?.object.name} at ${String(blocker?.point.toArray())}`).toBe(true);
        }
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
}, 30000);
