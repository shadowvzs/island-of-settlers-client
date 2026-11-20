import { Bone, type Object3D, Quaternion, Vector3 } from "three";
import type { WorkerFrame } from "../../render-common/workers/worker-unit";
import { createBoatWorkerPose } from "./settlement/boat-worker-pose";
import type { ThreeWorkerPack } from "@workers/game-three-worker";

type Worker = Awaited<ReturnType<ThreeWorkerPack["load"]>>;

/** Blend the same land skeleton into the same seat/leg/hand solve used by the afloat rower. */
export const createFisherBoarding = (worker: Worker) => {
  const body = worker.root;
  let seated: ReturnType<typeof createBoatWorkerPose> | undefined;
  let restorePosition: Vector3 | undefined;
  const bones: Object3D[] = [];
  body.traverse(object => { if (object instanceof Bone) bones.push(object); });
  const reset = () => { if (restorePosition) { body.position.copy(restorePosition); restorePosition = undefined; } };
  const apply = (frame: WorkerFrame) => {
    const boarding = frame.fisherBoatBoarding;
    if (!boarding || boarding.progress <= 0 || !body.parent) return;
    seated ??= createBoatWorkerPose(body, worker.clips);
    const beforePosition = body.position.clone(), beforeRotation = body.quaternion.clone();
    const before = bones.map(bone => ({ position: bone.position.clone(), rotation: bone.quaternion.clone(),
      scale: bone.scale.clone() }));
    const parent = body.parent;
    parent.updateWorldMatrix(true, false);
    const seat = parent.worldToLocal(new Vector3(boarding.seat.x, boarding.seat.y, boarding.seat.z));
    const parentRotation = parent.getWorldQuaternion(new Quaternion()).invert();
    const grips = boarding.grips.map(grip => ({
      point: parent.worldToLocal(new Vector3(grip.point.x, grip.point.y, grip.point.z)),
      axis: new Vector3(grip.axis.x, grip.axis.y, grip.axis.z).applyQuaternion(parentRotation)
    }));
    seated.update({ seat, facing: boarding.facing, grips, fisherMotion: true, time: 0 });
    const amount = boarding.progress;
    body.position.lerpVectors(beforePosition, body.position, amount);
    body.quaternion.copy(beforeRotation.slerp(body.quaternion, amount));
    bones.forEach((bone, index) => {
      const start = before[index]!;
      bone.position.lerpVectors(start.position, bone.position, amount);
      bone.quaternion.copy(start.rotation.slerp(bone.quaternion, amount));
      bone.scale.lerpVectors(start.scale, bone.scale, amount);
    });
    restorePosition = beforePosition;
    body.updateMatrixWorld(true);
  };
  return { apply, reset };
};
