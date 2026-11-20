import type { Point3 } from "./building-recipe";
import { type Add, runBetween } from "./nation-kit-parts";

type RoofPoint = (u: number, v: number, lift?: number) => Point3;

/** Connected gable trusses carry the ridge; the original four post heads remain the bearing points. */
export const addIndigenousAwningFrame = (add: Add, point: RoofPoint, detailed: boolean,
  span = { u: .42, v: .42, drop: .045 }) => {
  const beam = (from: Point3, to: Point3, thickness = .025) =>
    runBetween(add, from, to, [thickness, thickness], { roofSupport: true, stage: 2, surface: "wood" });
  const foot = (u: number, v: number): Point3 => {
    const from = point(u, -span.v, -span.drop), to = point(u, span.v, -span.drop);
    const share = (v + span.v) / (span.v * 2);
    return [from[0] + (to[0] - from[0]) * share, from[1] + (to[1] - from[1]) * share,
      from[2] + (to[2] - from[2]) * share];
  };
  for (const side of [-1, 1]) beam(foot(side * span.u, -span.v), foot(side * span.u, span.v), .035);
  for (const v of [-span.v, 0, span.v]) {
    const left = foot(-span.u, v), right = foot(span.u, v), ridge = point(0, v, -.040);
    const centre: Point3 = [(left[0] + right[0]) / 2, (left[1] + right[1]) / 2,
      (left[2] + right[2]) / 2];
    beam(left, right, .035); beam(centre, ridge);
    beam(left, ridge); beam(right, ridge);
  }
  const segments = detailed ? 8 : 4;
  for (let segment = 0; segment < segments; segment++) beam(
    point(0, -span.v + span.v * 2 * segment / segments, -.040),
    point(0, -span.v + span.v * 2 * (segment + 1) / segments, -.040));
};
