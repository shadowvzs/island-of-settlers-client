import { type Object3D, Quaternion, Vector3 } from "three";

import type { HandSurfaceSample } from "./mounted-axe-surface";

interface FingerFit {
  entries: { bone: Object3D; grip: Quaternion }[];
  axes: Vector3[];
  tip: Object3D;
  target: Vector3;
}

/** Blended webbing follows two fingers: validate/refine their combined pose, once at creation. */
export const refineCompositeAxeGrip = (hand: Object3D, fits: FingerFit[], samples: readonly HandSurfaceSample[],
  origin: Vector3, across: Vector3, radius: number) => {
  const entries = fits.flatMap(fit => fit.entries.map((entry, index) => {
    const axis = fit.axes[index]!, secondary = new Vector3(1, 0, 0).cross(axis);
    if (secondary.lengthSq() < .1) secondary.set(0, 1, 0).cross(axis);
    secondary.normalize();
    return { ...entry, axes: index === 0 ? [axis, secondary, new Vector3().crossVectors(axis, secondary)] : [axis],
      original: entry.bone.quaternion.clone() };
  }));
  for (const entry of entries) entry.bone.quaternion.copy(entry.grip);
  hand.updateMatrixWorld(true);
  const point = origin.clone(), rotation = new Quaternion(), saved = new Quaternion();
  const score = () => {
    let collision = 0;
    for (const { mesh, vertex } of samples) {
      hand.worldToLocal(mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld)).sub(origin);
      const depth = Math.max(0, radius + .003 - point.addScaledVector(across, -point.dot(across)).length());
      collision += depth * depth;
    }
    return collision * 400 + fits.reduce((sum, fit) =>
      sum + hand.worldToLocal(fit.tip.getWorldPosition(point)).distanceToSquared(fit.target), 0) * .1;
  };
  for (const step of [.2, .08, .03]) for (let pass = 0; pass < 3; pass++) for (const entry of entries) for (const [index, axis] of entry.axes.entries()) {
    saved.copy(entry.bone.quaternion);
    let best = score(), selected = 0;
    for (const sign of [-1, 1]) {
      entry.bone.quaternion.copy(saved).premultiply(rotation.setFromAxisAngle(axis, step * sign * (index ? .5 : 1)));
      hand.updateMatrixWorld(true);
      const candidate = score(); if (candidate < best) { best = candidate; selected = sign; }
    }
    entry.bone.quaternion.copy(saved).premultiply(rotation.setFromAxisAngle(axis, step * selected * (index ? .5 : 1)));
    hand.updateMatrixWorld(true);
  }
  let worst: { vertex: number; point: number[]; clearance: number } | undefined;
  const clearance = Math.min(...samples.map(({ mesh, vertex }) => {
    hand.worldToLocal(mesh.getVertexPosition(vertex, point).applyMatrix4(mesh.matrixWorld)).sub(origin);
    const clearance = point.addScaledVector(across, -point.dot(across)).length() - radius;
    if (!worst || clearance < worst.clearance) worst = { vertex, point: point.toArray(), clearance };
    return clearance;
  }));
  for (const entry of entries) { entry.grip.copy(entry.bone.quaternion); entry.bone.quaternion.copy(entry.original); }
  hand.updateMatrixWorld(true);
  return { clearance, worst };
};
