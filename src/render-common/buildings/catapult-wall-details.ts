import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, Point3 } from "./building-recipe";
import { CATAPULT_SHAFT_HEIGHT } from "./catapult-dimensions";
import { ornamentOffset, ornamentSize } from "./viking-ornament-boxes";

export interface CatapultIvyLeaf { angle: number; bearing: Point3; center: Point3; length: number; roll: number }
export interface CatapultIvyStem { from: Point3; radius: number; to: Point3 }

/** Fifteen independent climbers spread across three facades; every blade has a real petiole. */
export const catapultIvyGrowth = (detailed: boolean) => {
  const leaves: CatapultIvyLeaf[] = [], stems: CatapultIvyStem[] = [];
  const columns = detailed ? 5 : 3, rows = detailed ? 7 : 3;
  for (let face = 0; face < 3; face++) {
    const angle = Math.PI * .5 * (face + 1), nx = DMath.sin(angle), nz = DMath.cos(angle);
    const point = (along: number, y: number, out: number): Point3 =>
      [nx * (.745 + out) + nz * along, y, nz * (.745 + out) - nx * along];
    for (let column = 0; column < columns; column++) {
      const seed = face * 7 + column * 2.3, root = -.49 + column / (columns - 1) * .98;
      // Side windows retain a broad, physically empty margin above the shorter central climbers.
      const top = face !== 1 && Math.abs(root) < .40 ? 1.52 : 2.16;
      let previous = point(root, 0, .018);
      for (let row = 1; row <= rows; row++) {
        const y = row / rows * top + DMath.sin(seed + row * .77) * .09;
        const sway = DMath.sin(row * 1.15 + seed) * .065;
        const along = root + sway, depth = .022 + (1 + DMath.sin(row * .8 + seed)) * .008;
        const current = point(along, y, depth);
        stems.push({ from: previous, radius: (detailed ? .008 : .007) * (1 - row / rows * .46), to: current });
        for (const side of [-1, 1]) {
          const length = .17 + (1 + DMath.sin(seed + row * 2 + side)) * .016;
          const roll = side * (.12 + (1 + DMath.sin(seed + row * 1.3 + side)) * .46);
          const leafAngle = angle + DMath.sin(seed + row * 1.17 + side) * .15;
          const center = point(along + side * (.035 + (1 + DMath.sin(seed + row * 2.1 + side)) * .023),
            y - .035 + DMath.sin(seed + row + side * 2) * .065, .042 + (1 + DMath.sin(seed + row + side)) * .008);
          const tangent = .29 * length * DMath.sin(roll), relief = .018 * length;
          const tx = DMath.cos(leafAngle), tz = -DMath.sin(leafAngle);
          const tip: Point3 = [center[0] + tangent * tx + relief * DMath.sin(leafAngle),
            center[1] - .29 * length * DMath.cos(roll), center[2] + tangent * tz + relief * DMath.cos(leafAngle)];
          const elbow = point(along + side * .026, y - .027, depth + .012);
          stems.push(...(detailed ? [{ from: current, radius: .0027, to: elbow },
            { from: elbow, radius: .002, to: tip }] : [{ from: current, radius: .0028, to: tip }]));
          leaves.push({ angle: leafAngle, bearing: tip, center, length, roll });
        }
        previous = current;
      }
    }
  }
  return { leaves, stems };
};

/** Existing original Viking plank/rim/boss sculpture; two pegs bond each shield to the curved shaft. */
const vikingWallShields = (): BuildingPart[] => {
  const parts: BuildingPart[] = [], scale = .46;
  for (const side of [-1, 1]) {
    const yaw = side * Math.PI / 2, back = .838;
    const offset = ornamentOffset("round-shield", [0, 0, -.03], scale);
    parts.push({ architecture: true, position: [side * (back - offset[2]), 1.24, 0],
      rotation: [0, yaw, side * .09], shape: "round-shield", size: ornamentSize("round-shield", scale),
      stage: 4, surface: "paint", wallMountedDecoration: true });
    for (const z of [-.14, .14]) parts.push({ architecture: true,
      position: [side * .815, 1.24, z], shape: "box", size: [.065, .055, .045],
      stage: 4, surface: "wood", wallMountedDecoration: true });
  }
  return parts;
};

export const catapultWallDetails = (nation: string): BuildingPart[] => {
  if (nation === "viking") return vikingWallShields();
  if (nation !== "roman") return [];
  return [{ architecture: true, position: [0, CATAPULT_SHAFT_HEIGHT / 2, 0],
    shape: "catapult-wall-ivy", size: [1.7, CATAPULT_SHAFT_HEIGHT, 1.7], stage: 4, surface: "leaf" }];
};
