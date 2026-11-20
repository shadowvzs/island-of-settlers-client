import { CATAPULT_DECK_HEIGHT } from "./catapult-dimensions";

/** Approved clear opening: a thin hardwood throat over a relieved joist well. All geometry is model-space. */
export const CATAPULT_HATCH_WELL = Object.freeze({
  top: .43, lower: .43, depth: .16, throat: .008, chamfer: .01,
  center: [-.38, CATAPULT_DECK_HEIGHT, -.38] as const,
  upHeading: .731292956585624, downHeading: 3.872885610175417
});
/** Shared world-space manoeuvres measured on all96 civilian bodies/qualities, including the40cm rock. */
export const CATAPULT_STAIR_MANEUVER_KNOTS = {
  up: [[0, 0, 0], [0.62, -0.09380351821782325, -0.1251298815662284], [0.685, -0.10659200187818246, -0.1251298815662284], [0.845, -0.10986362247604539, -0.1251298815662284], [0.9500000000000001, -0.10986362247604539, -0.12086229658274333], [1.245, 0.031678813247516716, 0.024725065138041548], [3.775, 0.11776247871952816, 0.11179939587696883]] as const,
  down: [[0, 0, 0], [3.775, 0.1381621059177667, 0.13057045023586172]] as const
} as const;
export const catapultStairManeuver = (heightBelowRoof: number, descending: boolean) => {
  const knots = descending ? CATAPULT_STAIR_MANEUVER_KNOTS.down : CATAPULT_STAIR_MANEUVER_KNOTS.up;
  const end = knots[knots.length - 1]!;
  let x: number = end[1], z: number = end[2];
  if (heightBelowRoof <= 0) { x = 0; z = 0; }
  else for (let index = 1; index < knots.length; index++) {
    const previous = knots[index - 1]!, next = knots[index]!;
    if (heightBelowRoof < previous[0] || heightBelowRoof > next[0]) continue;
    const t = Math.max(0, Math.min(1, (heightBelowRoof - previous[0]) / (next[0] - previous[0])));
    const smooth = t * t * (3 - 2 * t);
    x = previous[1] + (next[1] - previous[1]) * smooth;
    z = previous[2] + (next[2] - previous[2]) * smooth; break;
  }
  return { x, z, heading: descending ? CATAPULT_HATCH_WELL.downHeading : CATAPULT_HATCH_WELL.upHeading };
};
