import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { addIndigenousAwningFrame } from "./indigenous-awning-frame";
import { indigenousRoofHeight } from "./indigenous-roof-profile";
import { type Add, runBetween } from "./nation-kit-parts";

/** The retained harbour bell is carried by an open pole belfry, not an invisible former stone shaft. */
export const addIndigenousHarbourLookout = (add: Add, detailed: boolean) => {
  const x = -1.04, z = -.18, reach = .27, top = 2.67;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const px = x + sx * reach, pz = z + sz * reach;
    add({ position: [px, top / 2, pz], radialSegments: detailed ? 8 : 4,
      shape: "cylinder", size: [.065, top, .065], stage: 1, surface: "wood" });
  }
  for (const y of [1.0, 2.13, top]) add({ position: [x, y, z], shape: "box",
    size: [.67, .045, .67], stage: 2, surface: "planks" });
  for (const side of [-1, 1]) runBetween(add, [x + side * reach, .08, z - reach],
    [x + side * reach, 2.1, z + reach], [.035, .035], { stage: 2, surface: "wood" });
  add({ indigenousRoof: "tipi", position: [x, 2.87, z], shape: "indigenous-roof",
    size: [.88, .4, .88], stage: 3, surface: "cloth" });
};

/** The mill bearing is enclosed by the full textile windshaft body. */
export const addIndigenousMillFrame = (add: Add, original: BuildingRecipe, detailed: boolean) => {
  const x = original.mechanism[0], top = original.mechanism[1], z = 0;
  // Deep internal posts and sloped braces stay wholly below the curved membrane.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const foot: [number, number, number] = [x + sx * .14, .02, z + sz * .12];
    const head: [number, number, number] = [foot[0], top * .68, foot[2]];
    runBetween(add, foot, head, [.035, .035], { stage: 1, surface: "wood" });
    runBetween(add, head, [x, top - .20, z], [.03, .03], { stage: 2, surface: "wood" });
  }
  // Only the short metal bearing emerges at the crown to meet the unchanged sail axle.
  add({ position: [x, top - .075, z], radialSegments: detailed ? 12 : 6,
    shape: "cylinder", size: [.13, .15, .13], stage: 2, surface: "iron" });
};

/** The scout's retained balcony stands on a light pole loft above its ground tent. */
export const addIndigenousScoutLoft = (add: Add, original: BuildingRecipe, detailed: boolean) => {
  const door = original.balconyDoor;
  if (!door) return;
  const deck = door.position[1], top = deck + .72;
  // The ground pod encloses its bearing; only loft/awning posts rise outside the membrane.
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) add({
    position: [sx * .43, (deck + top - .045) / 2, sz * .3], radialSegments: detailed ? 8 : 4,
    shape: "cylinder", size: [.045, top - .045 - deck, .045], stage: 2, surface: "wood"
  });
  add({ position: [0, deck - .035, .06], shape: "box", size: [1.05, .07, .88],
    stage: 2, surface: "planks" });
  // This is an open observation deck: no freestanding curtain or doorway frame.
  add({ indigenousRoof: "awning", position: [0, top + .15, 0], shape: "indigenous-roof",
    size: [1.2, .32, .86], stage: 3, surface: "cloth" });
  const point = (u: number, v: number, lift = 0): Point3 =>
    [u * 1.2, top + .15 + .32 * indigenousRoofHeight("awning", u, v) + lift, v * .86];
  const u = .43 / 1.2, v = .30 / .86;
  addIndigenousAwningFrame(add, point, detailed, { u, v, drop: point(u, v)[1] - (top - .045) });
};

export const isIndigenousHarbourArchitecture = (part: BuildingPart) => !part.stock &&
  Math.hypot(part.position[0] + 1.04, part.position[2] + .18) < .6 && part.position[1] > .7 &&
  ["stone", "cut-stone", "plaster", "gold", "dark"].includes(part.surface);
