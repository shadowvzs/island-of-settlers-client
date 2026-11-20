import { roadDecorationAdder, type RoadDecorationPart } from "./road-decoration-recipe";

type Point = [number, number, number];
const BARK: Point = [.48, .34, .20];

/** Tapered limbs overlap at their connected joints instead of floating beside the pergola. */
export const wisteriaLimb = (parts: RoadDecorationPart[], from: Point, to: Point,
  base: number, tip: number, detailed: boolean) => {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const length = Math.hypot(dx, dy, dz);
  if (length < 1e-8) return;
  roadDecorationAdder(parts)({ shape: base <= .03 ? "cord" : "cylinder", position: [
    (from[0] + to[0]) / 2, (from[1] + to[1]) / 2, (from[2] + to[2]) / 2],
  size: [base, length + .012, base], topScale: [tip / base, 1, tip / base],
  rotation: [Math.acos(Math.max(-1, Math.min(1, dy / length))), Math.atan2(dx, dz), 0],
  radialSegments: detailed ? 6 : 4, surface: "bark", tint: BARK });
};

/** Visible root flare -> old twining trunk -> connected upper branch. Low growth stays outside traffic. */
export const addWisteriaClimber = (parts: RoadDecorationPart[], side: number, post: number,
  height: number, detailed: boolean) => {
  const collar: Point = [side * (post + .025), .16, .12];
  const roots = detailed ? 4 : 3;
  for (let root = 0; root < roots; root++) {
    const angle = -.6 + root / (roots - 1) * 3.5;
    const foot: Point = [side * (post + .025) + Math.cos(angle) * .12, .026,
      .12 + Math.sin(angle) * .11];
    roadDecorationAdder(parts)({ shape: "cylinder", position: [foot[0], .015, foot[2]],
      size: [.075, .03, .075], topScale: [.65, 1, .65], radialSegments: detailed ? 6 : 4,
      surface: "bark", tint: BARK });
    wisteriaLimb(parts, foot, collar, .05, .078, detailed);
  }
  const segments = detailed ? 12 : 8;
  let previous = collar;
  for (let segment = 1; segment <= segments; segment++) {
    const t = segment / segments, angle = t * Math.PI * 4 + .3;
    const point: Point = [side * post + Math.sin(angle) * .12,
      .16 + (height - .16) * t, Math.cos(angle) * .13];
    wisteriaLimb(parts, previous, point, .09 - t * .045, .085 - t * .045, detailed);
    previous = point;
  }
  const crown: Point = [side * post, height + .07, -.25];
  wisteriaLimb(parts, previous, crown, .04, .027, detailed);
  return crown;
};
