import type { BuildingDefinition } from "./building-catalog";
import type { BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { KitContext } from "./nation-kit-parts";

export const isPersianMine = (id: number) => id >= 10 && id <= 13;
const ADIT_X = -.17;
const MASONRY = new Set(["stone", "cut-stone", "plaster"]);

/** Only the old central tunnel is replaced; sorting gear, food and ore inventory remain intact. */
export const withoutPersianMineAdit = (original: BuildingRecipe, definition: BuildingDefinition): BuildingRecipe => {
  if (!isPersianMine(definition.id)) return original;
  return { ...original, parts: original.parts.filter(part => {
    if (part.stock || !MASONRY.has(part.surface)) return true;
    const bounds = getRomanPartBounds(part);
    const adit = part.position[0] >= -.8 && part.position[0] <= .45 &&
      bounds.min[0] >= -.83 && bounds.max[0] <= .49 && part.position[2] < .5 && part.position[2] > -.7;
    return !adit;
  }) };
};

/** A deep round Persian barrel vault sits behind a thick, recessed voussoir entrance. */
export const addPersianMineAdit = (context: KitContext) => {
  if (!isPersianMine(context.typeId)) return;
  const { add, detailed, door } = context, spring = .85, diameter = 1.28, back = -.65, front = .4;
  for (const side of [-1, 1]) {
    add({ position: [ADIT_X + side * .52, .43, (front + back) / 2], shape: "bevel-box",
      size: [.18, .86, front - back], stage: 1, surface: "plaster" });
    add({ position: [ADIT_X + side * .36, .43, front - .045], shape: "bevel-box",
      size: [.16, .86, .18], stage: 2, surface: "plaster" });
    add({ position: [ADIT_X + side * .57, .69, front - .08], shape: "bevel-box",
      size: [.14, 1.38, .24], stage: 2, surface: "plaster", topScale: [.75, 1, .8] });
    if (detailed) add({ position: [ADIT_X + side * .57, 1.38, front - .08], shape: "bevel-box",
      size: [.17, .09, .26], stage: 3, surface: "cut-stone" });
  }
  add({ occupationRoof: "barrel", position: [ADIT_X, spring + .44 * .82, (front + back) / 2],
    shape: "occupation-roof", size: [1.26, .82, front - back], stage: 3, surface: "roof" });
  add({ occupationRoof: "barrel", position: [ADIT_X, spring + .44 * .82, back + .025],
    shape: "roof-infill", size: [1.1, .82, .10], stage: 2, surface: "plaster" });
  add({ position: [ADIT_X, .43, back + .025], shape: "box", size: [1.1, .86, .10],
    stage: 1, surface: "plaster" });
  // The larger opening frames the unchanged working door further inside the tunnel.
  for (let index = 0; index < 6; index++) add({ innerRadius: .31, position: [ADIT_X, spring, front],
    rotation: [Math.PI / 2, 0, Math.PI / 2 + index * Math.PI / 6], shape: "stone-arc",
    size: [diameter, .16, diameter], stage: 2, surface: "plaster" });
  add({ position: [(door.left + door.right) / 2, door.top / 2 + .035, door.z - .06], shape: "window-shadow",
    size: [door.right - door.left, door.top + .07, .055], stage: 1, surface: "dark" });
  if (context.typeId === 11 || context.typeId === 12) {
    const height = context.typeId === 11 ? .3 : .18;
    add({ position: [ADIT_X, 1.55 + height / 2, -.39], shape: "bevel-box", size: [.2, height, .2],
      stage: 3, surface: "plaster" });
    add({ position: [ADIT_X, 1.55 + height + .015, -.39], shape: "window-shadow", size: [.13, .025, .13],
      stage: 3, surface: "dark" });
  }
};
