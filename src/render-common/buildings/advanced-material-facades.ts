import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

const WALL_TINTS: Record<number, Point3> = {
  41: [1, .96, .79], 42: [.81, .72, .57], 43: [1.08, 1.07, 1.01], 44: [1, .83, .61]
};
const TIMBER_TINTS: Record<number, Point3> = {
  41: [.78, .92, .72], 42: [.66, .48, .32], 43: [.77, .72, .64], 44: [.69, .49, .32]
};

/** Mounted occupation fittings stay above the yard and outside the unchanged doorway opening. */
export const withAdvancedMaterialFacade = (recipe: BuildingRecipe, id: number, detailed: boolean) => {
  const parts = recipe.parts.map(part => {
    if (part.stock || part.stage > 2) return part;
    const masonry = ["stone", "plaster", "cut-stone"].includes(part.surface);
    const timber = ["wood", "planks"].includes(part.surface);
    if (!masonry && !timber) return part;
    const colour = masonry ? WALL_TINTS[id]! : TIMBER_TINTS[id]!;
    return { ...part, tint: colour.map((channel, axis) => channel * (part.tint?.[axis] ?? 1)) as Point3 };
  });
  const walls = parts.filter(part => part.stage <= 2 && !part.stock &&
    ["stone", "plaster", "cut-stone", "wood", "planks"].includes(part.surface) && part.size[1] > .35);
  if (!walls.length) return { ...recipe, parts };
  const minX = Math.min(...walls.map(part => getRomanPartBounds(part).min[0]));
  const maxX = Math.max(...walls.map(part => getRomanPartBounds(part).max[0]));
  const left = recipe.door[0];
  const right = left + (recipe.doorDimensions?.width ?? .46);
  const preferred = maxX - right > left - minX;
  const z = recipe.door[2] + .018;
  const decoration = parts.filter(part => part.shape.startsWith("nubian-") ||
    part.shape === "paper-lantern" || part.shape === "folding-fan").map(part => getRomanPartBounds(part));
  const sites = [preferred, !preferred].flatMap(onRight => {
    const width = Math.min(.35, (onRight ? maxX - right : left - minX) - .09);
    const x = onRight ? right + width / 2 + .035 : left - width / 2 - .035;
    return [.77, .98, .53].map(y => ({ x, y, width }));
  });
  const site = sites.find(({ width, x, y }) => width >= .12 && !decoration.some(bounds =>
    bounds.max[0] > x - width / 2 && bounds.min[0] < x + width / 2 &&
    bounds.max[1] > y - .2 && bounds.min[1] < y + .2 &&
    bounds.max[2] > z - .05 && bounds.min[2] < z + .11));
  if (!site) return { ...recipe, parts };
  const { width: panelWidth, x, y } = site;
  const add = (surface: BuildingPart["surface"], position: Point3, size: Point3,
    rotation?: Point3, shape: BuildingPart["shape"] = "box", tint?: Point3) =>
    parts.push({ surface, position, size, rotation, shape, tint, stage: 2 });
  // An anchored backboard avoids tools appearing to float away from the wall.
  add(id === 43 ? "cut-stone" : "planks", [x, y, z], [panelWidth, .39, .085], undefined,
    "box", id === 43 ? [1.12, 1.1, 1.04] : TIMBER_TINTS[id]);
  if (id === 41) {
    // Trellis and broadleaf nursery cuttings, distinct from the ordinary conifer forester.
    for (const offset of [-.28, .28])
      add("wood", [x + offset * panelWidth, y, z + .026], [.018, .36, .02]);
    for (const offset of [-.12, 0, .12])
      add("wood", [x, y + offset, z + .03], [panelWidth, .018, .02]);
    const leaves = detailed ? 5 : 3;
    for (let leaf = 0; leaf < leaves; leaf++) {
      const side = leaf % 2 ? -1 : 1;
      add("leaf", [x + side * panelWidth * .18, y - .12 + leaf * .055, z + .06],
        [.09, .045, .025], [0, 0, side * .55], detailed ? "sphere" : "paint-ellipse", [.68, .87, .42]);
    }
  } else if (id === 42) {
    // Crossed long-handled axes on the hardwood lodge's tool board.
    for (const side of [-1, 1]) {
      add("wood", [x, y, z + .04], [.025, .34, .025], [0, 0, side * .48]);
      add("iron", [x - side * .065, y + .115, z + .055], [.105, .06, .03], [0, 0, side * .48], "axe-head");
    }
  } else if (id === 43) {
    // A marble sample, chisel and mallet distinguish finished-stone work from raw stone cutting.
    add("paint", [x, y - .08, z + .065], [panelWidth * .73, .13, .06], undefined, "bevel-box", [.97, .96, .91]);
    add("iron", [x - panelWidth * .22, y + .08, z + .05], [.018, .17, .025], [0, 0, -.2]);
    add("wood", [x + panelWidth * .2, y + .08, z + .05], [.018, .18, .025]);
    add("wood", [x + panelWidth * .2, y + .15, z + .065], [.09, .045, .045]);
    if (detailed) add("paint", [x, y - .08, z + .097], [.006, .11, .001], [0, 0, -.35], "box", [.44, .49, .47]);
  } else if (id === 44) {
    // Framed bow saw mounted by its handle, with actual metal blade and tensioned frame.
    for (const side of [-1, 1]) {
      add("wood", [x + side * panelWidth * .36, y, z + .052], [.023, .26, .03]);
      add("wood", [x, y + side * .115, z + .052], [panelWidth * .78, .025, .03]);
    }
    add("steel", [x, y - .075, z + .073], [panelWidth * .76, .018, .012]);
    add("rope", [x, y + .075, z + .073], [panelWidth * .76, .008, .008]);
  }
  return { ...recipe, parts };
};
