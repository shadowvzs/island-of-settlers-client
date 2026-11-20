import type { Point3 } from "./building-recipe";
import { addChineseBracket, addChineseRoof, CHINESE_TIMBER } from "./chinese-building-roofs";
import { addChineseHeadquartersClouds } from "./chinese-headquarters-clouds";
import { addChineseHeadquartersLanterns } from "./chinese-headquarters-lanterns";
import type { Add } from "./nation-kit-parts";

/** A timber upper audience hall rises through the lower hall's broad, weathered eaves. */
export const addChineseHeadquarters = (add: Add, detailed: boolean) => {
  const base = 1.39, top = 2.48;
  const timber = (position: Point3, size: Point3) => add({ position, size,
    shape: detailed ? "bevel-box" : "box", stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  for (const side of [-1, 1]) {
    add({ position: [0, (base + top) / 2, side * .57], size: [1.53, top - base, .09],
      shape: "box", stage: 1, surface: "plaster", tint: [.94, .91, .83] });
    add({ position: [side * .72, (base + top) / 2, 0], size: [.09, top - base, 1.14],
      shape: "box", stage: 1, surface: "plaster", tint: [.94, .91, .83] });
    for (const x of [-.72, 0, .72]) {
      timber([x, (base + top) / 2, side * .625], [.075, top - base, .075]);
      addChineseBracket(add, [x, top - .17, side * .625], 0, detailed, .8);
    }
    for (const y of [1.92, top - .04]) timber([0, y, side * .625], [1.58, .065, .055]);
    for (const x of [-.36, .36]) {
      // Opaque recessed screens prevent a view into overlapping roof/interior geometry.
      add({ position: [x, 2.18, side * .621], size: [.45, .36, .018],
        shape: "box", stage: 2, surface: "dark" });
      for (const offset of detailed ? [-.14, -.07, 0, .07, .14] : [-.1, .1])
        timber([x + offset, 2.18, side * .638], [.016, .36, .018]);
      for (const y of [2, 2.18, 2.36]) timber([x, y, side * .638], [.45, .02, .018]);
    }
    timber([side * .765, top - .04, 0], [.055, .065, 1.22]);
  }
  addChineseHeadquartersLanterns(add);
  addChineseHeadquartersClouds(add, detailed);
  addChineseRoof(add, { min: [-1.09, top, -.91], max: [1.09, top + .58, .91] }, 0, detailed, true);
};
