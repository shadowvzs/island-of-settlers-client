import { Box3, Matrix4, Mesh, Vector3 } from "three";
import { expect, it } from "vitest";

import { BUILDING_CATALOG } from "../src/render-common/buildings/building-catalog";
import { getRomanPartBounds, getRomanRecipeBounds } from "../src/render-common/buildings/building-recipe-fit";
import { nationTriangleBudget } from "../src/render-common/buildings/building-triangle-budgets";
import { getRomanBuildingWorldSizing } from "../src/render-common/buildings/building-world-sizing";
import { buildingLevelAdditions, leveledBuildingRecipe } from "../src/render-common/buildings/levels/leveled-building-recipe";
import { createLevelPlanRecipe } from "../src/render-common/buildings/nation-building-recipe";
import { getRomanWareStockSlots, romanWareStockPlacement } from "../src/render-common/buildings/roman-ware-stock";
import { stockWareDimensions } from "../src/render-common/buildings/ware-stock-envelope";
import { createIndigenousQuarryStoneMaterial } from "../src/renderers/three/buildings/indigenous-quarry-stone-material";
import { createIndigenousWorkshopStoneGeometry } from "../src/renderers/three/buildings/indigenous-workshop-stone-geometry";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

const quarries = [19, 43, 47, 51, 55];
const foresters = [20, 41, 45, 49, 53];
const levels = [1, 2, 3, 4, 5] as const;

it("fills its bonded masonry cells with broad dimensional faces and narrow joints", () => {
  for (const detailed of [true, false]) for (let variant = 0; variant < 20; variant++) {
    const geometry = createIndigenousWorkshopStoneGeometry(detailed, variant);
    try {
      const vertices = geometry.getAttribute("position");
      let projected = 0;
      for (let index = 0; index < vertices.count; index += 3) {
        if ([0, 1, 2].some(offset => vertices.getZ(index + offset) < 0)) continue;
        const ax = vertices.getX(index), ay = vertices.getY(index);
        const bx = vertices.getX(index + 1), by = vertices.getY(index + 1);
        const cx = vertices.getX(index + 2), cy = vertices.getY(index + 2);
        projected += Math.abs((bx - ax) * (cy - ay) - (by - ay) * (cx - ax)) / 2;
      }
      expect(projected).toBeGreaterThan(.90);
      expect(vertices.count / 3).toBeLessThanOrEqual(detailed ? 80 : 24);
      const normals = geometry.getAttribute("normal"), shared = new Map<string, Vector3>();
      for (let index = 0; index < vertices.count; index++) {
        const key = [vertices.getX(index), vertices.getY(index), vertices.getZ(index)].join(",");
        const normal = new Vector3().fromBufferAttribute(normals, index), previous = shared.get(key);
        if (previous) expect(normal.distanceTo(previous)).toBeLessThan(.00001);
        else shared.set(key, normal);
      }
    } finally { geometry.dispose(); }
  }
});

