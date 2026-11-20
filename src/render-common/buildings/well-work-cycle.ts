import { buildingRules } from "@shared/catalog/building-data/rules";

import { DMath } from "../../shared/math/deterministic-math";
import { BuildingType } from "../../shared/settlement/building-type-ids";
import type { Point3 } from "./building-recipe";

/** One draw cycle: the Well's production seconds (rules sidecar), shared by the worker and the windlass. */
export const WELL_CYCLE_SECONDS = buildingRules(BuildingType.Well)!.production!.seconds;
/** Hand contact has reached the bucket before its transfer away from the draw chain. */
export const WELL_BUCKET_HANDOFF = .3;

export interface WellWorkFrame {
  style?: "hand-rope";
  elapsed: number;
  crank: { x: number; y: number; z: number };
  rotation: number;
  scale: number;
}

/** One shared lowering, filling and raising sequence drives the worker and the windlass. */
export const sampleWellWorkCycle = (elapsed: number, holdRaised = false) => {
  const phase = holdRaised ? WELL_CYCLE_SECONDS :
    ((elapsed % WELL_CYCLE_SECONDS) + WELL_CYCLE_SECONDS) % WELL_CYCLE_SECONDS;
  let angle = 0, height = -0.24;
  if (phase >= 1 && phase < 2) {
    angle = -(phase - 1) * Math.PI * 2;
    height -= (phase - 1) * 0.45;
  } else if (phase >= 2 && phase < 12) {
    angle = -Math.PI * 2;
    height = -0.69;
  } else if (phase >= 12 && phase < 13) {
    angle = -Math.PI * 2 + (phase - 12) * Math.PI * 2;
    height = -0.69 + (phase - 12) * 0.45;
  }
  return { angle, height, filled: phase >= 12, phase };
};

/** Grip on the real rotating crank handle, after the assembly turn and placed building yaw. */
export const wellCrankHandTarget = (frame: WellWorkFrame): Point3 => {
  const { angle } = sampleWellWorkCycle(frame.elapsed);
  const across = DMath.sin(angle) * 0.18 * frame.scale;
  const height = DMath.cos(angle) * 0.18 * frame.scale;
  const cosine = DMath.cos(frame.rotation), sine = DMath.sin(frame.rotation);
  return [
    frame.crank.x + across * cosine + 0.105 * frame.scale * sine,
    frame.crank.y + height,
    frame.crank.z - across * sine + 0.105 * frame.scale * cosine
  ];
};

/** Hand-hauled well keeps the same 14 seconds, with a bucket that actually enters the earth shaft. */
export const sampleHandWellWorkCycle = (elapsed: number, holdRaised = false) => {
  const phase = holdRaised ? WELL_CYCLE_SECONDS :
    ((elapsed % WELL_CYCLE_SECONDS) + WELL_CYCLE_SECONDS) % WELL_CYCLE_SECONDS;
  let x = 0, z = -.06, height = -.24;
  if (phase < 1) {
    const lift = phase * phase * (3 - 2 * phase);
    x = -.4 * (1 - lift); z = .22 - .28 * lift;
    height = -.786 + .546 * lift;
  } else if (phase < 2) height -= (phase - 1) * .96;
  else if (phase < 12) height = -1.2;
  else if (phase < 13) height = -1.2 + (phase - 12) * .96;
  const active = phase < 2 || phase >= 12 && phase < 13;
  const pull = active ? DMath.sin(phase * Math.PI * 4) : .3;
  const left = .115 + pull * .075, right = .115 - pull * .075;
  return { phase, x, z, height, filled: phase >= 12, left, right };
};

/** Both hands slide along the same taut rope; no target or hidden windlass remains at the old crank. */
export const wellRopeHandTargets = (frame: WellWorkFrame): readonly [Point3, Point3] => {
  const sample = sampleHandWellWorkCycle(frame.elapsed, frame.elapsed >= WELL_CYCLE_SECONDS);
  const top = Math.max(sample.left, sample.right) + .012;
  const length = Math.max(.05, top - sample.height - .15);
  const cosine = DMath.cos(frame.rotation), sine = DMath.sin(frame.rotation);
  return [sample.left, sample.right].map((height, index): Point3 => {
    const down = (top - height) / length;
    const x = -.04 + (sample.z + .10) * down + (index ? .012 : -.012);
    const z = .23 + (-sample.x - .23) * down;
    return [frame.crank.x + (x * cosine + z * sine) * frame.scale,
      frame.crank.y + height * frame.scale,
      frame.crank.z + (-x * sine + z * cosine) * frame.scale];
  }) as unknown as readonly [Point3, Point3];
};
