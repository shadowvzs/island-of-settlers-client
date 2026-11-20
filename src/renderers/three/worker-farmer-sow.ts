import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { InstancedMesh, MeshStandardMaterial, Object3D, Quaternion, SphereGeometry, Vector3 } from "three";

import { isFarmerJob } from "../../render-common/workers/worker-job-actions";
import { SOWING_CYCLE_SECONDS, SOWING_RELEASE_PHASE, sowingSeedPosition }
  from "../../render-common/workers/worker-sowing-seeds";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { smoothstep01 } from "../../shared/world/noise";

const seedGeometry = new SphereGeometry(.009, 5, 3);
const seedMaterial = new MeshStandardMaterial({ color: 0xba9651, roughness: 1 });

/** Original idle body and planted feet, with actual arms reaching to scoop and scatter seed. */
export const createFarmerSowing = (root: Object3D) => {
  const arms = ["Left", "Right"].map(side => ({
    side, upper: root.getObjectByName(`${side}Arm`), lower: root.getObjectByName(`${side}ForeArm`),
    hand: root.getObjectByName(`${side}Hand`), socket: root.getObjectByName(`socket_hand_${side[0]}`),
    upperPose: new Quaternion(), lowerPose: new Quaternion(), handPose: new Quaternion(), adjusted: false
  }));
  let seeds: InstancedMesh | undefined;
  let releaseCycle = -Infinity, lastAnimationTime = -Infinity;
  const releaseOrigin = new Vector3(), seedVelocity = new Vector3(), seedWorld = new Vector3();
  const localHand = new Vector3();
  const aim = new Vector3(), dummy = new Object3D(), target = new Vector3(), offset = new Vector3();
  const shoulder = new Vector3(), elbow = new Vector3(), end = new Vector3(), pole = new Vector3();
  const world = new Quaternion(), parent = new Quaternion(), upperWorld = new Quaternion();
  const lowerWorld = new Quaternion(), wrist = new Quaternion(), palmUp = new Quaternion();
  const scoop = new Vector3(.075, .74, .18), scatter = new Vector3(-.22, .74, .28);
  const rest = new Vector3(-.16, .72, .16), left = new Vector3(.14, .72, .18);
  palmUp.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
  const reset = (frame?: WorkerFrame) => {
    if (frame && (!isFarmerJob(frame.workerJob) || frame.fieldWork !== "sow" ||
        frame.action !== "idle_breathe")) {
      releaseCycle = -Infinity; lastAnimationTime = -Infinity;
    }
    if (seeds) seeds.visible = false;
    for (const arm of arms) {
      if (!arm.adjusted) continue;
      arm.upper?.quaternion.copy(arm.upperPose); arm.lower?.quaternion.copy(arm.lowerPose);
      arm.hand?.quaternion.copy(arm.handPose); arm.adjusted = false;
    }
  };
  const apply = (frame: WorkerFrame) => {
    if (!isFarmerJob(frame.workerJob) || frame.fieldWork !== "sow" ||
        frame.action !== "idle_breathe") {
      releaseCycle = -Infinity; lastAnimationTime = -Infinity;
      return;
    }
    if (frame.animationTime < lastAnimationTime) releaseCycle = -Infinity;
    lastAnimationTime = frame.animationTime;
    const phase = (frame.animationTime % SOWING_CYCLE_SECONDS) / SOWING_CYCLE_SECONDS;
    const throwWeight = smoothstep01((phase - .3) / .3), returnWeight = smoothstep01((phase - .68) / .3);
    for (const arm of arms) {
      const { hand, lower, socket, upper } = arm;
      if (!upper?.parent || !lower?.parent || !hand?.parent || !socket) continue;
      arm.upperPose.copy(upper.quaternion); arm.lowerPose.copy(lower.quaternion);
      arm.handPose.copy(hand.quaternion); arm.adjusted = true;
      target.copy(left);
      if (arm.side === "Right") {
        target.copy(rest).lerp(scoop, smoothstep01(phase / .18));
        target.lerp(scatter, throwWeight).lerp(rest, returnWeight);
      }
      root.updateMatrixWorld(true); root.localToWorld(target);
      wrist.copy(root.getWorldQuaternion(world)).multiply(palmUp);
      for (let pass = 0; pass < 5; pass++) {
        hand.quaternion.copy(hand.parent.getWorldQuaternion(parent).invert().multiply(wrist));
        root.updateMatrixWorld(true);
        offset.copy(socket.getWorldPosition(offset)).sub(hand.getWorldPosition(end));
        upper.getWorldQuaternion(upperWorld); lower.getWorldQuaternion(lowerWorld);
        pole.set(arm.side === "Left" ? -.5 : .5, -.8, -.3).applyQuaternion(root.getWorldQuaternion(world));
        const solution = solveTwoBone({ root: upper.getWorldPosition(shoulder),
          middle: lower.getWorldPosition(elbow), end: hand.getWorldPosition(end) }, aim.copy(target).sub(offset), pole);
        upper.quaternion.copy(upper.parent.getWorldQuaternion(parent).invert()
          .multiply(solution.rootDelta.multiply(upperWorld)));
        root.updateMatrixWorld(true);
        lower.quaternion.copy(lower.parent.getWorldQuaternion(parent).invert()
          .multiply(solution.middleDelta.multiply(lowerWorld)));
      }
      hand.quaternion.copy(hand.parent.getWorldQuaternion(parent).invert().multiply(wrist));
      root.updateMatrixWorld(true);
    }
    if (!seeds) {
      seeds = new InstancedMesh(seedGeometry, seedMaterial, 12);
      seeds.name = "farmer_sowing_seed"; seeds.frustumCulled = false; root.add(seeds);
    }
    seeds.visible = true;
    const cycle = Math.floor(frame.animationTime / SOWING_CYCLE_SECONDS);
    const rightHand = arms[1]!.socket, leftHand = arms[0]!.socket;
    if (phase >= SOWING_RELEASE_PHASE && cycle !== releaseCycle && rightHand) {
      rightHand.getWorldPosition(releaseOrigin);
      releaseCycle = cycle;
    }
    const holdingHand = phase > .3 && rightHand ? rightHand : leftHand;
    if (holdingHand) root.worldToLocal(holdingHand.getWorldPosition(localHand));
    for (let index = 0; index < 12; index++) {
      const age = (phase - SOWING_RELEASE_PHASE) * SOWING_CYCLE_SECONDS - index * .004;
      let visible = true;
      if (phase < SOWING_RELEASE_PHASE || age < 0) {
        dummy.position.copy(localHand).add(offset.set((index % 4 - 1.5) * .012,
          .012, Math.floor(index / 4) * .011));
      } else {
        seedVelocity.set((index % 4 - 1.5) * .12 - .16, .12 + index % 3 * .025,
          .50 + Math.floor(index / 4) * .06).applyQuaternion(root.getWorldQuaternion(world));
        const point = sowingSeedPosition(releaseOrigin, seedVelocity, age, frame.y);
        seedWorld.set(point.x, point.y, point.z); root.worldToLocal(seedWorld);
        dummy.position.copy(seedWorld); visible = point.visible;
      }
      dummy.scale.set(visible ? 1 : 0, visible ? .65 : 0, visible ? 1.5 : 0);
      dummy.rotation.set(index, index * .7 + age * 5, age * 8);
      dummy.updateMatrix(); seeds.setMatrixAt(index, dummy.matrix);
    }
    seeds.instanceMatrix.needsUpdate = true;
  };
  return { apply, reset };
};
