import { Mesh, MeshStandardMaterial, Quaternion, Vector3 } from "three";
import { expect, it } from "vitest";

import { getBuildingDefinition } from "../src/render-common/buildings/building-catalog";
import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createRomanBuilding } from "../src/renderers/three/buildings/roman-building";

const material = new MeshStandardMaterial();
const surfaces: BuildingSurface[] = ["mosaic", "rope", "paint", "plaster", "stone", "wood", "roof", "steel", "iron",
  "cloth", "leaf", "dark", "gold", "bark", "endgrain", "fish", "sacking", "straw", "amber", "copper", "cut-stone", "bread"];
const materials = Object.fromEntries(surfaces.map(surface => [surface, material])) as Record<BuildingSurface, MeshStandardMaterial>;

it.each([true, false])("pins six explicitly tagged cords and sways only unweighted slots detailed=%s", detailed => {
  const model = createRomanBuilding(getBuildingDefinition(22), materials, detailed);
  model.fitToGrid();
  const cords = Array.from({ length: 6 }, (_, slot) => model.root.getObjectByName(`hunter_cord_${slot}`) as Mesh);
  expect(cords.every(Boolean)).toBe(true);
  expect(model.recipe.parts.filter(part => part.windCordSlot !== undefined).map(part => part.windCordSlot)).toEqual([0, 1, 2, 3, 4, 5]);
  const anchors = cords.map(cord => cord.getWorldPosition(new Vector3()));
  const vertices = cords.map(cord => Array.from(cord.geometry.getAttribute("position").array));
  const triangles = model.triangles();
  const snapshots: number[][] = [];
  for (let sample = 0; sample < 60; sample++) {
    model.update(sample / 10, { construction: 1, door: 0, working: false, outputStock: { meat: 3 }, windStrength: 1 });
    snapshots.push(cords.map(cord => cord.quaternion.angleTo(new Quaternion())));
    cords.forEach((cord, slot) => {
      expect(cord.getWorldPosition(new Vector3()).distanceTo(anchors[slot]!)).toBeLessThan(1e-9);
      expect(cord.quaternion.angleTo(new Quaternion())).toBeLessThan(.08);
      if (slot < 3) expect(cord.quaternion.angleTo(new Quaternion())).toBe(0);
    });
  }
  expect(snapshots.some(angles => angles[3]! > .03)).toBe(true);
  expect(new Set(snapshots[0]!.slice(3))).toHaveProperty("size", 3);
  model.update(8, { construction: 1, door: 0, working: false, outputStock: { meat: 6 } });
  expect(cords.every(cord => cord.quaternion.equals(new Quaternion()))).toBe(true);
  model.update(9, { construction: .5, door: 0, working: false, outputStock: {} });
  expect(cords.every(cord => !cord.parent!.visible)).toBe(true);
  cords.forEach((cord, slot) => expect(Array.from(cord.geometry.getAttribute("position").array)).toEqual(vertices[slot]));
  expect(model.triangles()).toBe(triangles);
  const ambient = model.root.animations.find(clip => clip.name === "ambient_empty_cords")!;
  expect(ambient.tracks).toHaveLength(6);
  for (const track of ambient.tracks) expect(Array.from(track.values).every(Number.isFinite)).toBe(true);
  model.dispose();
});

it.each([true, false])("keeps each hanging joint bound to its cord as inventory changes detailed=%s", detailed => {
  const model = createRomanBuilding(getBuildingDefinition(22), materials, detailed);
  for (let slot = 0; slot < 6; slot++) {
    const cord = model.recipe.parts.find(part => part.windCordSlot === slot)!;
    const tie = model.recipe.parts.find(part => part.stock?.ware === "meat" &&
      part.stock.slot === slot && part.surface === "rope")!;
    expect(tie.stock?.presentation).toBe("hanging");
    expect(cord.position[1] - cord.size[1] / 2).toBeCloseTo(tie.position[1], 8);
    expect(cord.position[0]).toBe(tie.position[0]);
    expect(cord.position[2]).toBe(tie.position[2]);
  }
  for (let count = 0; count <= 6; count++) {
    model.update(0, { construction: 1, working: false, door: 0, outputStock: { meat: count } });
    const visible = new Set<number>();
    model.root.traverseVisible(object => {
      const stock = object.userData.stock;
      if (stock?.ware === "meat") visible.add(stock.slot);
    });
    expect([...visible].sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, index) => index));
  }
  model.dispose();
});
