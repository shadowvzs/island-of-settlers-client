import { type Object3D, Vector3 } from "three";

import { createCradleCarry } from "./worker-cradle-carry";

const contactResets = new WeakMap<Object3D, () => void>();
export const resetFishHandContacts = (root: Object3D) => contactResets.get(root)?.();

/** A light fish rests across both forearms in front of the torso. */
export const placeCarriedFish = (fish: Object3D) => {
  fish.position.set(0, .68, .16);
  fish.quaternion.identity();
};

export const createFishHandContacts = (root: Object3D) => {
  const towardBody = new Vector3(), support = new Vector3(), cradle = new Vector3();
  let ware: Object3D;
  const contacts = createCradleCarry(root, {
    supportName: "fishSupport",
    prepare: load => {
      ware = load;
      return 5;
    },
    target: (target, sign, lift, carryOnly) => {
      target.set(sign * .12, -.025, 0);
      if (!carryOnly) {
        towardBody.copy(root.getWorldPosition(towardBody)); ware.worldToLocal(towardBody);
        towardBody.y = 0; towardBody.normalize();
        support.set(towardBody.x * .08 - towardBody.z * sign * .035, -.025,
          towardBody.z * .035 + towardBody.x * sign * .035);
        target.copy(support).lerp(cradle.set(sign * .12, -.025, 0), lift);
      }
    }
  });
  contactResets.set(root, contacts.reset);
  return contacts.apply;
};
