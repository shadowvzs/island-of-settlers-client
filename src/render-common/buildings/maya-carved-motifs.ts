import type { Point3 } from "./building-recipe";
import { MAYA_STONE } from "./maya-building-kit";
import type { Add } from "./nation-kit-parts";

export type MayaCarving = "water" | "maize" | "cacao" | "craft" | "shield" | "reed";

/** Occupation symbols are original architectural interpretations, never claimed historical glyph texts. */
export const mayaOccupationCarving = (id: number): MayaCarving => {
  if ([5, 6].includes(id)) return "cacao";
  if ([18, 35, 39].includes(id)) return "water";
  if ([23, 28, 31, 32, 37].includes(id)) return "maize";
  if ([1, 2, 4, 9, 14, 24, 40, 62].includes(id)) return "shield";
  if ([17, 20, 22, 60, 61].includes(id)) return "reed";
  return "craft";
};

/** Small relief members over a recessed stone panel make real grooves and changing light. */
export const addMayaCarvedMotif = (add: Add, kind: MayaCarving, centre: Point3,
  width: number, height: number, depth: number, yaw = 0, detailed = true) => {
  const member = (x: number, y: number, w: number, h: number, angle = 0) => add({
    position: [centre[0] + Math.cos(yaw) * x, centre[1] + y, centre[2] - Math.sin(yaw) * x],
    rotation: [0, yaw, angle], shape: "box", size: [w, h, depth], stage: 4,
    surface: "cut-stone", tint: MAYA_STONE
  });
  const line = height * .095;
  if (kind === "water") {
    for (const row of [-1, 1]) for (let step = 0; step < (detailed ? 3 : 2); step++) {
      const x = (step - (detailed ? 1 : .5)) * width * .28;
      member(x, row * height * .19, width * .3, line);
      member(x + width * .12, row * height * .19 + height * .08, line, height * .22);
    }
  } else if (kind === "maize" || kind === "reed") {
    member(0, 0, width * .07, height * .9);
    for (const sign of [-1, 1]) {
      member(sign * width * .19, -height * .08, width * .1, height * .68, -sign * .48);
      if (detailed) member(sign * width * .22, height * .2, width * .08, height * .4, sign * .4);
    }
    if (kind === "maize") for (let index = 0; index < 3; index++)
      member(0, height * (.08 + index * .13), width * .24, height * .08);
  } else if (kind === "cacao") {
    for (const side of [-1, 1]) {
      member(side * width * .18, 0, width * .16, height * .62, -side * .23);
      if (detailed) member(side * width * .18, 0, width * .04, height * .76, -side * .23);
    }
    member(0, height * .35, width * .08, height * .2);
  } else if (kind === "shield") {
    member(0, height * .32, width * .65, line);
    for (const side of [-1, 1]) member(side * width * .24, -.01, width * .08, height * .7, side * .25);
    member(0, -height * .26, width * .36, line);
    member(0, height * .02, width * .08, height * .48);
  } else {
    for (const side of [-1, 1]) member(side * width * .2, 0, width * .11, height * .8, side * .58);
    member(0, -height * .27, width * .7, line);
    if (detailed) member(0, height * .28, width * .45, line);
  }
};
