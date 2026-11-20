import type { BuildingPart, Point3 } from "./building-recipe";
import { eulerFromRotation, multiplyRotations, rotatePoint, rotationFromEuler } from "./recipe-rotation";
import { ornamentOffset, ornamentSize } from "./viking-ornament-boxes";

type Add = (part: Omit<BuildingPart, "stage">) => unknown;

/** Silver bearded blades, dark iron collars and ash hafts, supported on two wall pegs. */
export const addVikingCatapultEntryAxes = (add: Add, centre: Point3, detailed: boolean) => {
  const part = (offset: Point3, size: Point3, shape: BuildingPart["shape"],
    surface: BuildingPart["surface"], rotation?: Point3, tint?: Point3) => add({
    position: offset.map((value, axis) => value + centre[axis]!) as Point3,
    size, shape, surface, rotation, tint, radialSegments: detailed ? 8 : 4,
    compactGeometry: true, catapultWallOrnament: true });
  for (const side of [-1, 1]) {
    const roll = rotationFromEuler([0, 0, side * .63]), rotation = eulerFromRotation(roll);
    const depth = side < 0 ? .035 : .063;
    part([0, 0, depth], [.023, .43, .023], "cylinder", "wood", rotation, [1.45, 1.15, .75]);
    const top = rotatePoint(roll, [0, .16, 0]);
    const turn = side < 0 ? roll : multiplyRotations(roll, rotationFromEuler([0, Math.PI, 0]));
    const scale = .15, offset = rotatePoint(turn, ornamentOffset("bearded-axe-head", [-.04, 0, 0], scale));
    part([top[0] - offset[0], top[1] - offset[1], depth - offset[2]],
      ornamentSize("bearded-axe-head", scale), "bearded-axe-head", "steel", eulerFromRotation(turn), [1.35, 1.4, 1.45]);
    for (const y of [.12, -.15]) {
      const band = rotatePoint(roll, [0, y, 0]);
      part([band[0], band[1], depth], [.029, .025, .029], "cylinder", "iron", rotation);
    }
    // The small exposed iron pin is separate from the haft: the mount genuinely reaches the masonry.
    const mount = rotatePoint(roll, [0, .10, 0]);
    part([mount[0], mount[1], .025], [.019, .019, .09], "box", "iron");
  }
};
