import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "./building-recipe-fit";
import { roofTopAt } from "./levels/level-roof-surface";
import { classifyNationBody } from "./nation-kit-classify";
import { findQuoinStacks } from "./nation-kit-corner-posts";
import { isInCupolaColumn, nubianCupolaSites } from "./nation-kit-nubian-cupola";
import { bodyCenter, doorGapOf, insideRoof, type KitContext } from "./nation-kit-parts";
import { normalizeMirroredRoofPlan } from "./nation-kit-roof-plan";
import { withoutMilitaryTowers } from "./nation-kit-towers";
import { persianAcademyRecipe } from "./persian-academy";
import { withPersianBlueTrim } from "./persian-blue-trim";
import {
  addPersianCupolaDrum, addPersianEntrance, addPersianRoof, addPersianWall
} from "./persian-building-architecture";
import { addPersianOccupationProps, addPersianRelief, addPersianWallTextile } from "./persian-building-props";
import { remountPersianOccupationSign } from "./persian-building-signs";
import { persianHarbourRecipe } from "./persian-harbour";
import { persianHeadquartersRecipe } from "./persian-headquarters";
import { addPersianLookoutPiers, addPersianMilitaryTowers } from "./persian-military";
import { addPersianMineAdit, isPersianMine, withoutPersianMineAdit } from "./persian-mines";
import { persianMonumentRecipe } from "./persian-monument";
import { persianGrandResidence } from "./persian-residence";
import { withPersianClosedVaultJoins } from "./persian-roof-joins";
import {
  addPersianRoundedMassing, keepPersianRoundedProp, usesPersianRoundedMassing
} from "./persian-rounded-massing";
import { withPersianStripedAwning } from "./persian-striped-awnings";
import { persianWellRecipe } from "./persian-well";
import { withPersianWindowOpenings } from "./persian-window-openings";

const MASONRY = new Set(["stone", "cut-stone", "plaster", "mosaic"]);

/** Shared machinery/inventories remain intact while architectural masonry becomes lime plaster. */
const resurface = (part: BuildingPart): BuildingPart => {
  if (part.stock) return part;
  if (part.shape === "civic-column-shaft")
    return { ...part, shape: "bevel-box", surface: "plaster", tint: undefined,
      size: [part.size[0] * 1.5, part.size[1], part.size[2] * 1.5], topScale: [.8, 1, .8] };
  if (MASONRY.has(part.surface) && part.shape === "cylinder" && part.size[1] > .4 &&
    Math.max(part.size[0], part.size[2]) < .3) return { ...part, shape: "bevel-box", surface: "plaster",
      size: [part.size[0] * 1.4, part.size[1], part.size[2] * 1.4], topScale: [.85, 1, .85] };
  if (part.surface === "paint" && part.shape === "ring" && part.size[0] > .4)
    return { ...part, surface: "plaster", tint: undefined };
  if (!MASONRY.has(part.surface)) return part;
  if (part.position[1] + part.size[1] / 2 < .2)
    return { ...part, surface: "cut-stone", tint: [.79, .73, .62] };
  return { ...part, surface: "plaster", tint: undefined };
};

