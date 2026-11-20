import { type Object3D, Quaternion, Vector3 } from "three";

import { smoothstep01 } from "../../shared/world/noise";
import { type CradleTransfer,createCradleCarry } from "./worker-cradle-carry";
import { createPropSurfaceSampler } from "./worker-prop-surface";
import { tabletopGripTargets } from "./worker-tabletop-grips";

const resets = new WeakMap<Object3D, () => void>();
export const resetSoftLoadHandContacts = (root: Object3D) => resets.get(root)?.();

/** Grasp the real stock edge, then the reachable near surface of the forward-held soft bundle. */
export const createSoftLoadHandContacts = (root: Object3D) => {
  const surfaces = new WeakMap<Object3D, ReturnType<typeof createPropSurfaceSampler>>();
  const carryCache = new WeakMap<Object3D, { scale: Vector3; rotation: Quaternion; targets: (Vector3 | undefined)[] }>();
  const targets = [new Vector3(), new Vector3()], ready = [false, false];
  const arms = ["Left", "Right"].map(side => ({
    shoulder: root.getObjectByName(`${side}Arm`)!, hand: root.getObjectByName(`${side}Hand`)!,
    socket: root.getObjectByName(`socket_hand_${side === "Left" ? "L" : "R"}`)!
  }));
  const position = new Vector3(), direction = new Vector3(), up = new Vector3(0, 1, 0);
  const carry = new Vector3(), wanted = new Vector3(), wrist = new Vector3(), rotation = new Quaternion();
  let ware: Object3D, transfer: CradleTransfer, surface: ReturnType<typeof createPropSurfaceSampler>;
  let gripKey = "", previousProgress = -1;
  let stockGrips: readonly Vector3[] | undefined;
  const contacts = createCradleCarry(root, {
    supportName: "softLoadSupport",
    contactWeight: current => current.direction === "pickup" ? smoothstep01(current.progress / .3)
      : 1 - smoothstep01((current.progress - .74) / .22),
    wristLift: (current, lift) => current.ware === "leather" ? 1 : lift,
    prepare(load, current) {
      ware = load; transfer = current; ready.fill(false);
      surface = surfaces.get(load) ?? createPropSurfaceSampler(load); surfaces.set(load, surface);
      return 6;
    },
    target(target, sign, lift, carryOnly) {
      const index = sign === 1 ? 0 : 1;
      if (!ready[index]) {
        let cached = carryCache.get(ware);
        const matches = cached?.scale.equals(ware.scale) && cached.rotation.equals(ware.quaternion);
        if (carryOnly && cached && matches && cached.targets[index]) targets[index]!.copy(cached.targets[index]!);
        else {
          if (!carryOnly) {
            const stockKey = `${transfer.direction}:${transfer.ware}:${transfer.target.x}:${transfer.target.y}:${transfer.target.z}`;
            if (stockKey !== gripKey || transfer.progress < previousProgress) {
              root.getWorldPosition(direction).sub(position.set(transfer.target.x, transfer.target.y, transfer.target.z));
              direction.applyQuaternion(rotation.setFromAxisAngle(up, -(transfer.yaw ?? 0)));
              stockGrips = transfer.ware === "leather" ? tabletopGripTargets(ware, root, direction) : undefined;
              gripKey = stockKey;
            }
            previousProgress = transfer.progress;
          }
          // Choose the point nearest this palm's actual reach sphere, not an empty corner of a concave skin's box.
          const arm = arms[index]!;
          arm.shoulder.getWorldPosition(carry);
          carry.add(arm.socket.getWorldPosition(position).sub(arm.hand.getWorldPosition(wrist)));
          ware.worldToLocal(carry);
          const start = ware.userData.hideGripTargets?.[index] ?? stockGrips?.[index] ?? carry;
          wanted.copy(start).lerp(carry, Math.min(1, lift * 3));
          surface.closest(wanted, targets[index]!);
          if (carryOnly) {
            if (!cached || !matches) {
              cached = { scale: ware.scale.clone(), rotation: ware.quaternion.clone(), targets: [] };
              carryCache.set(ware, cached);
            }
            cached.targets[index] = targets[index]!.clone();
          }
        }
        ready[index] = true;
      }
      target.copy(targets[index]!);
    }
  });
  resets.set(root, contacts.reset);
  return contacts.apply;
};
