import { Box3, Matrix4, type Object3D, Vector3 } from "three";

import { CATAPULT_CARRY_FORWARD } from "../../render-common/buildings/catapult-dimensions";
import { HAND_CARRIED_INGREDIENTS } from "../../render-common/wares/ware-catalog";
import { createCradleCarry } from "./worker-cradle-carry";
import { createPropSurfaceSampler } from "./worker-prop-surface";

const contactResets = new WeakMap<Object3D, () => void>();
const supportBounds = new WeakMap<Object3D, Box3>();

/** Bounds in the load's frame, including the grain bundle's carry rotation and nested meshes. */
const getSupportBounds = (load: Object3D, shape: Object3D) => {
  const cached = supportBounds.get(shape);
  if (cached) return cached;
  load.updateWorldMatrix(true, true);
  const inverse = new Matrix4().copy(load.matrixWorld).invert();
  const transform = new Matrix4(), part = new Box3(), bounds = new Box3();
  shape.traverse(child => {
    const mesh = child as import("three").Mesh;
    if (!mesh.isMesh) return;
    if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
    transform.multiplyMatrices(inverse, mesh.matrixWorld);
    bounds.union(part.copy(mesh.geometry.boundingBox!).applyMatrix4(transform));
  });
  supportBounds.set(shape, bounds);
  return bounds;
};
export const resetStoneHandContacts = (root: Object3D) => contactResets.get(root)?.();

/** Stone and bread rest on both palms in front of the chest. */
export const placeCarriedStone = (stone: Object3D, tucked = false) => {
  stone.position.set(0, tucked ? .75 : .79, (tucked || stone.userData.catapultStone) ? CATAPULT_CARRY_FORWARD : .35);
  stone.quaternion.identity();
};

export const createCradledWareHandContacts = (root: Object3D) => {
  const towardBody = new Vector3(), support = new Vector3(), cradle = new Vector3();
  let ware: Object3D;
  const surfaces = new WeakMap<Object3D, ReturnType<typeof createPropSurfaceSampler>>();
  const grips = [new Vector3(), new Vector3()];
  let catapultPickup = false, ready = false;
  let surface: ReturnType<typeof createPropSurfaceSampler> | undefined;
  const bounds = new Box3(), size = new Vector3(), center = new Vector3();
  const contacts = createCradleCarry(root, {
    supportName: "stoneSupport",
    prepare: (load, transfer) => {
      ware = load;
      catapultPickup = !!load.userData.catapultStone && transfer.direction === "pickup";
      ready = false;
      const shape = load.getObjectByName("ware_geometry");
      if (!shape) return 0;
      bounds.copy(getSupportBounds(load, shape));
      bounds.getSize(size); bounds.getCenter(center);
      if (catapultPickup) {
        surface = surfaces.get(load) ?? createPropSurfaceSampler(load);
        surfaces.set(load, surface);
      }
      if (load.userData.catapultStone) return 16;
      return HAND_CARRIED_INGREDIENTS.includes(transfer.ware) ? 8 : 5;
    },
    target: (target, sign, lift, carryOnly) => {
      if (catapultPickup && !carryOnly && surface) {
        if (!ready) {
          towardBody.copy(root.getWorldPosition(towardBody)); ware.worldToLocal(towardBody);
          towardBody.y = 0; towardBody.normalize();
          for (const [index, side] of [1, -1].entries()) {
            support.set(center.x + towardBody.x * size.x * .28 - towardBody.z * side * size.x * .2,
              bounds.min.y + size.y * .26,
              center.z + towardBody.z * size.z * .28 + towardBody.x * side * size.z * .2);
            cradle.set(center.x + side * size.x * .3, bounds.min.y - .006, bounds.min.z + size.z * .1);
            // A resting boulder is grasped on its lower flanks, never with fingers below the deck.
            // Follow its actual irregular surface as the palms turn into the lifted cradle.
            surface.closest(support.lerp(cradle, lift), grips[index]!);
          }
          ready = true;
        }
        target.copy(grips[sign === 1 ? 0 : 1]!);
        return;
      }
      target.set(center.x + sign * size.x * .3, bounds.min.y - .006, bounds.min.z + size.z * .1);
      if (!carryOnly) {
        towardBody.copy(root.getWorldPosition(towardBody)); ware.worldToLocal(towardBody);
        towardBody.y = 0; towardBody.normalize();
        support.set(center.x + towardBody.x * size.x * .28 - towardBody.z * sign * size.x * .2, bounds.min.y - .006,
          center.z + towardBody.z * size.z * .28 + towardBody.x * sign * size.z * .2);
        target.copy(support)
          .lerp(cradle.set(center.x + sign * size.x * .3, bounds.min.y - .006, bounds.min.z + size.z * .1), lift);
      }
    }
  });
  contactResets.set(root, contacts.reset);
  return contacts.apply;
};
