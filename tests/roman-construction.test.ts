import { InstancedMesh, InterpolateDiscrete, Mesh, MeshBasicMaterial, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createBuildingShadowCaster } from "../src/renderers/three/buildings/building-shadows";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";
import { createConstructionPlan } from "../src/renderers/three/settlement/construction-plan";
import { getConstructionCost } from "../src/shared/settlement/construction-costs";

const material = new MeshStandardMaterial();
const surfaces: BuildingSurface[] = ["mosaic", "rope", "paint", "plaster", "stone", "wood", "roof", "steel", "iron",
  "cloth", "leaf", "dark", "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber", "copper", "cut-stone", "bread"];
const materials = Object.fromEntries(surfaces.map((surface) => [surface, material])) as Record<BuildingSurface, MeshStandardMaterial>;

it.each([true, false])("reveals fixed final-position pieces and wall courses without stretching in detail=%s", detailed => {
  const model = createRomanBuilding(getBuildingDefinition(17), materials, detailed);
  const data: unknown[] = [];
  model.root.traverse(object => {
    if (object instanceof Mesh && object.parent?.name.startsWith("construction_"))
      data.push(Array.from(object.geometry.getAttribute("position").array));
  });
  const triangles = model.triangles();
  const wall = model.root.getObjectByName("construction_1")!;
  model.update(0, { construction: .25, working: false, door: 0 });
  const thresholds = wall.children.map(mesh => mesh.userData.constructionCourses.height.value);
  expect(thresholds.every(Number.isFinite)).toBe(true);
  model.update(1, { construction: .35, working: false, door: 0 });
  wall.children.forEach((mesh, index) => expect(mesh.userData.constructionCourses.height.value).toBeGreaterThan(thresholds[index]!));
  model.update(2, { construction: .65, working: false, door: 0 });
  let index = 0;
  model.root.traverse(object => {
    if (!(object instanceof Mesh) || !object.parent?.name.startsWith("construction_")) return;
    expect(Array.from(object.geometry.getAttribute("position").array)).toEqual(data[index++]);
    expect(object.parent.scale.toArray()).toEqual([1, 1, 1]);
  });
  model.update(3, { construction: 1, working: false, door: 0 });
  model.root.traverse(object => {
    if (!(object instanceof Mesh) || !object.parent?.name.startsWith("construction_")) return;
    expect(object.geometry.drawRange.count).toBe(object.geometry.index?.count ?? object.geometry.getAttribute("position").count);
  });
  expect(model.triangles()).toBe(triangles);
  expect(model.root.animations[0]!.tracks.every(track => track.getInterpolation() === InterpolateDiscrete)).toBe(true);
  model.dispose();
});

it.each([true, false])("uses delivered inventories and capped original ware geometry on the site in detail=%s", detailed => {
  const definition = getBuildingDefinition(39), cost = getConstructionCost(definition.id);
  const plan = createConstructionPlan(definition, detailed, materials);
  const sand = plan.root.getObjectByName("construction_sand") as Mesh;
  expect((sand.material as MeshStandardMaterial).transparent).toBe(true);
  expect((sand.material as MeshStandardMaterial).opacity).toBeLessThan(.5);
  const stocks = plan.root.children.filter(object => object instanceof InstancedMesh) as InstancedMesh[];
  const geometries = stocks.map(mesh => mesh.geometry);
  plan.update({ construction: 0, inputStock: { planks: 1, stone: 2 } });
  expect(stocks.every(mesh => mesh.count === (mesh.userData.constructionWare === "planks" ? 1 : 2))).toBe(true);
  plan.update({ construction: .5, inputStock: { planks: 99, stone: 99 } });
  expect(plan.root.visible).toBe(true);
  stocks.forEach((mesh, index) => {
    expect(mesh.count).toBe(cost[mesh.userData.constructionWare as keyof typeof cost]);
    expect(mesh.geometry).toBe(geometries[index]);
  });
  plan.update({ construction: .7, inputStock: {} });
  expect(stocks.every(mesh => mesh.count === 0 && !mesh.visible)).toBe(true);
  plan.update({ construction: 1, inputStock: { planks: 1 } });
  expect(plan.root.visible).toBe(false);
  plan.dispose();
});

it("avoids full-wall ghost shadows while wall courses are incomplete", () => {
  const model = createRomanBuilding(getBuildingDefinition(17), materials);
  const shadowMaterial = new MeshBasicMaterial();
  const caster = createBuildingShadowCaster(model.root, shadowMaterial);
  const visibleTriangles = () => {
    const batch = caster.root.children[0];
    if (!(batch instanceof Mesh)) return 0;
    const index = batch.geometry.getIndex()!;
    let count = 0;
    for (let offset = 0; offset < index.count; offset += 3)
      if (index.getX(offset) !== 0 || index.getX(offset + 1) !== 0 || index.getX(offset + 2) !== 0)
        count++;
    return count;
  };
  const expectedTriangles = () => {
    let count = 0;
    model.root.traverse(object => {
      if (!(object instanceof Mesh)) return;
      const courses = object.userData.constructionCourses as { height: { value: number } } | undefined;
      for (let ancestor: Mesh["parent"] = object; ancestor; ancestor = ancestor.parent)
        if (!ancestor.visible) return;
      if (Number.isFinite(courses?.height.value)) return;
      const length = object.geometry.index?.count ?? object.geometry.getAttribute("position").count;
      const { count: drawCount, start } = object.geometry.drawRange;
      const end = Math.min(length, start + drawCount);
      if (end > start) count += Math.floor((end - start) / 3);
    });
    return count;
  };
  model.update(0, { construction: .3, working: false, door: 0 });
  caster.update();
  expect(visibleTriangles()).toBe(expectedTriangles());
  expect(visibleTriangles()).toBeLessThan(model.triangles());
  model.update(1, { construction: 1, working: false, door: 0 });
  caster.update();
  expect(visibleTriangles()).toBe(expectedTriangles());
  expect(visibleTriangles()).toBe(model.triangles());
  caster.dispose();
  model.dispose();
  shadowMaterial.dispose();
});

