import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { withoutRomanCupola } from "./headquarters-cupola";
import { createMayaBuildingKit } from "./maya-building-kit";
import { addMayaOccupationProps } from "./maya-building-props";
import { addMayaRoofs } from "./maya-building-roofs";
import { addMayaMilitaryTowers } from "./maya-building-towers";
import { addMayaDoor, addMayaWall, mayaKeptPart, settleMayaInteriorFurniture } from "./maya-building-walls";
import { addMayaMillUpper } from "./maya-mill-design";
import { addMayaMinePortal, isMayaMine, withoutMayaMineBarrel } from "./maya-mine-design";
import { mayaMonumentRecipe } from "./maya-monument";
import { mayaWellRecipe } from "./maya-well-design";
import { classifyNationBody, type NationBody } from "./nation-kit-classify";
import { doorGapOf, insideRoof } from "./nation-kit-parts";
import { normalizeMirroredRoofPlan } from "./nation-kit-roof-plan";
import { withoutMilitaryTowers } from "./nation-kit-towers";

/** Old Roman roof trims and pediment infill leave with their roof; functional workshop props remain. */
const keepMayaPart = (part: BuildingPart, body: NationBody, original: BuildingRecipe) => {
  if (part.stock) return true;
  const masonry = ["stone", "cut-stone", "plaster"].includes(part.surface);
  const door = doorGapOf(original), dx = part.position[0] - (door.left + door.right) / 2;
  const dy = part.position[1] - door.spring;
  const voussoir = part.stage === 2 && part.shape === "box" && Math.max(...part.size) < .17 &&
    Math.abs(part.position[2] - door.z) < .13 && dy > -.025 &&
    Math.abs(Math.hypot(dx, dy) - ((door.right - door.left) / 2 + .04)) < .035;
  if (masonry && voussoir) return false;
  if (masonry && part.stage === 4 && part.position[1] > .2) return false;
  if (masonry && insideRoof(part, body.roofs, getRomanPartBounds(part))) return false;
  return true;
};

/** Classic-Maya-inspired national architecture, with unchanged logistics, inventory and door contracts. */
export const createMayaBuildingRecipe = (original: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean): BuildingRecipe => {
  if (definition.id === 7) return mayaMonumentRecipe(detailed);
  if (definition.id === 35) return mayaWellRecipe(original, definition, detailed);
  const shell = definition.id === 0 ? withoutRomanCupola(original) : original;
  const classified = classifyNationBody(withoutMilitaryTowers(normalizeMirroredRoofPlan(shell), definition.id));
  const body = isMayaMine(definition.id) ? withoutMayaMineBarrel(classified, original) : classified;
  const parts = body.keep.filter(part => keepMayaPart(part, body, original) &&
    (definition.id !== 31 || part.stock || getRomanPartBounds(part).max[1] <= 1.19 ||
      part.surface === "iron"))
    .map(part => settleMayaInteriorFurniture(mayaKeptPart(part, definition.id === 0), body));
  const kit = createMayaBuildingKit(original, definition, body, detailed, parts);
  // Shared arched door leaf is retained behind squared timber/limestone lintels.
  parts.push(...body.doorSurround.filter(part => part.shape === "arch-spandrel" ||
    Math.max(part.size[0], part.size[2]) > .65 || Math.abs(part.position[2] - original.door[2]) > .2)
    .map(part => part.shape === "arch-spandrel" ? { ...part, surface: "wood" as const } : mayaKeptPart(part, definition.id === 0)));
  for (const wall of body.walls) {
    if (definition.id !== 31 || wall.base < 1.17) addMayaWall(kit, wall);
  }
  if (definition.id === 31) addMayaMillUpper(kit);
  else addMayaRoofs(kit);
  addMayaMilitaryTowers(kit);
  if (isMayaMine(definition.id)) addMayaMinePortal(kit);
  addMayaDoor(kit);
  addMayaOccupationProps(kit);
  return { ...original, parts };
};
