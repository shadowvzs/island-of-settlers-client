import type { WorkerNation } from "../workers/worker-nation";
import type { BuildingDefinition } from "./building-catalog";
import { getAuthoredBuildingPlot } from "./building-plot-profile";
import type { BuildingPart, BuildingRecipe, BuildingSurface, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import type { BuildingLevel } from "./levels/building-level";
import { leveledBuildingRecipe } from "./levels/leveled-building-recipe";
import { applyRoofReviewPrototype } from "./roof-review-prototype";

export const WORKYARD_REVIEW_TYPES = [17, 20, 33, 61, 32, 8] as const;
const PROTOTYPE_TYPES = new Set<number>(WORKYARD_REVIEW_TYPES);

/** Review-only physical data. The added east strip keeps the original building and all access anchors fixed.
 * Its asymmetric reservation is deliberate; production placement must explicitly adopt the offset after approval. */
export const createWorkyardReviewPrototype = (
  definition: BuildingDefinition, nation: WorkerNation, detailed: boolean, level: BuildingLevel
) => {
  if (!PROTOTYPE_TYPES.has(definition.id)) return undefined;
  const authored = getAuthoredBuildingPlot(definition.id)!;
  const originalRecipe = leveledBuildingRecipe(definition, nation, detailed, level);
  const roofReview = applyRoofReviewPrototype(originalRecipe, definition.id, nation, detailed, level);
  let recipe = roofReview.recipe;
  const [width, depth] = authored.reservedCells;
  const parts: BuildingPart[] = [];
  const scale = authored.structureScale;
  const x = width / 2 + .9;
  const add = (surface: BuildingSurface, position: Point3, size: Point3,
    shape: BuildingPart["shape"] = "box", stock?: BuildingPart["stock"], rotation?: Point3) => {
    parts.push({ position: position.map(value => value / scale) as Point3, shape,
      rotation, size: size.map(value => value / scale) as Point3, stage: 4, stock, surface });
  };
  if (definition.id === 17) {
    recipe = { ...recipe, parts: recipe.parts.filter(part => part.stock || part.workyardAssembly !== "woodcutter") };
    add("paint", [x, .255, -.55], [.65, .54, .61], "workshop-stump");
    // Proper shaped axe head bites into the cut face; its haft leaves the eye on a diagonal.
    add("steel", [x + .045, .53, -.55], [.23, .17, .035], "axe-head", undefined, [0, 0, -2.1]);
    add("wood", [x - .23, .75, -.55], [.034, .65, .034], "cord", undefined, [0, 0, 1.05]);
    // A low braced tool rack holds wedges, rather than anonymous stacked cubes.
    for (const end of [-1, 1]) add("wood", [x, .35, .65 + end * .4], [.07, .7, .07], "bevel-box");
    add("wood", [x, .66, .65], [.09, .07, .95], "bevel-box");
    for (const z of [.35, .63, .91]) add("iron", [x, .58, z], [.035, .16, .075], "bevel-box");
  }
  if (definition.id === 20) {
    recipe = { ...recipe, parts: recipe.parts.filter(part => part.workyardAssembly !== "resource-20") };
    // One joined nursery bench replaces the original narrow wall shelf.
    for (const offset of [-.23, 0, .23]) add("planks", [x + offset, .63, 0], [.215, .065, 2.1], "bevel-box");
    for (const z of [-.85, .85]) for (const side of [-1, 1])
      add("wood", [x + side * .25, .29, z], [.085, .58, .085], "bevel-box");
    add("wood", [x, .22, 0], [.075, .08, 1.85], "bevel-box");
    for (const [index, z] of [-.66, 0, .66].entries()) for (const [column, side] of [-1, 1].entries()) {
      const px = x + side * .18;
      add("paint", [px, .745, z], [.24, .18, .24], "clay-jar");
      add("dark", [px, .835, z], [.15, .012, .15], "cylinder");
      add("paint", [px, 1.06, z], [.27, .44, .27], "nursery-sapling",
        { kind: "output", slot: index * 2 + column, ware: "seedling" });
    }
  }
  if (definition.id === 33) {
    // Relocate the existing saw station as one assembly; never add a second planking place.
    const dx = x / scale - recipe.mechanism[0];
    const groups = new Set(["equipment-33", "mechanism-33"]);
    recipe = { ...recipe, mechanism: [recipe.mechanism[0] + dx, recipe.mechanism[1], recipe.mechanism[2]],
      workPoint: [x / scale - .48 / scale, 0, recipe.mechanism[2]],
      parts: recipe.parts.map(part => groups.has(part.workyardAssembly ?? "")
        ? { ...part, position: [part.position[0] + dx, part.position[1], part.position[2]] } : part) };
    // The extension is an infeed/outfeed support for that one saw, with mortised trestles.
    for (const z of [-1, 1]) {
      for (const side of [-1, 1]) add("wood", [x + side * .26, .34, z], [.08, .68, .11], "bevel-box",
        undefined, [0, 0, side * .18]);
      add("wood", [x, .69, z], [.75, .085, .16], "bevel-box");
      add("wood", [x, .21, z], [.56, .055, .07], "bevel-box");
    }
    for (const side of [-1, 1]) add("wood", [x + side * .24, .55, 0], [.065, .06, 2.1], "bevel-box");
  }
  if (definition.id === 61) {
    // The house already owns one loom. This winding bench prepares yarn for it.
    for (const end of [-1, 1]) for (const side of [-1, 1])
      add("wood", [x + side * .23, .32, end * .62], [.065, .64, .065], "bevel-box");
    add("planks", [x, .66, 0], [.65, .065, 1.5], "bevel-box");
    for (const z of [-.42, 0, .42]) {
      add("wood", [x, .84, z], [.035, .31, .035], "cylinder");
      add("rope", [x, .83, z], [.16, .19, .16], "cylinder");
      for (const y of [.72, .94]) add("wood", [x, y, z], [.19, .025, .19], "cylinder");
    }
  }
  if (definition.id === 32) {
    // Retain the house's single oven and bread shelf. Add only a separate kneading trough.
    add("planks", [x, .71, 0], [.7, .07, 1.65], "bevel-box");
    for (const z of [-.62, .62]) for (const side of [-1, 1])
      add("wood", [x + side * .24, .33, z], [.08, .66, .08], "bevel-box");
    for (const side of [-1, 1]) add("wood", [x + side * .23, .83, -.15], [.045, .18, .87], "bevel-box");
    for (const z of [-.56, .26]) add("wood", [x, .83, z], [.5, .18, .045], "bevel-box");
    add("wood", [x, .77, -.15], [.46, .035, .8], "bevel-box");
    add("wood", [x, .79, .57], [.055, .42, .055], "cylinder", undefined, [Math.PI / 2, 0, 0]);
  }
  const prototype: BuildingRecipe = { ...recipe, parts: [...recipe.parts, ...parts] };
  const bounds = (part: BuildingPart) => {
    const box = getRomanPartBounds(part);
    return { max: box.max.map(value => value * scale) as Point3,
      min: box.min.map(value => value * scale) as Point3 };
  };
  return {
    profile: {
      accessAnchors: { door: recipe.door, workPoint: recipe.workPoint, workerExit: recipe.workerExit },
      control: false,
      originalCells: authored.reservedCells,
      roofReview: { selection: roofReview.selection, supports: roofReview.supports },
      reservedGround: { min: [-width / 2, -depth / 2], max: [width / 2 + (parts.length ? 2 : 0), depth / 2] },
      requiredLanes: [{ from: recipe.door, to: recipe.workerExit }],
      staticObstacles: parts.filter(part => !part.stock).map(bounds),
      stockObstacles: parts.filter(part => part.stock).map(part => ({ ...bounds(part), stock: part.stock })),
      structureScale: scale
    },
    recipe: prototype
  };
};