it("shows a foundation piece on the first positive hammer progress", () => {
  const model = createRomanBuilding(getBuildingDefinition(17), materials);
  model.update(0, { construction: 0, working: false, door: 0 });
  expect(model.root.getObjectByName("construction_0")!.visible).toBe(false);
  model.update(1, { construction: .001, working: false, door: 0 });
  const foundation = model.root.getObjectByName("construction_0")!;
  expect(foundation.visible).toBe(true);
  expect(foundation.scale.toArray()).toEqual([1, 1, 1]);
  expect(foundation.children.some(mesh => (mesh as Mesh).geometry.drawRange.count > 0)).toBe(true);
  model.dispose();
});

it.each([0, Math.PI / 2, Math.PI, Math.PI * 1.5])("fits sandy vertices to actual terrain in rotation %s and caches stable placements", rotation => {
  let revision = 0, offset = 0, samples = 0;
  const terrain = (x: number, z: number) => .1 * x + .07 * z + Math.sin(x * .3) * .04 + offset;
  const plan = createConstructionPlan(getBuildingDefinition(2), true, materials, {
    sample: (x, z) => { samples++; return terrain(x, z); }, revision: () => revision
  });
  plan.root.position.set(10, 2, 20);
  plan.root.rotation.y = rotation;
  plan.update({ construction: .1, inputStock: { planks: 1, stone: 1 } });
  const sand = plan.root.getObjectByName("construction_sand") as Mesh;
  const positions = sand.geometry.getAttribute("position");
  const original = positions.array;
  const count = samples;
  const check = () => {
    for (let vertex = 0; vertex < positions.count; vertex++) {
      const x = 10 + positions.getX(vertex) * Math.cos(rotation) + positions.getZ(vertex) * Math.sin(rotation);
      const z = 20 - positions.getX(vertex) * Math.sin(rotation) + positions.getZ(vertex) * Math.cos(rotation);
      expect(positions.getY(vertex) + 2).toBeCloseTo(terrain(x, z) + .025, 5);
    }
  };
  check();
  plan.update({ construction: .2, inputStock: { planks: 2, stone: 2 } });
  expect(samples).toBe(count);
  expect(positions.array).toBe(original);
  const stock = plan.root.children.find(mesh => mesh instanceof InstancedMesh) as InstancedMesh;
  const matrixY = stock.instanceMatrix.array[13]!;
  offset = .6; revision++;
  plan.update({ construction: .3, inputStock: { planks: 1 } });
  expect(samples).toBeGreaterThan(count);
  expect(positions.array).toBe(original);
  expect(stock.instanceMatrix.array[13]).toBeCloseTo(matrixY + .6, 5);
  check();
  plan.dispose();
});


it.each([true, false])("uses temporary connected work decks during masonry and roof work, then removes them in detail=%s", detailed => {
  const plan = createConstructionPlan(getBuildingDefinition(17),detailed,materials);
  const scaffold = plan.root.getObjectByName("construction_scaffolding")!;
  plan.update({construction:0,inputStock:{}});
  expect(scaffold.visible).toBe(false);
  plan.update({construction:.32,inputStock:{planks:1}});
  expect(scaffold.visible).toBe(true);
  const supports = scaffold.children.filter(child=>child.name!=="construction_roof_trusses");
  expect(supports).toHaveLength(detailed ? 2 : 1);
  for (const child of supports) {
    const mesh = child as Mesh;
    mesh.geometry.computeBoundingBox();
    expect(mesh.geometry.boundingBox!.min.y).toBeLessThanOrEqual(0);
    expect(mesh.geometry.boundingBox!.min.y).toBeGreaterThan(-.025);
    // Scaffolds occupy rear/side yards, preserving the actual +Z door/material lanes.
    expect(mesh.geometry.boundingBox!.max.z).toBeLessThan(0);
    expect(mesh.scale.toArray()).toEqual([1,1,1]);
  }
  plan.update({construction:.78,inputStock:{}});
  expect(scaffold.visible).toBe(true);
  plan.update({construction:.95,inputStock:{}});
  expect(scaffold.visible).toBe(false);
  plan.update({construction:1,inputStock:{}});
  expect(plan.root.visible).toBe(false);
  plan.dispose();
});

it("completes masonry and structural supports before roof pieces appear", () => {
  const model = createRomanBuilding(getBuildingDefinition(17),materials);
  model.update(0,{construction:.60,working:false,door:0});
  const walls = model.root.getObjectByName("construction_1")!, frame = model.root.getObjectByName("construction_2")!;
  expect(walls.children.every(mesh=>mesh.userData.constructionCourses.height.value===Infinity)).toBe(true);
  expect(frame.visible).toBe(true);
  expect(model.root.getObjectByName("construction_3")!.visible).toBe(false);
  model.update(1,{construction:.70,working:false,door:0});
  expect(model.root.getObjectByName("construction_3")!.visible).toBe(true);
  expect(frame.children.every(child=>{
    const mesh = child as Mesh;
    return mesh.geometry.drawRange.count === (mesh.geometry.index?.count ?? mesh.geometry.getAttribute("position").count);
  })).toBe(true);
  model.dispose();
});
