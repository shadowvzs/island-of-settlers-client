import type { BuildingPart, Point3 } from "./building-recipe";
import { runBetween } from "./nation-kit-parts";

/** Owner-approved Maya tower stays intact: only one small, supported thatch entry lean-to. */
export const addMayaCatapultEntryHood = (parts: BuildingPart[], _detailed: boolean) => {
  const pitch = .2, centre: Point3 = [0, 1.075, .86], width = .84, depth = .38;
  const add = (part: Omit<BuildingPart, "stage"> & { stage?: number }) =>
    parts.push({ architecture: true, compactGeometry: true, stage: 3, ...part });
  const onRoof = (x: number, z: number, lift = 0): Point3 =>
    [x, centre[1] - (z - centre[2]) * Math.tan(pitch) + lift, z];
  add({ position: centre, rotation: [0, -Math.PI/2, 0], shape: "lean-thatch-roof", roofCompactGeometry:true,
    plantRoofStyle: "reed", size: [depth, .10, width], surface: "roof-thatch" });
  for (const side of [-1, 1]) {
    runBetween(add, onRoof(side * .31, .695, -.03), onRoof(side * .31, 1.035, -.03),
      [.04, .05], { roofSupport: true, surface: "wood" });
    runBetween(add, [side * .31, .94, .72], onRoof(side * .31, .95, -.045),
      [.035, .035], { roofSupport: true, surface: "wood" });
  }
};
