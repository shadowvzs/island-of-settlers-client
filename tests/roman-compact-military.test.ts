import { Box3, Mesh, MeshStandardMaterial, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import { getPlacedBuildingLogistics } from "../src/render-common/buildings/building-grid-metrics";
import { getPlacedBuildingEntranceBounds } from "../src/render-common/buildings/building-model-clearance";
import { type BuildingSurface,createRomanBuildingRecipe } from "../src/render-common/buildings/building-recipe";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { createNurserySaplingMesh } from "../src/render-common/props/nursery-sapling";
import { WORKER_HEIGHT } from "../src/render-common/workers/worker-dimensions";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { ROAD_WIDTH } from "../src/shared/settlement/road-types";

const material = new MeshStandardMaterial();
const materials = Object.fromEntries(["mosaic", "rope", "paint", "plaster", "stone", "wood", "roof", "steel", "iron",
  "cloth", "leaf", "dark", "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber"]
  .map(surface => [surface, material])) as Record<BuildingSurface, MeshStandardMaterial>;

it("centers the whole guardhouse without changing worker clearance or LOD attachment positions", () => {
  const definition = getBuildingDefinition(2), sizing = getRomanBuildingWorldSizing(definition);
  expect(sizing.cells).toEqual([5, 4]);
  expect(sizing.scale).toBeCloseTo(1.777777777777778);
  expect(sizing.recipe.doorDimensions!.spring * sizing.scale).toBeGreaterThan(WORKER_HEIGHT);
  const high = createRomanBuildingRecipe(definition, true), minimal = createRomanBuildingRecipe(definition, false);
  for (const field of ["modelOriginOffset", "door", "workerExit", "workPoint", "mechanism", "flagAnchor",
    "archerPositions", "balconyDoor"] as const) expect(minimal[field]).toEqual(high[field]);
  const model = createRomanBuilding(definition, materials, true);
  model.fitToGrid(); model.update(0, { construction: 1, working: false, door: 0 });
  model.root.updateMatrixWorld(true);
  const staticBounds = new Box3();
  for (const object of model.root.children.filter(child => child.name.startsWith("construction_")))
    staticBounds.union(new Box3().setFromObject(object, true));
  // Small shaped-mesh deviations from recipe boxes cannot recreate the old mirrored balcony yard.
  expect(Math.abs(staticBounds.getCenter(new Vector3()).x)).toBeLessThan(.04);
  expect(Math.abs(staticBounds.getCenter(new Vector3()).z)).toBeLessThan(.04);
  expect(staticBounds.getSize(new Vector3()).x).toBeGreaterThan(4.4);
  model.dispose();
});

it.each([1, 20].flatMap(id => [0, 1, 2, 3].map(turn => [id, turn])))
  ("contains every cottage %i door vertex in its separately reserved entrance sweep, turn %i", (id, turn) => {
  const definition = getBuildingDefinition(id!), sizing = getRomanBuildingWorldSizing(definition);
  expect(sizing.cells).toEqual([4, 4]);
  expect(sizing.entrance).toHaveLength(1);
  const [width, depth] = [4, 4];
  const building = { typeId: id!, x: 30 + width / 2, y: 0, z: 30 + depth / 2, rotation: turn! };
  const entrance = getPlacedBuildingEntranceBounds(building)[0]!;
  const reserved = getPlacedBuildingLogistics(id!, building.x, building.z, turn!).road;
  for (const detailed of [true, false]) {
    const model = createRomanBuilding(definition, materials, detailed);
    model.fitToGrid(); model.root.position.set(building.x, 0, building.z);
    model.root.rotation.y = turn! * Math.PI / 2;
    for (let sample = 0; sample <= 16; sample++) {
      model.update(sample, { construction: 1, working: false, door: sample / 16 });
      model.root.updateMatrixWorld(true);
      model.root.getObjectByName("door")!.traverse(object => {
        if (!(object instanceof Mesh)) return;
        const positions = object.geometry.getAttribute("position");
        for (let vertex = 0; vertex < positions.count; vertex++) {
          const point = new Vector3().fromBufferAttribute(positions, vertex).applyMatrix4(object.matrixWorld);
          for (const axis of [0, 1, 2]) {
            expect(point.getComponent(axis)).toBeGreaterThanOrEqual(entrance.min[axis]! - 1e-6);
            expect(point.getComponent(axis)).toBeLessThanOrEqual(entrance.max[axis]! + 1e-6);
          }
          if (point.x >= 30 && point.x <= 30 + width && point.z >= 30 && point.z <= 30 + depth) continue;
          // The wider public ribbon stays beyond the real door sweep, rather than near its tip.
          const angle = turn! * Math.PI / 2;
          const forwardGap = (reserved.x - point.x) * Math.sin(angle) +
            (reserved.z - point.z) * Math.cos(angle);
          expect(forwardGap).toBeGreaterThanOrEqual(ROAD_WIDTH / 2 + .08 - 1e-6);
        }
      });
    }
    model.dispose();
  }
});

it("retains six detailed nursery seedlings while preserving the forester doorway and cottage", () => {
  const high = createRomanBuildingRecipe(getBuildingDefinition(20), true);
  const minimal = createRomanBuildingRecipe(getBuildingDefinition(20), false);
  expect(high.door).toEqual([-.58, 0, .706]);
  expect(high.doorDimensions).toEqual(minimal.doorDimensions);
  const pots = high.parts.filter(part => part.surface === "roof" && part.shape === "cylinder" && part.size[0] === .115);
  expect(pots).toHaveLength(6);
  expect(minimal.parts.filter(part => part.surface === "roof" && part.shape === "cylinder" && part.size[0] === .115))
    .toHaveLength(6);
  // Since 2026-11-03 the seedlings use the authored `nursery-sapling` prop rather than loose
  // spherical leaf parts (unfinished-owner-requests-handoff-2026-11-03.md, E6).
  const saplings = (parts: typeof high.parts) => parts.filter(part => part.shape === "nursery-sapling");
  expect(saplings(high.parts)).toHaveLength(6);
  expect(saplings(minimal.parts)).toHaveLength(6);
  const detailedSapling = createNurserySaplingMesh(true), minimalSapling = createNurserySaplingMesh(false);
  expect(detailedSapling.indices.length).toBeGreaterThan(minimalSapling.indices.length);
});
