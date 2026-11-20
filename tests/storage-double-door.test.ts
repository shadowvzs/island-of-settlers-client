import { Box3, type Group, Mesh, Raycaster, Vector3 } from "three";
import { expect, it } from "vitest";

import { STORAGE_DOUBLE_DOOR } from "../src/render-common/buildings/storage-door-profile";
import { createStorageDoubleDoor, updateStorageDoubleDoor } from "../src/renderers/three/buildings/storage-double-door";
import { createPlainBuildingMaterials } from "./helpers/building-materials";

for (const detailed of [true, false]) for (const textile of [false, true])
  it(`opens separately at real jamb hinges without consuming the shared clear aperture (${detailed}/${textile})`, () => {
    const materials = createPlainBuildingMaterials();
    const dimensions = { height: .77, spring: .63, width: STORAGE_DOUBLE_DOOR.width };
    const root = createStorageDoubleDoor(materials, detailed, [0, 0, 0], dimensions, textile);
    try {
      const left = root.getObjectByName("door_left") as Group;
      const right = root.getObjectByName("door_right") as Group;
      expect(left.position.x).toBe(0);
      expect(right.position.x).toBe(dimensions.width);
      root.updateMatrixWorld(true);
      for (const offset of textile ? [] : [-.001, 0, .001]) {
        const ray = new Raycaster(new Vector3(dimensions.width / 2 + offset, .65, .2),
          new Vector3(0, 0, -1), 0, .4);
        expect(ray.intersectObject(root, true).length, `closed seam ${offset}`).toBeGreaterThan(0);
      }
      updateStorageDoubleDoor(root, [1, 0]);
      expect(left.rotation.y).toBe(-Math.PI / 2);
      expect(right.rotation.y).toBe(0);
      updateStorageDoubleDoor(root, [0, 1]);
      expect(left.rotation.y).toBeCloseTo(0, 12);
      expect(right.rotation.y).toBe(Math.PI / 2);
      updateStorageDoubleDoor(root, [1, 1]);
      root.updateMatrixWorld(true);
      const a = new Box3().setFromObject(left), b = new Box3().setFromObject(right);
      expect(a.max.x).toBeLessThanOrEqual(STORAGE_DOUBLE_DOOR.leafDepth / 2 + 1e-7);
      expect(b.min.x).toBeGreaterThanOrEqual(dimensions.width - STORAGE_DOUBLE_DOOR.leafDepth / 2 - 1e-7);
      expect((b.min.x - a.max.x) * (16 / 11)).toBeGreaterThan(1);
      const openRay = new Raycaster(new Vector3(dimensions.width / 2, .65, .2),
        new Vector3(0, 0, -1), 0, .4);
      expect(openRay.intersectObject(root, true)).toHaveLength(0);
      expect(left.children.length).toBeLessThanOrEqual(2);
      expect(right.children.length).toBeLessThanOrEqual(2);
      if (textile) {
        expect(root.userData.profile).toBe("textile-double");
        for (const [x, y] of [[-.08, .4], [dimensions.width + .08, .4], [dimensions.width / 2, .82]]) {
          const hits = new Raycaster(new Vector3(x!, y!, .2), new Vector3(0, 0, -1), 0, .4)
            .intersectObject(root, true);
          expect(hits.length, "the sewn fixed surround closes the lodge's larger portal").toBeGreaterThan(0);
        }
      }
    } finally {
      root.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
      Object.values(materials).forEach(material => material.dispose());
    }
  });

it("supports a shared monochrome material across indexed straps and nonindexed leaf panels", () => {
  const materials = createPlainBuildingMaterials();
  const originalIron = materials.iron;
  materials.iron = materials.wood;
  let root: Group | undefined;
  try {
    root = createStorageDoubleDoor(materials, true, [0, 0, 0],
      { height: .77, spring: .63, width: STORAGE_DOUBLE_DOOR.width });
    const left = root.getObjectByName("door_left") as Group;
    const right = root.getObjectByName("door_right") as Group;
    expect(left.children.length).toBe(1);
    expect(right.children.length).toBe(1);
    expect((left.children[0] as Mesh).geometry.getAttribute("position").count).toBeGreaterThan(0);
  } finally {
    root?.traverse(object => { if (object instanceof Mesh) object.geometry.dispose(); });
    materials.iron = originalIron;
    Object.values(materials).forEach(material => material.dispose());
  }
});
