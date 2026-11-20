import type { Point3 } from "./building-recipe";
import { MAYA_STONE, type MayaBuildingKit } from "./maya-building-kit";

/** A residential upper palace above the broad council terraces; the monumental temple remains separate. */
export const addMayaHeadquartersPalace = (kit: MayaBuildingKit, centre: Point3,
  width: number, depth: number) => {
  const { add } = kit;
  const w = Math.min(width * .68, 1.75), d = Math.min(depth * .58, 1.22);
  const y = centre[1] + .09, z = centre[2] + depth * .035, height = .88;
  add({ shape: "bevel-box", position: [centre[0], y + .09, z], size: [w + .16, .18, d + .14],
    stage: 3, surface: "cut-stone", tint: MAYA_STONE });
  add({ shape: "bevel-box", position: [centre[0], y + .18 + height / 2, z], size: [w, height, d],
    stage: 3, surface: "plaster" });
  for (const side of [-1, 1]) {
    // Battered foot and overhanging cornice give the hall a masonry silhouette at gameplay distance.
    add({ shape: "bevel-box", position: [centre[0] + side * (w / 2 - .025), y + .32, z],
      size: [.13, .31, d + .04], stage: 3, surface: "cut-stone", tint: MAYA_STONE });
    // Original gilded architectural masks are mounted into the palace wall, not roof trinkets.
    add({ position: [centre[0] + side * w * .32, y + .67, z + d / 2 + .031],
      shape: "maya-civic-mask", size: [w * .23, .44, .07], stage: 4, surface: "gold",
      tint: [1, .94, .76] });
    for (const edge of [-1, 1]) add({
      position: [centre[0] + side * w * .32, y + .67 + edge * .2275, z + d / 2 + .012],
      shape: "bevel-box", compactGeometry: true, size: [w * .23 + .02, .015, .025], stage: 4,
      surface: "gold", tint: [1, .94, .76] });
    for (const edge of [-1, 1]) add({
      position: [centre[0] + side * w * .32 + edge * (w * .115 + .0025), y + .67, z + d / 2 + .012],
      shape: "bevel-box", compactGeometry: true, size: [.015, .47, .025], stage: 4,
      surface: "gold", tint: [1, .94, .76] });
  }
  for (const side of [-1, 1]) {
    const face = z + side * (d / 2 + .006);
    // The small corbelled upper opening is recessed behind thick limestone jambs and stepped lintels.
    add({ shape: "box", position: [centre[0], y + .52, face], size: [.28, .5, .012],
      stage: 3, surface: "wood", tint: [.37, .29, .18] });
    for (let step = 0; step < 3; step++) add({ shape: "bevel-box",
      position: [centre[0], y + .77 + step * .055, face + side * .025],
      size: [.5 - step * .1, .075, .08], stage: 3, surface: "cut-stone", tint: MAYA_STONE });
    for (const jamb of [-1, 1]) add({ shape: "bevel-box",
      position: [centre[0] + jamb * .19, y + .5, face + side * .02], size: [.1, .59, .09],
      stage: 3, surface: "cut-stone", tint: MAYA_STONE });
  }
  for (let tier = 0; tier < 3; tier++) add({ shape: "bevel-box",
    position: [centre[0], y + 1.075 + tier * .07, z],
    size: [w + .16 - tier * .09, .085, d + .17 - tier * .08], stage: 3,
    surface: "cut-stone", tint: MAYA_STONE });
  return { centre: [centre[0], y + 1.26, z] as Point3, width: w * .83 };
};
