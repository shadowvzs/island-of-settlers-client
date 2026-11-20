import { Mesh, MeshStandardMaterial } from "three";
import { expect, it } from "vitest";

import type { BuildingSurface } from "../src/render-common/buildings/building-recipe";
import { createTentDoor, updateTentDoor } from "../src/renderers/three/buildings/tent-door";

it.each([true, false])("lifts a top-attached flap with closed jamb overlap, detail=%s", detailed => {
  const cloth = new MeshStandardMaterial();
  const door = createTentDoor({ cloth } as Record<BuildingSurface, MeshStandardMaterial>, detailed, [0, 0, 0]);
  const flap = door.getObjectByName("tent_fabric") as Mesh;
  expect(door.getObjectByName("door_panel")).toBeUndefined();
  expect(door.getObjectByName("door_hinge_strap")).toBeUndefined();
  updateTentDoor(door, 0); expect(flap.morphTargetInfluences![0]).toBe(0);
  updateTentDoor(door, 1); expect(flap.morphTargetInfluences![0]).toBe(1);
  const folded = flap.geometry.morphAttributes.position![0]!;
  const closed = flap.geometry.getAttribute("position");
  const x = Array.from({ length: closed.count }, (_, index) => closed.getX(index));
  expect(Math.min(...x)).toBeLessThan(-.1);
  expect(Math.max(...x)).toBeGreaterThan(.56);
  for (let index = 0; index < folded.count; index++) {
    expect(folded.getX(index)).toBe(closed.getX(index));
    expect(folded.getY(index)).toBeGreaterThan(.87);
    if (closed.getY(index) > .90) {
      expect(folded.getY(index)).toBeCloseTo(closed.getY(index), 5);
      expect(folded.getZ(index)).toBeCloseTo(closed.getZ(index), 5);
    }
  }
  expect(flap.scale.toArray()).toEqual([1, 1, 1]);
  expect(door.rotation.y).toBe(0);
  updateTentDoor(door, 0); expect(flap.morphTargetInfluences![0]).toBe(0);
  door.traverse(object => {
    if (!(object instanceof Mesh)) return;
    expect(Array.from(object.geometry.getAttribute("position").array).every(Number.isFinite)).toBe(true);
    expect(Array.from(object.geometry.getAttribute("color").array).every(value => value === 1)).toBe(true);
    object.geometry.dispose();
    if (object.userData.ownedMaterial) (object.material as MeshStandardMaterial).dispose();
  });
  cloth.dispose();
});
