import { DMath } from "../../shared/math/deterministic-math";
import type { Point3 } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";

const FLAX_STRAW: Point3 = [.79, .73, .48];
const FLAX_CAPSULE: Point3 = [.56, .39, .20];

const addStem = (part: AddPart, from: Point3, to: Point3, thickness: number) => {
  const dx = to[0] - from[0], dy = to[1] - from[1], dz = to[2] - from[2];
  const length = DMath.hypot(dx, dy, dz);
  part("straw", from.map((value, axis) => (value + to[axis]!) / 2) as Point3,
    [thickness, length, thickness], 3, "cylinder",
    [DMath.atan2(dz, dy), 0, -DMath.atan2(dx, DMath.hypot(dy, dz))], FLAX_STRAW);
};

/** Harvested flax: fine woody stems, rounded branched seed capsules and a tight twine waist. */
export const addFlaxBundle = (part: AddPart, detailed: boolean, compact = false) => {
  const fullStems = detailed ? 24 : 12;
  const compactStems = detailed ? 5 : 3;
  const stems = compact ? compactStems : fullStems;
  for (let index = 0; index < stems; index++) {
    const angle = index * 2.39996, radius = .018 + .027 * Math.sqrt((index + 1) / stems);
    const x = DMath.cos(angle) * radius, z = DMath.sin(angle) * radius * .75;
    const waist: Point3 = [x * .56, -.025, z * .56];
    const tip: Point3 = [x * 1.65, .14 + (index % 5) * .011, z * 1.65];
    addStem(part, [x * 1.8, -.225 + (index % 4) * .008, z * 1.8], waist, .006);
    addStem(part, waist, tip, .0045);
    const fullBranches = detailed ? 2 : 1;
    const branches = compact ? 1 : fullBranches;
    for (let branch = 0; branch < branches; branch++) {
      const turn = angle + branch * 1.9;
      const end: Point3 = [tip[0] + DMath.cos(turn) * .021,
        tip[1] + .024 + branch * .015, tip[2] + DMath.sin(turn) * .021];
      addStem(part, [tip[0], tip[1] - .025, tip[2]], end, .0025);
      part("straw", end, [.015, .017, .015], 3, "sphere", undefined, FLAX_CAPSULE);
    }
  }
  for (const y of compact ? [-.032, -.02] : [-.037, -.027, -.017])
    part("rope", [0, y, 0], [.065, .007, .051], 3, "ring");
  part("rope", [.028, -.026, .022], [.017, .013, .014], 3, "sphere");
};

/** An open bolt of natural linen, with its wooden winding core and an unfurled fabric end. */
export const addClothBolt = (part: AddPart, compact = false) => {
  if (!compact) {
    part("cloth", [0, 0, 0], [.36, .13, .27], 3, "linen-bolt");
    part("wood", [0, .00065, -.0621], [.031, .354, .031], 3, "cylinder",
      [0, 0, Math.PI / 2], [.58, .40, .24]);
    return;
  }
  // Building stock stacks read as folded bolts without the carried ware's full cloth mesh.
  part("cloth", [0, -.012, 0], [.34, .08, .27], 3, "bevel-box");
  part("cloth", [0, .038, -.02], [.31, .035, .23], 3, "bevel-box");
  part("rope", [0, .002, 0], [.35, .018, .28], 3, "box");
};
