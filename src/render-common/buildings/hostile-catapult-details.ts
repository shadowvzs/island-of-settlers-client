import type { HostileCatapultVariant } from "../../shared/world/scenario-catapult";
import type { BuildingPart, BuildingSurface, Point3 } from "./building-recipe";
import { CATAPULT_SHAFT_HEIGHT } from "./catapult-dimensions";

/** Wall-bonded faction hardware stays outside the conserved room and below the working deck. */
export const hostileCatapultDetails = (variant: HostileCatapultVariant, detailed: boolean): BuildingPart[] => {
  const parts: BuildingPart[] = [];
  const box = (surface: BuildingSurface, position: Point3, size: Point3, tint?: Point3,
    rotation?: Point3, shape: BuildingPart["shape"] = "box") => {
    parts.push({ position, rotation, shape, size, stage: 2, surface, tint, worldUv: 1 });
  };
  if (variant === "bandit") {
    // Uneven bonded corner quoins and front upper braces, clear of the door and hatch pocket.
    const rows = detailed ? 6 : 3;
    for (const x of [-.65, .65]) for (const z of [-.65, .65]) for (let row = 0; row < rows; row++) {
      const height = .66 / rows, y = .12 + row * height;
      box("stone", [x, y, z], [.29, height * .94, .29],
        [.87 + row % 2 * .09, .88 + row % 2 * .07, .86], undefined, "bevel-box");
    }
    for (const sign of [-1, 1]) {
      box("wood", [sign * .31, 1.66, .735], [.075, .94, .07], undefined, [0, 0, sign * .62]);
      for (const y of [1.28, 2.02]) box("iron", [sign * .57, y, .781], [.065, .065, .025]);
    }
    // A recognisable bandit weapon badge: crossed supported hatchets, no generic occupation plaque.
    for (const sign of [-1, 1]) {
      box("wood", [sign * .035, 1.62, .785], [.035, .47, .035], undefined, [0, 0, sign * .65]);
      box("iron", [-sign * .12, 1.79, .788], [.16, .13, .035], undefined,
        [0, 0, sign * .65], "bevel-box");
      box("paint", [-sign * .18, 1.83, .79], [.027, .13, .038], [.72, .78, .81],
        [0, 0, sign * .65]);
    }
    return parts;
  }
  // Rope collars follow actual eight hull ribs; the southeast face leaves the entrance open.
  const corner: Point3[] = [[.56, 0, .74], [-.56, 0, .74], [-.74, 0, .56],
    [.74, 0, .56], [.56, 0, -.74], [-.74, 0, -.56], [.74, 0, -.56]];
  for (const [x, , z] of corner) for (const y of [.54, 2.10]) {
    const taper = 1 - .07 * y / CATAPULT_SHAFT_HEIGHT / .81;
    parts.push({ shape: "cylinder", surface: "rope", stage: 2, radialSegments: detailed ? 8 : 5,
      position: [x * taper, y, z * taper], size: [.11, .065, .11], worldUv: 1 });
  }
  // Fitted dark sailcloth pennant, ivory skull and crossed bones sit on the front planking.
  box("cloth", [0, 1.75, .766], [.38, .51, .016]);
  box("paint", [0, 1.83, .785], [.13, .15, .035], [1, .91, .71], undefined, "sphere");
  box("paint", [0, 1.755, .785], [.083, .057, .032], [1, .91, .71]);
  for (const sign of [-1, 1]) {
    box("iron", [sign * .029, 1.845, .806], [.025, .032, .014]);
    box("paint", [0, 1.64, .785], [.25, .026, .025], [1, .91, .71], [0, 0, sign * .48]);
  }
  if (detailed) for (const x of [-.38, .38]) for (const y of [.18, 1.28, 2.375])
    parts.push({ shape: "sphere", surface: "iron", stage: 2,
      position: [x, y, .818 - .07 * y / CATAPULT_SHAFT_HEIGHT], size: [.033, .033, .022] });
  return parts;
};
