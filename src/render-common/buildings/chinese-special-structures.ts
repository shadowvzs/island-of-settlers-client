import type { BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { addChineseBracket, addChineseRoof, CHINESE_TIMBER } from "./chinese-building-roofs";
import { type Add, runBetween } from "./nation-kit-parts";
import { isTavernYardDecor } from "./roman-tavern";

export const isChineseMine = (id: number) => id >= 10 && id <= 13;

/** Replace the classical tunnel shell with an independently supported tiled timber pithead. */
export const chineseSpecialStructureSource = (original: BuildingRecipe, id: number): BuildingRecipe => {
  if (id === 40) return { ...original, parts: original.parts.filter(part => !isTavernYardDecor(part)) };
  if (id === 31) return { ...original, parts: original.parts.filter(part => part.stock ||
    getRomanPartBounds(part).max[1] <= 1.19 ||
    part.surface === "iron" && Math.abs(part.position[1] - original.mechanism[1]) < .01) };
  if (isChineseMine(id)) return { ...original, parts: original.parts.filter(part =>
    part.stock || part.shape !== "stone-arc") };
  return original;
};

const beam = (add: Add, from: Point3, to: Point3, thickness = .06) =>
  runBetween(add, from, to, [thickness, thickness], { stage: 2, surface: "wood" });

export const addChineseSpecialStructure = (add: Add, original: BuildingRecipe, id: number, detailed: boolean) => {
  if (id === 31) { addChineseMillTower(add, detailed); return; }
  if (isChineseMine(id)) { addChineseMineHeadframe(add, original, id, detailed); return; }

};

/** A narrow timber windshaft room rises through a broad lower skirt, behind the rotating sails. */
const addChineseMillTower = (add: Add, detailed: boolean) => {
  addChineseRoof(add, { min: [-.52, 1.13, -.43], max: [.52, 1.40, .43] }, 31, detailed);
  add({ position: [0, 1.86, -.05], shape: "box", size: [.60, 1.32, .52], stage: 1,
    surface: "plaster", tint: [.84, .76, .59] });
  for (const x of [-.305, .305]) for (const z of [-.315, .215]) {
    add({ position: [x, 1.87, z], shape: "box", size: [.055, 1.34, .055], stage: 2,
      surface: "paint", tint: CHINESE_TIMBER });
    addChineseBracket(add, [x, 2.39, z], 0, detailed, .6);
  }
  for (const y of [1.44, 2.23]) add({ position: [0, y, .224], shape: "box",
    size: [.64, .055, .035], stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  add({ position: [0, 1.87, .217], shape: "window-shadow", size: [.28, .32, .015], stage: 2, surface: "dark" });
  for (const x of detailed ? [-.105, -.035, .035, .105] : [-.07, .07])
    add({ position: [x, 1.87, .232], shape: "box", size: [.018, .32, .018], stage: 2,
      surface: "paint", tint: CHINESE_TIMBER });
  addChineseRoof(add, { min: [-.45, 2.52, -.39], max: [.45, 2.85, .29] }, 31, detailed);
};

/** Tiled hoist shelter, paired portal frames, braces, purlins and a dark recessed working adit. */
const addChineseMineHeadframe = (add: Add, original: BuildingRecipe, id: number, detailed: boolean) => {
  const centre = original.door[0] + (original.doorDimensions?.width ?? .46) / 2;
  const front = original.door[2] + .025, back = front - 1.04, height = 1.25;
  for (const z of [front, back]) {
    for (const side of [-1, 1]) {
      const x = centre + side * .39;
      add({ position: [x, height / 2, z], shape: detailed ? "bevel-box" : "box",
        size: [.11, height, .11], stage: 1, surface: "wood" });
      addChineseBracket(add, [x, height - .17, z], 0, detailed, .75);
    }
    add({ position: [centre, height - .04, z], shape: "bevel-box", size: [.94, .12, .15],
      stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  }
  for (const side of [-1, 1]) {
    const x = centre + side * .39;
    beam(add, [x, .06, back], [x, height - .1, front - .08]);
    add({ position: [x, .48, (front + back) / 2], shape: "box", size: [.055, .88, front - back - .1],
      stage: 1, surface: "planks" });
    beam(add, [x, height - .02, back], [x, height - .02, front]);
  }
  add({ position: [centre, .52, back + .025], shape: "window-shadow", size: [.67, 1.02, .018],
    stage: 1, surface: "dark" });
  addChineseRoof(add, { min: [centre - .56, height - .02, back - .04],
    max: [centre + .56, height + .4, front + .04] }, id, detailed);
};
