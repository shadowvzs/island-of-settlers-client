import { MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { borrowHostileCatapultMaterials } from "../src/renderers/three/buildings/hostile-catapult-materials";

const makeBase = () => Object.fromEntries(
  ["stone", "wood", "planks", "iron", "rope", "paint", "cloth"]
    .map(surface => [surface, new MeshStandardMaterial()])
) as Record<BuildingSurface, MeshStandardMaterial>;

it("retains shared faction maps until the last model releases and ignores repeated release", () => {
  const base = makeBase(), first = borrowHostileCatapultMaterials(base, "pirate", true);
  const second = borrowHostileCatapultMaterials(base, "pirate", true);
  expect(second.materials).toBe(first.materials);
  const maps = [first.materials.wood.map!, first.materials.wood.bumpMap!];
  let disposedMaps = 0, disposedMaterial = 0;
  maps.forEach(map => map.addEventListener("dispose", () => disposedMaps++));
  first.materials.wood.addEventListener("dispose", () => disposedMaterial++);
  first.release(); first.release();
  expect(disposedMaps).toBe(0); expect(disposedMaterial).toBe(0);
  second.release(); second.release();
  expect(disposedMaps).toBe(2); expect(disposedMaterial).toBe(1);
  expect(base.wood.map).toBeNull();
  Object.values(base).forEach(material => material.dispose());
});

it("isolates faction and quality owners without modifying borrowed camp materials", () => {
  const base = makeBase(), original = base.wood.color.getHex();
  const bandit = borrowHostileCatapultMaterials(base, "bandit", true);
  const pirate = borrowHostileCatapultMaterials(base, "pirate", true);
  const minimal = borrowHostileCatapultMaterials(base, "pirate", false);
  expect(bandit.materials.wood).not.toBe(pirate.materials.wood);
  expect(minimal.materials.wood.map).not.toBe(pirate.materials.wood.map);
  expect(base.wood.color.getHex()).toBe(original);
  expect(base.wood.map).toBeNull();
  bandit.release(); pirate.release(); minimal.release();
  Object.values(base).forEach(material => material.dispose());
});