/** A full national set on the unchanged gameplay plans, with occupation-specific vaults and furnishings. */
const buildPersianBuildingRecipe = (original: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean): BuildingRecipe => {
  if (definition.id === 0) return persianHeadquartersRecipe(original, detailed);
  if (definition.id === 40) return persianAcademyRecipe(original, detailed);
  if (definition.id === 59) return persianGrandResidence(original, detailed);
  if (definition.id === 39) return persianHarbourRecipe(original, detailed);
  if (definition.style === "well") return persianWellRecipe(original, detailed);
  if (definition.id === 7) return persianMonumentRecipe(detailed);
  const structure = normalizeMirroredRoofPlan(
    withoutPersianMineAdit(withoutMilitaryTowers(original, definition.id), definition));
  const body = classifyNationBody(structure), centre = bodyCenter(body.walls);
  const rounded = usesPersianRoundedMassing(definition, body);
  const limit = getRomanRecipeBounds(definition, original);
  const primary = [...body.roofs].filter(roof => !roof.round).sort((a, b) =>
    (b.max[0] - b.min[0]) * (b.max[2] - b.min[2]) - (a.max[0] - a.min[0]) * (a.max[2] - a.min[2]))[0];
  const cupolas = nubianCupolaSites(body).filter(site => site.deck);
  const quoins = new Set(findQuoinStacks(body.keep, centre, body.walls).flatMap(stack => stack.blocks));
  const parts = body.keep.filter(part => {
    if (part.stock) return true;
    if (rounded && part.architecture && !(definition.id === 14 && part.surface === "wood")) return false;
    // Older civic roof plates and the lodge porch predate the architecture provenance tags.
    // They belong to the discarded rectangular shell, never to inventory or working equipment.
    if (rounded && MASONRY.has(part.surface) && part.shape === "box" && part.size[1] <= .10 &&
      part.position[1] > .95 && part.size[0] > .6 && part.size[2] > .6) return false;
    if (rounded && definition.id === 62 && part.position[1] > .45) return false;
    if (rounded && !keepPersianRoundedProp(part)) return false;
    if (definition.id === 14 && MASONRY.has(part.surface) && part.position[2] > .36 &&
      part.position[1] < 1.05 && Math.abs(part.position[0]) < .38) return false;
    if (rounded && part.shape === "box" && MASONRY.has(part.surface) &&
      Math.abs(part.size[0] - .62) < .001 && Math.abs(part.size[1] - .1) < .001 &&
      Math.abs(part.size[2] - .12) < .001) return false;
    if (rounded && definition.id === 37 && part.surface === "wood" && part.position[1] > 1.5 &&
      part.position[2] > .68 && Math.abs(part.position[0] + .52) < .2 && Math.max(...part.size) < .35)
      return false;
    const windowTrim = part.surface === "wood" && part.shape === "box" &&
      Math.min(part.size[0], part.size[2]) <= .04 && Math.max(part.size[0], part.size[2]) >= .07 &&
      (part.size[1] >= .15 || part.size[1] <= .05) ||
      MASONRY.has(part.surface) && part.shape === "box" && part.size[1] <= .05 &&
      Math.min(part.size[0], part.size[2]) <= .08 && Math.max(part.size[0], part.size[2]) >= .2;
    if (rounded && windowTrim && structure.parts.some(pane => !pane.stock && pane.surface === "dark" &&
      pane.shape === "box" && pane.size[1] > .12 && Math.min(...pane.size) <= .04 &&
      [0, 1, 2].every(axis => Math.abs(pane.position[axis]! - part.position[axis]!) < .36))) return false;
    const column = part.shape === "civic-column-shaft" || MASONRY.has(part.surface) &&
      part.shape === "cylinder" && part.size[1] > .4 && Math.max(part.size[0], part.size[2]) < .3;
    if (rounded && column && !body.roofs.some(roof => roof !== primary && !roof.round &&
      roof.min[2] < original.door[2] - .02 && part.position[0] >= roof.min[0] &&
      part.position[0] <= roof.max[0] && part.position[2] >= roof.min[2] && part.position[2] <= roof.max[2])) return false;
    if (quoins.has(part)) return false;
    const bounds = getRomanPartBounds(part);
    if (isInCupolaColumn(part, bounds, cupolas)) return false;
    if (MASONRY.has(part.surface) && part.stage === 4 && bounds.min[1] > .35) return false;
    if ((MASONRY.has(part.surface) || part.surface === "wood") && insideRoof(part, body.roofs, bounds)) return false;
    return true;
  }).map(part => {
    // The former rectangular upper floor poked through the curved lookout wall at its corners.
    // Keep its elevation and ladder contact while fitting the floor inside the real oval chamber.
    if (definition.id === 14 && part.surface === "wood" && part.shape === "box" &&
      Math.abs(part.size[0] - .91) < .001 && Math.abs(part.size[1] - .05) < .001 &&
      Math.abs(part.size[2] - .69) < .001)
      return { ...part, position: [part.position[0], part.position[1], -.035] as BuildingPart["position"],
        shape: "cylinder" as const, radialSegments: detailed ? 32 : 12, size: [.85, .05, .58] as BuildingPart["size"] };
    return resurface(part);
  });
  const context: KitContext = {
    add: part => {
      const built: BuildingPart = { stage: 1, ...part }, bounds = getRomanPartBounds(built);
      if (Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0])) > limit.extentX + .001 ||
        Math.max(Math.abs(bounds.min[2]), Math.abs(bounds.max[2])) > limit.extentZ + .001) return;
      parts.push(built);
    },
    center: centre, detailed, door: doorGapOf(original), lean: !detailed,
    limit, tower: definition.style === "tower", typeId: definition.id, walls: body.walls
  };
  if (!rounded) for (const wall of body.walls) addPersianWall(context, wall);
  parts.push(...body.doorSurround.filter(() => !rounded)
    .map(resurface));
  const main = body.roofs.reduce<typeof body.roofs[number] | undefined>((best, roof) =>
    !best || (roof.max[0] - roof.min[0]) * (roof.max[2] - roof.min[2]) >
      (best.max[0] - best.min[0]) * (best.max[2] - best.min[2]) ? roof : best, undefined);
  const used = rounded ? addPersianRoundedMassing(context, original, definition, body) : new Set();
  for (const roof of body.roofs) if (!used.has(roof))
    addPersianRoof(context, roof, definition, roof === main, cupolas.some(site => site.deck === roof));
  if (!rounded) for (const site of cupolas) if (site.deck) addPersianCupolaDrum(context, site.roof, site.deck);
  addPersianMilitaryTowers(context, original);
  if (!rounded) addPersianLookoutPiers(context);
  addPersianMineAdit(context);
  remountPersianOccupationSign(context, parts, body, rounded);
  if (body.walls.length && !isPersianMine(definition.id) && !rounded) {
    addPersianEntrance(context);
    if (detailed && [0, 6, 23, 29, 34, 57, 58, 59, 62].includes(definition.id)) {
      const door = context.door;
      for (const x of [door.left - .23, door.right + .23])
        addPersianRelief(context.add, [x, door.top + .25, door.z - .015], true);
    }
  }
  addPersianOccupationProps(context, definition, original, parts);
  if (!rounded && ![10, 11, 12, 13, 26, 27, 35].includes(definition.id)) addPersianWallTextile(context, parts);
  if ((rounded || definition.id === 2) && original.flagAnchor) {
    const [x, y, z] = original.flagAnchor, top = roofTopAt(parts, x, z, detailed);
    if (top !== null && y > top + .015) {
      if (definition.id === 2) {
        context.add({ position: [x, (y + top) / 2, z], shape: "cylinder",
          size: [.035, y - top, .035], stage: 3, surface: "wood" });
        context.add({ position: [x, top + .035, z], shape: "bevel-box",
          size: [.13, .07, .13], stage: 3, surface: "plaster" });
      } else context.add({ position: [x, (y + top) / 2, z],
        shape: "bevel-box", size: [.13, y - top, .13], stage: 3, surface: "plaster" });
    }
  }
  return { ...original, parts };
};

/** The cobalt portal/band vocabulary is shared; every occupation retains its own structural massing. */
export const createPersianBuildingRecipe = (original: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean): BuildingRecipe => withPersianStripedAwning(withPersianWindowOpenings(withPersianBlueTrim(
  withPersianClosedVaultJoins(buildPersianBuildingRecipe(original, definition, detailed), definition.id))),
  original, definition, detailed);
