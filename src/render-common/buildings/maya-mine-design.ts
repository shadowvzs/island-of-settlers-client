import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { addMayaFret, MAYA_STONE, type MayaBuildingKit } from "./maya-building-kit";
import type { NationBody } from "./nation-kit-classify";
import { doorGapOf } from "./nation-kit-parts";

export const isMayaMine = (id: number) => id >= 10 && id <= 13;

/** The Roman barrel tunnel is architecture, separate from its hoist, lamp, workers and ore piles. */
export const withoutMayaMineBarrel = (body: NationBody, original: BuildingRecipe): NationBody => {
  const door = doorGapOf(original), centre = (door.left + door.right) / 2;
  const isBarrel = (part: BuildingPart) => !part.stock &&
    ["stone-arc", "ring", "cylinder"].includes(part.shape) && part.size[0] > .7 &&
    Math.abs(part.position[0] - centre) < .12 && part.position[2] <= door.z + .1;
  return { ...body,
    doorSurround: body.doorSurround.filter(part => !isBarrel(part)),
    keep: body.keep.filter(part => !isBarrel(part)),
    walls: body.walls.filter(wall => !(wall.min[0] >= centre - .61 && wall.max[0] <= centre + .61 &&
      wall.min[2] >= door.z - 1.1 && wall.max[2] <= door.z + .1))
  };
};

/** Corbelled stone adit: broad jambs and successive inward masonry courses carry a flat lintel. */
export const addMayaMinePortal = (kit: MayaBuildingKit) => {
  const { add, detailed, original } = kit, door = doorGapOf(original);
  const centre = (door.left + door.right) / 2, clearWidth = door.right - door.left;
  const front = door.z + .065, back = door.z - .965;
  const sideBack = back + .08, depth = front - sideBack, midZ = (front + sideBack) / 2;
  const clearTop = Math.max(door.top, door.spring + clearWidth / 2) + .025;
  const outerWidth = clearWidth + .64;
  for (const side of [-1, 1]) add({ position: [centre + side * (clearWidth / 2 + .16),
    clearTop / 2, midZ], shape: "bevel-box", size: [.32, clearTop, depth],
    stage: 1, surface: "cut-stone", tint: MAYA_STONE });
  for (let course = 0; course < 3; course++) {
    const gap = clearWidth - (course + 1) * .105, width = (outerWidth - gap) / 2;
    for (const side of [-1, 1]) add({ position: [centre + side * (gap + width) / 2,
      clearTop + .06 + course * .12, midZ], shape: "bevel-box",
      size: [width, .12, depth], stage: 2, surface: "cut-stone", tint: MAYA_STONE });
  }
  add({ position: [centre, clearTop + .405, midZ], shape: "bevel-box",
    size: [outerWidth, .09, depth], stage: 3, surface: "cut-stone", tint: MAYA_STONE });
  add({ position: [centre, (clearTop + .44) / 2, back + .04], shape: "box",
    size: [outerWidth, clearTop + .44, .08], stage: 1, surface: "plaster" });
  if (!detailed) return;
  for (const side of [-1, 1]) for (let course = 0; course < 4; course++) add({
    position: [centre + side * (clearWidth / 2 + .16), .11 + course * .205, front - .006],
    shape: "box", size: [.31, .025, .025], stage: 2, surface: "plaster" });
  for (const side of [-1, 1]) addMayaFret(add,
    [centre + side * (clearWidth / 2 + .16), clearTop + .19, front + .006], .18, .22, .035, 0, true);
};
