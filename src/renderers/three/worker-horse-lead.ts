import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import {
  BufferAttribute,
  BufferGeometry,
  Mesh,
  MeshBasicMaterial,
  type Object3D,
  Quaternion,
  Vector3} from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";

/** A single cheap rope follows the posed palm socket, not an estimated shoulder position. */
export const createWorkerHorseLead = (root: Object3D) => {
  let upper = root.getObjectByName("RightArm"), lower = root.getObjectByName("RightForeArm"),
    hand = root.getObjectByName("RightHand"), socket = root.getObjectByName("socket_hand_R");
  const halterLocal = new Vector3();
  const savedUpper = new Quaternion(),
    savedLower = new Quaternion(),
    parent = new Quaternion();
  const upperWorld = new Quaternion(),
    lowerWorld = new Quaternion();
  const shoulder = new Vector3(),
    elbow = new Vector3(),
    end = new Vector3(),
    target = new Vector3(),
    pole = new Vector3();
  const start = new Vector3(),
    finish = new Vector3(),
    axis = new Vector3(),
    side = new Vector3(),
    up = new Vector3();
  let adjusted = false,
    rope: Mesh<BufferGeometry, MeshBasicMaterial> | undefined;
  const reset = () => {
    if (adjusted) {
      upper?.quaternion.copy(savedUpper);
      lower?.quaternion.copy(savedLower);
      adjusted = false;
    }
    if (rope) rope.visible = false;
  };
  const ensureRope = () => {
    if (rope) return rope;
    const geometry = new BufferGeometry(),
      indices: number[] = [];
    geometry.setAttribute("position", new BufferAttribute(new Float32Array(9 * 4 * 3), 3));
    for (let i = 0; i < 8; i++)
      for (let j = 0; j < 4; j++) {
        const a = i * 4 + j,
          b = i * 4 + ((j + 1) % 4),
          c = a + 4,
          d = b + 4;
        indices.push(a, c, b, b, c, d);
      }
    geometry.setIndex(indices);
    rope = new Mesh(geometry, new MeshBasicMaterial({ color: 0x51331e }));
    rope.name = "horse_lead_rope";
    rope.frustumCulled = false;
    rope.visible = false;
    root.add(rope);
    return rope;
  };
  const apply = (frame: WorkerFrame) => {
    const halter = frame.horseLead?.target;
    if (!halter) return;
    root.updateMatrixWorld(true);
    halterLocal.set(halter.x, halter.y, halter.z); root.worldToLocal(halterLocal);
    // Use the hand beside the animal: a fixed right-hand lead can cross the carrier's back
    // when the horse follows on the other side after a turn or a rotated stall exit.
    const left = halterLocal.x > 0, sideName = left ? "Left" : "Right";
    upper = root.getObjectByName(`${sideName}Arm`); lower = root.getObjectByName(`${sideName}ForeArm`);
    hand = root.getObjectByName(`${sideName}Hand`); socket = root.getObjectByName(`socket_hand_${left ? "L" : "R"}`);
    if (!upper?.parent || !lower?.parent || !hand || !socket) return;
    savedUpper.copy(upper.quaternion);
    savedLower.copy(lower.quaternion);
    adjusted = true;
    target.set(left ? .27 : -.27, .62, -.12);
    root.localToWorld(target);
    for (let pass = 0; pass < 4; pass++) {
      root.updateMatrixWorld(true);
      upper.getWorldQuaternion(upperWorld);
      lower.getWorldQuaternion(lowerWorld);
      pole.set(left ? .7 : -.7, -.6, -.2).applyQuaternion(root.getWorldQuaternion(parent));
      const solution = solveTwoBone(
        {
          root: upper.getWorldPosition(shoulder),
          middle: lower.getWorldPosition(elbow),
          end: hand.getWorldPosition(end)
        },
        target,
        pole
      );
      upper.quaternion.copy(
        upper.parent
          .getWorldQuaternion(parent)
          .invert()
          .multiply(solution.rootDelta.multiply(upperWorld))
      );
      root.updateMatrixWorld(true);
      lower.quaternion.copy(
        lower.parent
          .getWorldQuaternion(parent)
          .invert()
          .multiply(solution.middleDelta.multiply(lowerWorld))
      );
    }
    root.updateMatrixWorld(true);
    socket.getWorldPosition(start);
    finish.set(halter.x, halter.y, halter.z);
    const mesh = ensureRope(),
      positions = mesh.geometry.getAttribute("position") as BufferAttribute;
    axis.copy(finish).sub(start).normalize();
    side.set(0, 1, 0).cross(axis).normalize();
    if (side.lengthSq() < 0.001) side.set(1, 0, 0);
    up.copy(axis).cross(side).normalize();
    const point = new Vector3();
    for (let i = 0; i <= 8; i++)
      for (let j = 0; j < 4; j++) {
        const t = i / 8,
          angle = (j * Math.PI) / 2;
        point.copy(start).lerp(finish, t);
        point.y -= Math.sin(t * Math.PI) * 0.045;
        point
          .addScaledVector(side, Math.cos(angle) * 0.0105)
          .addScaledVector(up, Math.sin(angle) * 0.0105);
        root.worldToLocal(point);
        positions.setXYZ(i * 4 + j, point.x, point.y, point.z);
      }
    positions.needsUpdate = true;
    // MeshBasicMaterial needs no normals; keep the existing small buffer updates cheap.
    mesh.visible = true;
    mesh.userData.handSocket = start.toArray();
    mesh.userData.handSocketName = socket.name;
    mesh.userData.halterSocket = finish.toArray();
  };
  const dispose = () => {
    rope?.geometry.dispose();
    rope?.material.dispose();
    rope?.removeFromParent();
  };
  root.userData.disposeHorseLead = dispose;
  return { apply, reset, dispose };
};
