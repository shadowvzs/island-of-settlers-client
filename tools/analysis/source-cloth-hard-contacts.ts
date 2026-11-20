import { Vector3 } from "three";

import type { DonorRayConstraint, DonorRayCorner } from "./source-cloth-donor-ray-fit";
import type { HardClothState } from "./source-cloth-hard-state";
import { closestClothRayTriangle } from "./source-cloth-ray-triangle";

interface HardContact {
  bary: number[];
  corners: DonorRayCorner[];
  distanceSquared: number;
  face: number;
}

/** A sub-unit continuous correction may quantize to no change. Examine only the twelve exact
 * one-unit simplex transfers per active group; choose a strictly improving hard plane step.
 */
const integerStep = (state: HardClothState, gradients: Map<number, number[]>, constraint: DonorRayConstraint,
  selectedFace: number) => {
  let best = contact(constraint, state, selectedFace).distanceSquared;
  let selected: { group: number; weights: number[] } | undefined;
  for (const group of gradients.keys()) {
    const current = state.weights.slice(group * 4, group * 4 + 4);
    for (let from = 0; from < 4; from++) for (let to = 0; to < 4; to++) {
      if (from === to || current[from]! < 1 / 65535) continue;
      const proposed = current.map((value, slot) => value + (Number(slot === to) - Number(slot === from)) / 65535);
      const fitted = state.preview(group, proposed);
      const next = contact(constraint, state, selectedFace, { group, weights: fitted }).distanceSquared;
      if (next >= best) continue;
      best = next; selected = { group, weights: fitted };
    }
  }
  return selected ? Number(state.commit(selected.group, selected.weights)) : 0;
};

const contact = (constraint: DonorRayConstraint, state: HardClothState, preferred = 0,
  override?: { group: number; weights: number[] }): HardContact => {
  const faces = [constraint.corners, ...constraint.alternatives ?? []];
  const test = (face: number) => ({
    ...closestClothRayTriangle(constraint.origin, constraint.direction, constraint.length,
      faces[face]!.map(corner => corner.group === override?.group
        ? corner.basis!.reduce((sum, point, slot) => sum.addScaledVector(point, override.weights[slot]!), new Vector3())
        : state.point(corner)), .00001), corners: faces[face]!, face,
  });
  let best = test(preferred);
  if (best.distanceSquared === 0) return best;
  for (let face = 0; face < faces.length; face++) {
    if (face === preferred) continue;
    const candidate = test(face);
    if (candidate.distanceSquared >= best.distanceSquared) continue;
    best = candidate;
    if (best.distanceSquared === 0) break;
  }
  return best;
};

/** One linearized hard ray-plane projection; the source-face barycentric contact is updated
 * again before the next constraint. No weighted target/preservation compromise is accepted.
 */
const project = (constraint: DonorRayConstraint, selected: HardContact, state: HardClothState) => {
  const reference = Math.abs(constraint.direction.x) < .8 ? new Vector3(1, 0, 0) : new Vector3(0, 1, 0);
  const first = new Vector3().crossVectors(constraint.direction, reference).normalize();
  const second = new Vector3().crossVectors(constraint.direction, first).normalize();
  let changed = 0, blocked = 0;
  for (const [axis, normal] of [first, second, constraint.direction].entries()) {
    const position = selected.corners.reduce((sum, corner, at) =>
      sum.addScaledVector(state.point(corner), selected.bary[at]!), new Vector3()).sub(constraint.origin);
    const coordinate = position.dot(normal);
    const residual = axis === 2 ? coordinate - Math.max(0, Math.min(constraint.length, coordinate)) : coordinate;
    if (Math.abs(residual) < 1e-15) continue;
    const gradients = new Map<number, number[]>();
    for (const [at, corner] of selected.corners.entries()) if (corner.group >= 0) {
      const gradient = gradients.get(corner.group) ?? [0, 0, 0, 0];
      for (let slot = 0; slot < 4; slot++)
        gradient[slot]! += selected.bary[at]! * corner.basis![slot]!.dot(normal);
      gradients.set(corner.group, gradient);
    }
    let normSquared = 0;
    for (const gradient of gradients.values()) {
      const mean = gradient.reduce((sum, value) => sum + value, 0) / 4;
      for (let slot = 0; slot < 4; slot++) {
        gradient[slot]! -= mean;
        normSquared += gradient[slot]! ** 2;
      }
    }
    if (normSquared < 1e-22) { blocked++; continue; }
    let axisChanges = 0;
    for (const [group, gradient] of gradients) {
      const proposed = gradient.map((value, slot) => state.weights[group * 4 + slot]! - residual * value / normSquared);
      axisChanges += Number(state.update(group, proposed));
    }
    if (!axisChanges) axisChanges += integerStep(state, gradients, constraint, selected.face);
    changed += axisChanges;
  }
  return { blocked, changed };
};

/** Bounded local feasibility control. Every pass evaluates exact loaded integer weights.
 * A stationary point or repeated projection state is NOT proof of global infeasibility.
 */
export const solveHardClothContacts = (state: HardClothState, constraints: DonorRayConstraint[], limit: number,
  progress: (report: unknown) => void = () => {}) => {
  const preferred = constraints.map(() => 0);
  const evaluate = () => {
    const contacts = constraints.map((constraint, at) => {
      const selected = contact(constraint, state, preferred[at]);
      preferred[at] = selected.face;
      return { ...selected, constraint: at, target: !!constraint.target };
    });
    const violations = contacts.filter(selected => selected.distanceSquared !== 0);
    return { contacts, violations, summary: {
      targetFailures: violations.filter(selected => selected.target).length,
      preservationFailures: violations.filter(selected => !selected.target).length,
      maximumDistance: Math.sqrt(Math.max(...contacts.map(selected => selected.distanceSquared))),
      targets: contacts.filter(selected => selected.target).map(selected => ({
        constraint: selected.constraint, face: selected.face, distance: Math.sqrt(selected.distanceSquared),
      })),
    } };
  };
  const history = [];
  let current = evaluate(), reason = "pass-limit", passes = 0;
  const seen = new Set<string>();
  progress({ pass: 0, ...current.summary });
  for (; passes < limit; passes++) {
    if (!current.violations.length) { reason = "all-hard-contacts-intersect"; break; }
    const key = state.weights.join();
    if (seen.has(key)) { reason = "repeated-integer-projection-state"; break; }
    seen.add(key);
    const active = [...current.violations].sort((a, b) =>
      Number(a.target) - Number(b.target) || b.distanceSquared - a.distanceSquared || a.constraint - b.constraint);
    let changes = 0, blocked = 0;
    for (const previous of active) {
      const constraint = constraints[previous.constraint]!;
      const selected = contact(constraint, state, preferred[previous.constraint]);
      preferred[previous.constraint] = selected.face;
      if (selected.distanceSquared === 0) continue;
      const result = project(constraint, selected, state);
      changes += result.changed; blocked += result.blocked;
    }
    current = evaluate();
    const report = { pass: passes + 1, changes, blocked, ...current.summary };
    history.push(report); progress(report);
    if (!changes) { reason = "integer-projection-stationary"; break; }
  }
  if (!current.violations.length) reason = "all-hard-contacts-intersect";
  return { allHardContactsSatisfied: !current.violations.length, history, passes, reason,
    ...current.summary, motion: state.motionReport(), weights: [...state.weights] };
};
