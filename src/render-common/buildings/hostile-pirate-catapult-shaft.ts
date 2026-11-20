import type { BuildingPart, BuildingSurface, Point3 } from "./building-recipe";
import { CATAPULT_SHAFT_HEIGHT } from "./catapult-dimensions";
import { eulerFromRotation, rotationFromUpForward } from "./recipe-rotation";

type Point = readonly [number, number];
const HEIGHT = CATAPULT_SHAFT_HEIGHT;
/** Shipwright construction: a battered, eight-faced clinker shell with a roomy square stairwell. */
const outline = (y: number): Point[] => {
  const half = .81 - .07 * y / HEIGHT, cut = .25;
  // The original NW hatch pocket must stay square and clear over its uppermost .70m.
  const pocket = Math.max(0, Math.min(1, (y - (HEIGHT - .90)) / .20));
  const northwest = cut - .20 * pocket;
  return [[half - cut, half], [-half + cut, half], [-half, half - cut],
    [-half, -half + northwest], [-half + northwest, -half],
    [half - cut, -half], [half, -half + cut], [half, half - cut]];
};

export const createPirateCatapultShaft = (detailed: boolean): BuildingPart[] => {
  const parts: BuildingPart[] = [];
  const face = (
    a: Point, b: Point, y: number, height: number, surface: BuildingSurface, thickness: number,
    outward = 0, tint?: Point3
  ) => {
    const dx = b[0] - a[0], dz = b[1] - a[1], length = Math.hypot(dx, dz);
    const nx = -dz / length, nz = dx / length;
    const inset = thickness / 2 - outward;
    parts.push({ shape: "box", surface, stage: 2, tint, worldUv: 1,
      position: [(a[0] + b[0]) / 2 + nx * inset, y, (a[1] + b[1]) / 2 + nz * inset],
      // Local Y is the long board axis, so the existing longitudinal wood grain follows the plank.
      size: [height, length + .002, thickness],
      rotation: eulerFromRotation(rotationFromUpForward([dx, 0, dz], [-dz, 0, dx])) });
  };
  const row = (bottom: number, top: number, surface: BuildingSurface, thickness: number, outward = 0) => {
    const y = (bottom + top) / 2, points = outline(y);
    const painted = bottom < .44 || (bottom >= 1.06 && bottom < 1.26);
    const tint: Point3 = painted && surface === "wood" ? [.22, .64, .65] : [1, 1, 1];
    const finish = painted && surface === "wood" ? "paint" : surface;
    for (let edge = 0; edge < points.length; edge++) {
      const a = points[edge]!, b = points[(edge + 1) % points.length]!;
      if (edge === 0 && bottom < .86) {
        face(a, [.28, a[1]], y, top - bottom, finish, thickness, outward, tint);
        face([-.28, a[1]], b, y, top - bottom, finish, thickness, outward, tint);
      } else face(a, b, y, top - bottom, finish, thickness, outward, tint);
    }
  };
  // The old square floor protruded as four pale corner blocks beyond the clipped hull.
  // An inscribed floor still supports the complete old stair room and doorway threshold.
  parts.push({ shape: "cylinder", surface: "planks", stage: 2, radialSegments: 16,
    position: [0, .06, 0], size: [1.60, .12, 1.60] });
  const levels = [0, .12, .28, .44, .60, .76, .86, 1.06, 1.26, 1.46, 1.66, 1.86, 2.06, 2.26, HEIGHT];
  for (let index = 1; index < levels.length; index++) row(levels[index - 1]!, levels[index]!, "wood", .10);
  for (const y of [.18, 1.28, HEIGHT - .10]) row(y - .025, y + .025, "iron", .025, .025);

  const bottom = outline(0), top = outline(HEIGHT);
  for (let index = 0; index < bottom.length; index++) {
    const from = bottom[index]!, to = top[index]!, dx = (to[0] - from[0]) * .95;
    const dz = (to[1] - from[1]) * .95;
    parts.push({ shape: "cylinder", surface: "wood", stage: 2, worldUv: 1,
      radialSegments: detailed ? 8 : 5, tint: [.43, .39, .31],
      position: [(from[0] + to[0]) * .475, HEIGHT / 2, (from[1] + to[1]) * .475],
      size: [.085, Math.hypot(HEIGHT, dx, dz), .085],
      rotation: eulerFromRotation(rotationFromUpForward([dx, HEIGHT, dz], [0, 0, 1])) });
  }
  return parts;
};
