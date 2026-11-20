import { DMath } from "../../shared/math/deterministic-math";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";

interface RoofSite {
  x: number;
  y: number;
  z: number;
  surface: BuildingPart["surface"];
}

type Add = (surface: BuildingPart["surface"], position: Point3, size: Point3,
  rotation?: Point3, shape?: BuildingPart["shape"]) => void;

/** Locate the structural ridge, excluding pottery and free-standing nation ornaments. */
const ridgeSite = (recipe: BuildingRecipe): RoofSite | undefined => {
  const roofs = recipe.parts.filter(part => part.stage === 4 && part.surface.startsWith("roof") &&
    !part.stock && part.shape !== "tile").filter(part => {
      const bounds = getRomanPartBounds(part);
      const width = bounds.max[0] - bounds.min[0];
      const depth = bounds.max[2] - bounds.min[2];
      return width * depth > .035 && Math.max(width, depth) > .7;
    });
  const ridge = roofs.sort((a, b) => getRomanPartBounds(b).max[1] - getRomanPartBounds(a).max[1])[0];
  if (!ridge) return;
  const y = getRomanPartBounds(ridge).max[1];
  const peaks = roofs.filter(part => Math.abs(getRomanPartBounds(part).max[1] - y) < .015);
  const center = (axis: number) => peaks.reduce((sum, part) => sum + part.position[axis]!, 0) / peaks.length;
  return { x: center(0), y, z: center(2), surface: ridge.surface };
};

/** A framed ventilation loft sits into the existing roof, with a supported pitched cap. */
const roofLoft = (add: Add, site: RoofSite, width: number, depth: number, height: number,
  masonry: boolean, detailed: boolean) => {
  const { surface, x, y, z } = site;
  const bottom = y - .22;
  const top = y + height;
  const wall = masonry ? "cut-stone" : "wood";
  for (const side of [-1, 1]) {
    add("dark", [x, (bottom + top) / 2, z + side * (depth / 2 - .03)],
      [width - .055, top - bottom, .001], undefined, "window-shadow");
    add(wall, [x + side * width / 2, (bottom + top) / 2, z], [.055, top - bottom, depth + .035]);
    add(wall, [x, top - .025, z + side * depth / 2], [width, .05, .045]);
    for (const column of detailed ? [-1, 0, 1] : [])
      add(wall, [x + column * width * .43, (bottom + top) / 2, z + side * depth / 2],
        [.035, top - bottom, .045]);
    for (let row = 0; row < (detailed ? 4 : 1); row++) {
      const rows = detailed ? 4 : 1;
      add(wall, [x, y + (row + .5) * height / rows, z + side * depth / 2],
        [width - .055, .025, .04], [.3 * side, 0, 0]);
    }
  }
  const pitch = masonry ? .3 : .48;
  const half = width / 2 + .075;
  const rise = half * DMath.tan(pitch);
  for (const side of [-1, 1])
    add(surface, [x + side * half / 2, top + rise / 2, z],
      [half / DMath.cos(pitch), .045, depth + .14], [0, 0, -side * pitch]);
  add(wall, [x, top + rise / 2 - .015, z], [width, rise, depth], undefined, "gable");
  add(surface, [x, top + rise + .02, z], [.065, .055, depth + .15]);
};

/** Specialist silhouettes are permanent architecture; stock, doors and work routes are untouched. */
export const applyAdvancedMaterialDesign = (recipe: BuildingRecipe, id: number, detailed: boolean) => {
  const site = ridgeSite(recipe);
  if (!site) return recipe;
  const parts = [...recipe.parts];
  const add: Add = (surface, position, size, rotation, shape = "box") =>
    parts.push({ surface, position, size, rotation, shape, stage: 4,
      windowShadowDecorative: shape === "window-shadow" ? true : undefined });
  if (id === 41) {
    // A broad nursery ventilation lantern and exposed shade slats distinguish the tree nursery.
    roofLoft(add, site, .74, .43, .18, false, detailed);
    for (const side of detailed ? [-1, 1] : []) for (const offset of [-.22, 0, .22])
      add("wood", [site.x + offset, site.y + .08, site.z + side * .34], [.035, .12, .25],
        [side * .25, 0, 0]);
  } else if (id === 42) {
    // Two separate drying vents give the hardwood timber lodge its paired roof silhouette.
    for (const side of [-1, 1])
      roofLoft(add, { ...site, z: site.z + side * .27 }, .44, .24, .17, false, detailed);
  } else if (id === 43) {
    // The marble workshop has a pale stone lantern with a low, broad quarry pavilion cap.
    roofLoft(add, { ...site, surface: "roof-slate" }, .66, .57, .24, true, detailed);
    for (const side of [-1, 1])
      add("cut-stone", [site.x + side * .37, site.y + .025, site.z], [.09, .11, .67]);
  } else if (id === 44) {
    // A long louvered saw hall, rather than the ordinary sawmill's unbroken roof ridge.
    roofLoft(add, site, .63, .84, .23, false, detailed);
    for (const side of [-1, 1])
      add("iron", [site.x + side * .31, site.y + .08, site.z], [.025, .035, .78]);
  }
  return { ...recipe, parts };
};
