import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { type Object3D,Quaternion, Vector3 } from "three";

import type { WorkerFrame } from "../../render-common/workers/worker-unit";

const beats = [[0, 0], [.4, -1], [.554, 1], [.61, .9], [.82, -.12], [1, 0]] as const;
export const strikeBodyWeight = (time: number) => {
  const phase = ((time % 1.3) + 1.3) % 1.3 / 1.3;
  const next = beats.findIndex(([at]) => at >= phase);
  if (next <= 0) return 0;
  const [a, b] = [beats[next - 1]!, beats[next]!];
  const fraction = (phase - a[0]) / (b[0] - a[0]);
  const eased = fraction * fraction * (3 - 2 * fraction);
  return a[1] + (b[1] - a[1]) * eased;
};

/** Lowered working arcs: hand drop, forward spine bend and hip squat. */
const HULL_WORK = { bend: .24, drop: .44, squat: .09 };
const BUILDER_WORK = { bend: .2, drop: .3, squat: .06 };

/** Add weight to an authored hammer or pickaxe swing while retaining planted feet and the original grip. */
export const createWorkerStrikeBody = (root: Object3D) => {
  const spine = root.getObjectByName("Spine"), hips = root.getObjectByName("Hips");
  const spinePose = new Quaternion(), hipsPose = new Vector3();
  const arm = { upper: root.getObjectByName("RightArm"), lower: root.getObjectByName("RightForeArm"),
    hand: root.getObjectByName("RightHand"), target: new Vector3(), pole: new Vector3(),
    orientation: new Quaternion(), upperPose: new Quaternion(), lowerPose: new Quaternion(),
    handPose: new Quaternion() };
  const legs = ["Left", "Right"].map(side => ({
    upper: root.getObjectByName(`${side}UpLeg`), lower: root.getObjectByName(`${side}Leg`),
    foot: root.getObjectByName(`${side}Foot`), target: new Vector3(), orientation: new Quaternion(),
    upperPose: new Quaternion(), lowerPose: new Quaternion(), footPose: new Quaternion()
  }));
  const shoulder = new Vector3(), elbow = new Vector3(), end = new Vector3(), pole = new Vector3();
  const upperWorld = new Quaternion(), lowerWorld = new Quaternion(), parent = new Quaternion();
  const rotation = new Quaternion(), axisX = new Vector3(1, 0, 0), axisY = new Vector3(0, 1, 0);
  let adjusted = false;
  const reset = () => {
    if (!adjusted || !spine || !hips) return;
    spine.quaternion.copy(spinePose); hips.position.copy(hipsPose);
    arm.upper!.quaternion.copy(arm.upperPose); arm.lower!.quaternion.copy(arm.lowerPose);
    arm.hand!.quaternion.copy(arm.handPose);
    for (const leg of legs) {
      leg.upper!.quaternion.copy(leg.upperPose); leg.lower!.quaternion.copy(leg.lowerPose);
      leg.foot!.quaternion.copy(leg.footPose);
    }
    adjusted = false;
  };
  const apply = (frame: WorkerFrame) => {
    const hullWork = frame.workerJob === "Shipwright" && frame.shipHullWork;
    // Builders hammer the foundation and walls low in front of them, not the empty air above.
    let low: typeof HULL_WORK | null = null;
    if (hullWork) low = HULL_WORK;
    else if (frame.workerJob === "Builder") low = BUILDER_WORK;
    let strength = 0;
    if (frame.workerJob === "Builder" || hullWork) strength = 1;
    else if (frame.workerTool === "pickaxe" && ["Stonemason", "Miner"].includes(frame.workerJob ?? "")) strength = .8;
    if (!strength || frame.action !== "build_hammer" || !spine || !hips ||
      !arm.upper?.parent || !arm.lower?.parent || !arm.hand?.parent ||
      legs.some(leg => !leg.upper?.parent || !leg.lower?.parent || !leg.foot?.parent)) return;
    const weight = strikeBodyWeight(frame.animationTime) * strength;
    spinePose.copy(spine.quaternion); hipsPose.copy(hips.position); adjusted = true;
    root.updateMatrixWorld(true);
    arm.upperPose.copy(arm.upper.quaternion); arm.lowerPose.copy(arm.lower.quaternion);
    arm.handPose.copy(arm.hand.quaternion);
    arm.hand.getWorldPosition(arm.target); arm.hand.getWorldQuaternion(arm.orientation);
    // Hull planking and foundations are below the generic swing; lower its whole working arc.
    if (low) arm.target.y -= low.drop;
    arm.pole.copy(arm.lower.getWorldPosition(elbow)).sub(arm.upper.getWorldPosition(shoulder));
    for (const leg of legs) {
      leg.upperPose.copy(leg.upper!.quaternion); leg.lowerPose.copy(leg.lower!.quaternion);
      leg.footPose.copy(leg.foot!.quaternion);
      leg.foot!.getWorldPosition(leg.target); leg.foot!.getWorldQuaternion(leg.orientation);
    }
    spine.quaternion.multiply(rotation.setFromAxisAngle(axisX, .14 * weight + (low?.bend ?? 0)));
    spine.quaternion.multiply(rotation.setFromAxisAngle(axisY, -.075 * weight));
    hips.position.y -= .028 * Math.max(0, weight) + (low?.squat ?? 0);
    root.updateMatrixWorld(true);
    for (let pass = 0; pass < 3; pass++) {
      arm.upper.getWorldQuaternion(upperWorld); arm.lower.getWorldQuaternion(lowerWorld);
      const solution = solveTwoBone({ root: arm.upper.getWorldPosition(shoulder),
        middle: arm.lower.getWorldPosition(elbow), end: arm.hand.getWorldPosition(end) }, arm.target, arm.pole);
      arm.upper.quaternion.copy(arm.upper.parent.getWorldQuaternion(parent).invert()
        .multiply(solution.rootDelta.multiply(upperWorld)));
      root.updateMatrixWorld(true);
      arm.lower.quaternion.copy(arm.lower.parent.getWorldQuaternion(parent).invert()
        .multiply(solution.middleDelta.multiply(lowerWorld)));
      root.updateMatrixWorld(true);
    }
    arm.hand.quaternion.copy(arm.hand.parent.getWorldQuaternion(parent).invert().multiply(arm.orientation));
    for (const leg of legs) {
      const upper = leg.upper!, lower = leg.lower!, foot = leg.foot!;
      for (let pass = 0; pass < 2; pass++) {
        upper.getWorldQuaternion(upperWorld); lower.getWorldQuaternion(lowerWorld);
        pole.set(0, 0, 1).applyQuaternion(root.getWorldQuaternion(parent));
        const solution = solveTwoBone({ root: upper.getWorldPosition(shoulder),
          middle: lower.getWorldPosition(elbow), end: foot.getWorldPosition(end) }, leg.target, pole);
        upper.quaternion.copy(upper.parent!.getWorldQuaternion(parent).invert()
          .multiply(solution.rootDelta.multiply(upperWorld)));
        root.updateMatrixWorld(true);
        lower.quaternion.copy(lower.parent!.getWorldQuaternion(parent).invert()
          .multiply(solution.middleDelta.multiply(lowerWorld)));
        root.updateMatrixWorld(true);
      }
      foot.quaternion.copy(foot.parent!.getWorldQuaternion(parent).invert().multiply(leg.orientation));
    }
    root.updateMatrixWorld(true);
  };
  return { apply, reset };
};
