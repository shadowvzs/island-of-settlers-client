import { Quaternion, Vector3 } from "three";

import type { WorkerNation } from "../../../render-common/workers/worker-unit";

interface Parts { add(position: Vector3, size: Vector3, rotation?: Quaternion): void }
const UP = new Vector3(0, 1, 0);

/** Structural details remain below the walking deck and inside the already-screened pile envelope. */
export const addNationalBoatJetty = (
  parts: Parts, start: Vector3, end: Vector3, nation: WorkerNation, detailed: boolean
) => {
  const forward = end.clone().sub(start), length = forward.length();
  if (length < .2) return;
  forward.normalize();
  const right = new Vector3(forward.z, 0, -forward.x).normalize();
  const rotation = new Quaternion().setFromUnitVectors(new Vector3(0, 0, 1), forward);
  const at = (share: number, across: number, down: number) => start.clone().lerp(end, share)
    .addScaledVector(right, across).addScaledVector(UP, -down);
  const beam = (from: Vector3, to: Vector3, thickness: number) => {
    const direction = to.clone().sub(from), alignment = new Quaternion()
      .setFromUnitVectors(new Vector3(0, 0, 1), direction.clone().normalize());
    parts.add(from.add(to).multiplyScalar(.5), new Vector3(thickness, thickness, direction.length()), alignment);
  };
  if (nation === "roman") {
    for (const share of [.24, .90]) {
      parts.add(at(share, 0, .13), new Vector3(.59, .075, .12), rotation);
      for (const side of [-1, 1])
        parts.add(at(share, side * .265, .19), new Vector3(.10, .08, .12), rotation);
    }
    return;
  }
  if (nation === "viking") {
    for (const side of [-1, 1]) {
      beam(at(.24, side * .26, .10), at(.48, side * .26, .36), .045);
      beam(at(.48, side * .26, .36), at(.72, side * .26, .10), .045);
      if (detailed) beam(at(.24, side * .26, .36), at(.72, side * .26, .10), .035);
    }
    return;
  }
  if (nation === "nubian") {
    for (const share of [.24, .90]) for (const side of [-1, 1]) {
      parts.add(at(share, side * .265, .19), new Vector3(.045, .32, .13), rotation);
      for (const drop of [.12, .22])
        parts.add(at(share, side * .265, drop), new Vector3(.09, .025, .15), rotation);
    }
    return;
  }
  for (const share of [.24, .90]) {
    parts.add(at(share, 0, .12), new Vector3(.59, .055, .12), rotation);
    parts.add(at(share, 0, .21), new Vector3(.54, .045, .09), rotation);
    for (const side of [-1, 1])
      beam(at(share, side * .26, .30), at(share, side * .10, .12), .035);
  }
};
