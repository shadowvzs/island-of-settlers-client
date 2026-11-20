import { solveTwoBone } from "@workers/retarget/two-bone-ik";
import { type Object3D,Quaternion, Vector3 } from "three";

/**
 * Lower body of a fighting soldier (model units, the soldier's own frame: +z forward, +x left).
 * The feet stand in a staggered stance and stay planted; the hips carry the weight.
 */
export interface CombatBody {
  /** Hips forward (+) / back (-) over the feet: the weight shift into a blow. */
  shift: number;
  /** Hips lowered by bending the knees. */
  drop: number;
  /** Hips turned about the vertical (+ = towards the left). */
  hipYaw: number;
  /** Front (left) foot offset from its stance place along +z, and its lift while it travels. */
  step: number;
  lift: number;
  /** Stance: front foot forward / back foot back of their standing places and the width added. */
  stance: { back: number; front: number; width: number };
}

const UP = new Vector3(0, 1, 0);

/**
 * Sets the hips and solves both legs onto planted stance targets: the soldier steps into a
 * strike, shifts its weight and turns its hips while the feet do not slide.
 */
export const createWorkerCombatBody = (root: Object3D) => {
  const hips = root.getObjectByName("Hips");
  const legs = ["Left", "Right"].map(side => ({
    foot: root.getObjectByName(`${side}Foot`), knee: root.getObjectByName(`${side}Leg`),
    rotation: new Quaternion(), target: new Vector3(), thigh: root.getObjectByName(`${side}UpLeg`)
  }));
  const usable = hips?.parent && legs.every(leg => leg.thigh?.parent && leg.knee?.parent && leg.foot?.parent);
  const position = new Vector3(), offset = new Vector3(), pole = new Vector3();
  const rootRotation = new Quaternion(), turn = new Quaternion(), parent = new Quaternion();
  const world = new Quaternion(), kneeWorld = new Quaternion();
  const a = new Vector3(), b = new Vector3(), c = new Vector3();

  const placeFeet = (body: CombatBody) => {
    const { back, front, width } = body.stance;
    legs.forEach((leg, index) => {
      leg.foot!.getWorldPosition(leg.target);
      leg.foot!.getWorldQuaternion(leg.rotation);
      const leading = index === 0;
      const forward = leading ? front + body.step : -back;
      offset.set((leading ? 1 : -1) * width / 2, leading ? body.lift : 0, forward)
        .applyQuaternion(rootRotation).multiplyScalar(root.getWorldScale(position).x);
      leg.target.add(offset);
    });
  };

  const moveHips = (body: CombatBody) => {
    const scale = root.getWorldScale(position).x;
    hips!.getWorldPosition(position);
    offset.set(0, -body.drop, body.shift).applyQuaternion(rootRotation).multiplyScalar(scale);
    position.add(offset);
    hips!.parent!.worldToLocal(position);
    hips!.position.copy(position);
    // Turn about the world vertical, expressed in the hips' parent frame.
    hips!.getWorldQuaternion(world);
    world.premultiply(turn.setFromAxisAngle(UP, body.hipYaw));
    hips!.quaternion.copy(hips!.parent!.getWorldQuaternion(parent).invert().multiply(world));
  };

  const solveLeg = (leg: (typeof legs)[number]) => {
    pole.set(0, 0, 1).applyQuaternion(hips!.getWorldQuaternion(world));
    const solution = solveTwoBone({ end: leg.foot!.getWorldPosition(c), middle: leg.knee!.getWorldPosition(b),
      root: leg.thigh!.getWorldPosition(a) }, leg.target, pole);
    // Both deltas are world rotations of the pose before the solve (the knee's includes the hip's).
    leg.knee!.getWorldQuaternion(kneeWorld);
    leg.thigh!.getWorldQuaternion(world).premultiply(solution.rootDelta);
    leg.thigh!.quaternion.copy(leg.thigh!.parent!.getWorldQuaternion(parent).invert().multiply(world));
    kneeWorld.premultiply(solution.middleDelta);
    leg.knee!.quaternion.copy(leg.knee!.parent!.getWorldQuaternion(parent).invert().multiply(kneeWorld));
    // The sole stays as the clip had it, turned with the stance.
    leg.foot!.quaternion.copy(leg.foot!.parent!.getWorldQuaternion(parent).invert().multiply(leg.rotation));
  };

  const apply = (body: CombatBody) => {
    if (!usable) return;
    root.updateMatrixWorld(true);
    root.getWorldQuaternion(rootRotation);
    placeFeet(body);
    moveHips(body);
    for (const leg of legs) solveLeg(leg);
  };
  return { apply };
};
