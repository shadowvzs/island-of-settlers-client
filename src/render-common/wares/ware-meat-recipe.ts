import type { Point3 } from "../buildings/building-recipe";
import type { AddPart } from "../buildings/roman-resource-workshops";

/** One tied bone-in haunch, shared by the Hunter rack and transported meat. */
export const addBoneInMeatHaunch = (part: AddPart, center: Point3, lean = 0) => {
  const [x, y, z] = center;
  const meat: Point3 = [.24, .095, .04], bone: Point3 = [.66, .56, .4];
  part("paint", [x, y, z], [.18, .23, .15], 3, "sphere", [0, 0, lean], meat);
  part("paint", [x, y + .095, z], [.075, .13, .08], 3, "sphere", undefined, meat);
  part("paint", [x, y + .179, z], [.026, .13, .027], 3, "cylinder", undefined, bone);
  for (const side of [-1, 1])
    part("paint", [x, y + .234, z + side * .018], [.045, .04, .04], 3, "sphere", undefined, bone);
  part("rope", [x, y + .192, z], [.05, .018, .05], 3, "cylinder");
};