it("uses smooth subdued quarry-only mineral textures instead of high-contrast pixel flecks", () => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const detailed of [true, false]) {
      const material = createIndigenousQuarryStoneMaterial(materials.stone, detailed);
      try {
        const image = material.map!.image as { data: Uint8Array; height: number; width: number };
        let maximum = 0;
        for (let y = 0; y < image.height; y++) for (let x = 0; x < image.width; x++) {
          const at = (y * image.width + x) * 4;
          const next = (y * image.width + (x + 1) % image.width) * 4;
          maximum = Math.max(maximum, Math.abs(image.data[at]! - image.data[next]!));
        }
        expect(maximum).toBeLessThan(16);
        expect(Boolean(material.normalMap)).toBe(detailed);
        expect(material.name).toBe("indigenous_quarry_stone");
      } finally { material.map?.dispose(); material.normalMap?.dispose(); material.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it("bears the stone header on a lintel seated into both returns and keeps tools on the inner rear wall", () => {
  for (const id of quarries) for (const detailed of [true, false]) for (const level of levels) {
    const recipe = leveledBuildingRecipe(BUILDING_CATALOG.find(value => value.id === id)!,
      "indigenous", detailed, level);
    const lintel = recipe.parts.find(part => part.architecture && part.surface === "wood" &&
      part.shape === "bevel-box" && part.size[1] === .065 && part.size[2] === .11)!;
    expect(lintel).toBeDefined();
    const bounds = getRomanPartBounds(lintel), left = recipe.door[0];
    const right = left + recipe.doorDimensions!.width;
    expect(bounds.min[0]).toBeLessThan(left - .13);
    expect(bounds.max[0]).toBeGreaterThan(right + .13);
    const headers = recipe.parts.filter(part => part.indigenousMasonryStone &&
      part.position[0] > left && part.position[0] < right && part.position[2] > recipe.door[2] - .1);
    expect(headers.length).toBeGreaterThan(0);
    expect(Math.min(...headers.map(part => getRomanPartBounds(part).min[1])))
      .toBeCloseTo(bounds.max[1], 2);
    const headerCore = recipe.parts.find(part => part.architecture && part.surface === "indigenous-rubble" &&
      part.shape === "box" && part.position[0] > left && part.position[1] > recipe.doorDimensions!.height)!;
    expect(getRomanPartBounds(headerCore).min[0]).toBeCloseTo(left - .065, 6);
    const tools = recipe.parts.filter(part => part.workyardAssembly === "resource-19" && !part.stock &&
      part.size[0] < .5 && part.position[1] >= .5 && part.position[0] >= -.65 && part.position[0] <= -.15);
    expect(tools).toHaveLength(detailed ? 7 : 0);
    expect(tools.every(part => part.position[2] < -.35)).toBe(true);
  }
});

it("gives all material quarries masonry rooms and foresters timber rooms without moving canonical contacts", () => {
  for (const id of [...quarries, ...foresters]) for (const detailed of [true, false]) for (const level of levels) {
    const definition = BUILDING_CATALOG.find(value => value.id === id)!;
    const original = createLevelPlanRecipe(definition, detailed, level).plan;
    const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
    for (const key of ["door", "doorDimensions", "workPoint", "workerExit", "mechanism"] as const)
      expect(recipe[key], `${id}/${level}/${detailed}/${key}`).toEqual(original[key]);
    const before = getRomanRecipeBounds(definition, original), after = getRomanRecipeBounds(definition, recipe);
    expect(after.extentX).toBeLessThanOrEqual(before.extentX + .001);
    expect(after.extentZ).toBeLessThanOrEqual(before.extentZ + .001);
    expect(recipe.parts.some(part => part.shape === "indigenous-floor-hide")).toBe(true);
    expect(recipe.parts.some(part => part.shape === "indigenous-roof" && part.indigenousEntrance)).toBe(false);
    if (quarries.includes(id)) {
      expect(recipe.parts.filter(part => part.shape === "structural-rock").length).toBeGreaterThan(45);
      expect(recipe.parts.some(part => part.indigenousPigment)).toBe(true);
      expect(recipe.parts.some(part => part.shape === "ring" && part.size[0] === .058)).toBe(false);
      expect(recipe.parts.some(part => part.shape === "cone" && part.size[1] === .065)).toBe(false);
    } else {
      expect(recipe.parts.filter(part => part.surface === "planks" && part.size[1] > .3).length).toBeGreaterThan(3);
      expect(recipe.parts.filter(part => part.shape === "nursery-sapling")).toHaveLength(6);
    }
  }
});

it("retains supported national masonry upgrades at levels two through four, with the shared level-five no-op", () => {
  for (const id of quarries) for (const detailed of [true, false]) {
    const definition = BUILDING_CATALOG.find(value => value.id === id)!;
    const additions = levels.map(level => buildingLevelAdditions(definition, "indigenous", detailed, level));
    expect(additions[0]).toHaveLength(0);
    expect(additions[1]!.length).toBeGreaterThan(0);
    expect(additions[2]!.length).toBeGreaterThan(additions[1]!.length);
    expect(additions[3]!.length).toBeGreaterThan(additions[2]!.length);
    expect(additions[4]).toEqual(additions[3]);
    const canopy = additions[3]!.filter(part => part.surface === "straw" && part.size[0] === .5);
    expect(canopy).toHaveLength(1);
    expect(canopy[0]!.position[2]).toBeLessThan(-.6);
    const struts = additions[3]!.filter(part => part.surface === "wood" && part.size[0] === .035 && part.rotation);
    expect(struts).toHaveLength(2);
    expect(struts.every(part => part.position[2] < -.6)).toBe(true);
    expect(additions[3]!.filter(part => part.surface === "straw" && part.size[0] > .8 && part.size[2] > .3))
      .toHaveLength(0);
    expect(additions[4]!.some(part => part.windowShadow || part.shape === "window-shadow")).toBe(false);
  }
});

it("retains the complete stock bench load path and every stone slot at all tiers and resource variants", () => {
  for (const id of quarries) for (const detailed of [true, false]) for (const level of levels) {
    const definition = BUILDING_CATALOG.find(value => value.id === id)!;
    const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
    const stones = recipe.parts.filter(part => part.stock && part.shape === "stone-block");
    expect(stones).toHaveLength(6);
    const shelf = recipe.parts.find(part => !part.stock && part.workyardAssembly === "resource-19" &&
      ["bevel-box", "box"].includes(part.shape) && part.size[0] > 1)!;
    expect(shelf).toBeDefined();
    const top = shelf.position[1] + shelf.size[1] / 2;
    for (const stone of stones) {
      const bounds = getRomanPartBounds(stone);
      if (stone.stock!.slot < 3) expect(bounds.min[1]).toBeCloseTo(top, 6);
      else if (id === 55) expect(bounds.min[1]).toBeCloseTo(.55, 6);
      else expect(bounds.min[1]).toBeCloseTo(stones[stone.stock!.slot - 3]!.position[1] + stone.size[1] / 2, 6);
    }
    const feet = recipe.parts.filter(part => part.workyardAssembly === "resource-19" &&
      !part.stock && part.size[0] === .075 && part.size[2] === .075);
    expect(feet).toHaveLength(4);
    for (const foot of feet) {
      const bounds = getRomanPartBounds(foot);
      expect(bounds.min[1]).toBeCloseTo(0, 6);
      expect(bounds.max[1]).toBeCloseTo(shelf.position[1] - shelf.size[1] / 2, 6);
    }
  }
});

it("keeps entrance approach and open door sweep clear of the new structural parts", () => {
  for (const id of [...quarries, ...foresters]) for (const detailed of [true, false]) for (const level of levels) {
    const recipe = leveledBuildingRecipe(BUILDING_CATALOG.find(value => value.id === id)!,
      "indigenous", detailed, level);
    const left = recipe.door[0], width = recipe.doorDimensions?.width ?? .46;
    for (const part of recipe.parts.filter(part => part.architecture &&
      (part.shape === "structural-rock" || ["indigenous-rubble", "planks", "bark"].includes(part.surface)))) {
      const bounds = getRomanPartBounds(part);
      const blocking = bounds.min[0] < left + width - .01 && bounds.max[0] > left + .01 &&
        bounds.min[1] < .72 && bounds.max[1] > .1 &&
        bounds.min[2] < recipe.door[2] + width && bounds.max[2] > recipe.door[2] - .015;
      expect(blocking, `${id}/${level}/${detailed}/${part.position.join(",")}`).toBe(false);
    }
    if (quarries.includes(id)) for (const part of buildingLevelAdditions(
      BUILDING_CATALOG.find(value => value.id === id)!, "indigenous", detailed, level)) {
      const bounds = getRomanPartBounds(part), centre = left + width / 2;
      const blocked = bounds.min[0] < centre + .31 && bounds.max[0] > centre - .31 &&
        bounds.min[1] < .82 && bounds.max[1] > .025 &&
        bounds.min[2] < recipe.door[2] + .934 && bounds.max[2] > recipe.door[2] + .174;
      expect(blocked, `${id}/${level}/${detailed}/tier worker approach`).toBe(false);
    }
  }
});

it("seats the actual carried mineral shapes without floating or intersecting adjacent stock columns", () => {
  for (const id of quarries) for (const detailed of [true, false]) for (const level of levels) {
    const definition = BUILDING_CATALOG.find(value => value.id === id)!;
    const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
    const scale = getRomanBuildingWorldSizing(definition).scale;
    const slots = getRomanWareStockSlots(recipe, scale);
    expect(slots).toHaveLength(6);
    for (const slot of slots.filter(slot => slot.stock.slot >= 3)) {
      if (id === 55) { expect(slot.bottom).toBeCloseTo(.55, 6); continue; }
      expect(slot.support, `${id}/${level}/${detailed}/slot${slot.stock.slot}`).toBeDefined();
      const below = slot.support!;
      const placement = romanWareStockPlacement(below, below.stock.ware, scale);
      const height = stockWareDimensions(below.stock.ware, scale, below.yaw, below.horizontalSpan).size[1];
      expect(slot.bottom).toBeCloseTo(placement.center[1] + height / 2, 6);
    }
    const row = slots.filter(slot => slot.stock.slot < 3).sort((a, b) => a.center[0] - b.center[0]);
    for (let index = 1; index < row.length; index++) {
      const left = row[index - 1]!, right = row[index]!;
      const leftWidth = stockWareDimensions(left.stock.ware, scale, left.yaw, left.horizontalSpan).size[0];
      const rightWidth = stockWareDimensions(right.stock.ware, scale, right.yaw, right.horizontalSpan).size[0];
      expect(right.center[0] - rightWidth / 2).toBeGreaterThan(left.center[0] + leftWidth / 2);
    }
  }
});

it("places real Granite mesh vertices on supported rack boards at every level and detail setting", () => {
  const materials = createPlainBuildingMaterials();
  try {
    const definition = BUILDING_CATALOG.find(value => value.id === 55)!;
    for (const detailed of [true, false]) for (const level of levels) {
      const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
      const model = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
      try {
        model.root.updateMatrixWorld(true);
        for (let slot = 0; slot < 6; slot++) {
          const stock = model.root.getObjectByName(`stock_output_${slot}_granite`)!;
          expect(stock).toBeDefined();
          const vertices: Vector3[] = [];
          stock.traverse(object => {
            if (!(object instanceof Mesh)) return;
            const positions = object.geometry.getAttribute("position");
            for (let index = 0; index < positions.count; index++) vertices.push(new Vector3()
              .fromBufferAttribute(positions, index).applyMatrix4(object.matrixWorld));
          });
          const minimum = Math.min(...vertices.map(vertex => vertex.y));
          expect(minimum).toBeCloseTo(slot < 3 ? .29 : .55, 6);
          const contacts = vertices.filter(vertex => Math.abs(vertex.y - minimum) < .000001);
          expect(contacts.length).toBeGreaterThan(0);
          for (const point of contacts) {
            expect(point.x).toBeGreaterThan(-1.08);
            expect(point.x).toBeLessThan(.02);
            expect(point.z).toBeGreaterThan(.70);
            expect(point.z).toBeLessThan(1.10);
          }
        }
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it("preserves the timber door hinge and clears the whole moving leaf at all four rotations", () => {
  const materials = createPlainBuildingMaterials();
  try {
    const definition = BUILDING_CATALOG.find(value => value.id === 19)!;
    for (const detailed of [true, false]) for (const level of levels) {
      const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
      expect(recipe.tentDoor).toBe(false);
      const model = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
      try {
        const door = model.root.getObjectByName("door")!;
        expect(door.position.toArray()).toEqual(recipe.door);
        const obstacles = [...recipe.parts.filter(part => part.indigenousMasonryStone ||
          part.architecture && part.surface === "indigenous-rubble"),
        ...buildingLevelAdditions(definition, "indigenous", detailed, level)];
        const walls = obstacles.map(part => {
          const bounds = getRomanPartBounds(part);
          return new Box3(new Vector3(...bounds.min), new Vector3(...bounds.max));
        });
        for (let rotation = 0; rotation < 4; rotation++) {
          model.root.rotation.y = rotation * Math.PI / 2;
          const turn = new Matrix4().makeRotationY(model.root.rotation.y);
          const turnedWalls = walls.map(wall => wall.clone().applyMatrix4(turn));
          for (let step = 0; step <= 18; step++) {
            model.update(1, { construction: 1, door: step / 18, working: false });
            model.root.updateMatrixWorld(true);
            const leaf = new Box3().setFromObject(door);
            const nearby = turnedWalls.filter(wall => leaf.intersectsBox(wall));
            if (!nearby.length) continue;
            door.traverse(object => {
              if (!(object instanceof Mesh)) return;
              const vertices = object.geometry.getAttribute("position");
              for (let index = 0; index < vertices.count; index++) {
                const point = new Vector3().fromBufferAttribute(vertices, index).applyMatrix4(object.matrixWorld);
                for (const wall of nearby) expect(wall.clone().expandByScalar(-.001).containsPoint(point),
                  `${detailed}/${level}/rotation${rotation}/step${step}`).toBe(false);
              }
            });
          }
        }
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
});

it("stays inside existing actual mesh budgets at every resource and upgrade tier on both detail levels", () => {
  const materials = createPlainBuildingMaterials();
  try {
    for (const id of [...quarries, ...foresters]) for (const detailed of [true, false]) for (const level of levels) {
      const definition = BUILDING_CATALOG.find(value => value.id === id)!;
      const recipe = leveledBuildingRecipe(definition, "indigenous", detailed, level);
      const model = createRomanBuilding(definition, materials, detailed, recipe, "indigenous");
      try {
        expect(model.triangles(false), `${id}/${level}/${detailed}`)
          .toBeLessThanOrEqual(nationTriangleBudget("indigenous", id)[detailed ? 0 : 1]);
      } finally { model.dispose(); }
    }
  } finally { Object.values(materials).forEach(material => material.dispose()); }
}, 60000);
