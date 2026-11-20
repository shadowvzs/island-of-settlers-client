import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "./building-recipe-fit";
import { withoutRomanCupola } from "./headquarters-cupola";
import { addIndigenousWorkProps } from "./indigenous-building-props";
import { addIndigenousRoof, type IndigenousRoofStyle } from "./indigenous-building-roofs";
import { addIndigenousFortCamp } from "./indigenous-fort-camp";
import { addIndigenousFramedBody } from "./indigenous-framed-body";
import { createIndigenousHeadquartersRecipe } from "./indigenous-headquarters";
import { addIndigenousLodge, isIndigenousLodgeProp } from "./indigenous-lodges";
import {
  addIndigenousHarbourLookout, addIndigenousMillFrame, addIndigenousScoutLoft, isIndigenousHarbourArchitecture
} from "./indigenous-machinery";
import { addIndigenousMilitary } from "./indigenous-military";
import { indigenousMonumentRecipe } from "./indigenous-monument";
import { clearIndigenousInheritedProps } from "./indigenous-prop-clearance";
import { addIndigenousResourceWalls, mountIndigenousQuarryToolsInside } from "./indigenous-resource-workshops";
import { indigenousShelterLayout } from "./indigenous-shelter-layout";
import { addIndigenousShipyardWalls } from "./indigenous-shipyard-walls";
import { withIndigenousTanneryBench } from "./indigenous-tannery-bench";
import { indigenousWellRecipe } from "./indigenous-well";
import { classifyNationBody, type NationBody, type RoofEnvelope } from "./nation-kit-classify";
import { type Add, doorGapOf } from "./nation-kit-parts";
import { withoutMilitaryTowers } from "./nation-kit-towers";

const TIPIS = new Set([1, 3, 8, 17, 20, 22, 57, 58]);
const OPEN_WORK_AREAS = new Set([18, 35, 36]);
// These occupations are already identified by their working gear; no extra painted badge is added.
const REED_WALL_WORKSHOPS = new Set([6, 17, 26, 33]);
const MILITARY = new Set([1, 2, 4, 9, 14, 40]);
const HOT_TRADES = new Set([24, 25, 26, 27, 32, 34]);

/** Membrane construction is the shared identity; occupation equipment and shelter proportions vary. */
export const indigenousBuildingStyle = (id: number): IndigenousRoofStyle => {
  if (TIPIS.has(id)) return { profile: "tipi", rise: 1.15, surface: "cloth" };
  if (id === 18) return { profile: "barrel", rise: .58, surface: "cloth" };
  if (OPEN_WORK_AREAS.has(id)) return { profile: "awning", rise: .4, surface: "cloth" };
  return { profile: "earth", rise: .55, surface: "cloth" };
};

const isFunctionalPart = (part: BuildingPart, original: BuildingRecipe, definition: BuildingDefinition) => {
  if (part.stock) return true;
  if ([19, 20].includes(definition.id) && part.workyardAssembly) return true;
  if (HOT_TRADES.has(definition.id) && (part.fireboxMouth || part.fireboxInterior)) return true;
  if (definition.id === 23 && part.stage === 0 && part.surface === "dark") return false;
  // Lookouts and tent barracks are wholly authored below; former balcony/shaft furniture would float.
  if (MILITARY.has(definition.id)) return false;
  if (definition.id === 39 && isIndigenousHarbourArchitecture(part)) return false;
  if (part.surface === "gold" || part.shape === "civic-column-shaft" || part.militaryTower) return false;
  if (definition.id === 0 && ["wood", "planks"].includes(part.surface) && part.position[1] > 1) return false;
  if (["stone", "cut-stone", "plaster", "mosaic"].includes(part.surface)) {
    if (part.position[1] + part.size[1] / 2 < .15) return true;
    return HOT_TRADES.has(definition.id) &&
      Math.hypot(part.position[0] - original.mechanism[0], part.position[2] - original.mechanism[2]) < .5;
  }
  // Fire mouths belong to retained working ovens, rather than the replaced Roman wall windows.
  if (HOT_TRADES.has(definition.id) && (part.windowShadow || part.shape === "window-shadow") &&
    part.position[1] < .8 && Math.hypot(part.position[0] - original.mechanism[0],
      part.position[2] - original.mechanism[2]) < .5) return true;
  if (part.surface === "dark" && part.size[1] > .12 && Math.min(...part.size) < .06) return false;
  if (part.surface === "paint" && Math.min(...part.size) < .025 && part.position[1] > .35) return false;
  // Craft benches and equipment survive, while detached former eave trim does not.
  return isIndigenousLodgeProp(part);
};

const resurface = (part: BuildingPart): BuildingPart => {
  if (part.stock) return part;
  if (part.surface === "mosaic") return { ...part, surface: "planks" };
  return part;
};

/** A shelter occupies the original working body's envelope, with rounded sides and an open portal. */
const shelterBody = (body: NationBody): NationBody | null => {
  const lowerRoofs = body.roofs.filter(roof => roof.min[1] < 2);
  const walls = body.walls.filter(wall => wall.base < .2);
  const tunnelBounds = body.doorSurround.filter(part => Math.max(...part.size) > .9)
    .map(part => getRomanPartBounds(part));
  const points = [...(lowerRoofs.length ? lowerRoofs : walls), ...tunnelBounds];
  if (!points.length) return null;
  const roof: RoofEnvelope = { min: [Math.min(...points.map(point => point.min[0])), 0,
    Math.min(...points.map(point => point.min[2]))],
  max: [Math.max(...points.map(point => point.max[0])), 1.5,
    Math.max(...points.map(point => point.max[2]))] };
  return { ...body, roofs: [roof] };
};

const addPortal = (add: Add, original: BuildingRecipe, detailed: boolean) => {
  const door = doorGapOf(original);
  for (const x of [door.left - .045, door.right + .045]) add({
    position: [x, (door.top + .15) / 2, door.z], radialSegments: detailed ? 7 : 4,
    shape: "cylinder", size: [.035, door.top + .15, .035], stage: 2, surface: "wood"
  });
};

const addFlagMount = (add: Add, original: BuildingRecipe, typeId: number, detailed: boolean) => {
  if (!original.flagAnchor || original.hideFlag) return;
  const [x, y, z] = original.flagAnchor;
  const base = [4, 9].includes(typeId) ?
    Math.max(0, ...(original.archerPositions ?? []).map(position => position[1])) : 0;
  const height = Math.max(.08, y - base);
  add({ position: [x, base + height / 2, z], radialSegments: detailed ? 7 : 4,
    shape: "cylinder", size: [.025, height, .025], stage: 2, surface: "wood" });
};

/** Complete national set: rounded textile shelters and open lookouts on the canonical gameplay plan. */
export const createIndigenousBuildingRecipe = (sourceRecipe: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean): BuildingRecipe => {
  const original=definition.id===8?withIndigenousTanneryBench(sourceRecipe):sourceRecipe;
  if (definition.id === 0) return createIndigenousHeadquartersRecipe(original, detailed);
  if (definition.style === "well") return indigenousWellRecipe(original, detailed);
  if (definition.id === 7) return indigenousMonumentRecipe(detailed);
  const hall = definition.id === 0 ? withoutRomanCupola(original) : original;
  const source = withoutMilitaryTowers(hall, definition.id), body = classifyNationBody(source);
  const style = indigenousBuildingStyle(definition.id), limit = getRomanRecipeBounds(definition, original);
  const parts: BuildingPart[] = original.parts.filter(part => part.stock);
  parts.push(...body.keep.filter(part => !part.stock && isFunctionalPart(part, original, definition)).map(resurface));
  if (definition.id === 19) mountIndigenousQuarryToolsInside(parts);
  const inherited = new Set(parts.filter(part => !part.stock));
  const add: Add = part => {
    const built: BuildingPart = { compactGeometry: true, stage: 1, ...part }, bounds = getRomanPartBounds(built);
    if (Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0])) > limit.extentX + .001 ||
      Math.max(Math.abs(bounds.min[2]), Math.abs(bounds.max[2])) > limit.extentZ + .001) return;
    parts.push(built);
  };
  const { shelter, yards } = indigenousShelterLayout(body, shelterBody(body), original, definition.id);
  const reedWorkshop = REED_WALL_WORKSHOPS.has(definition.id);
  const resourceRoom = definition.id === 19 || definition.id === 20;
  if (resourceRoom) {
    addIndigenousResourceWalls(add, original, body, detailed, definition.id === 19);
    for (const roof of body.roofs.filter(roof => roof.min[1] < 2))
      addIndigenousRoof(add, roof, { profile: "awning", rise: .4, surface: "cloth" }, detailed, true);
  } else if (reedWorkshop) {
    addIndigenousShipyardWalls(add, original, body);
    const covers = body.roofs.filter(roof => roof.min[1] < 2);
    // The drink yard adjoins the room. One continuous weather cover avoids the former
    // taller narrow gable projecting through the neighbouring broad cloth roof.
    const joined = definition.id === 6 && covers.length > 1;
    const roofs = joined ? [{
      min: [Math.min(...covers.map(roof => roof.min[0])), Math.min(...covers.map(roof => roof.min[1])),
        Math.min(...covers.map(roof => roof.min[2]))] as [number, number, number],
      max: [Math.max(...covers.map(roof => roof.max[0])), Math.max(...covers.map(roof => roof.max[1])),
        Math.max(...covers.map(roof => roof.max[2]))] as [number, number, number]
    }] : covers;
    for (const roof of roofs)
      addIndigenousRoof(add, roof, { profile: "awning", rise: .4, surface: "cloth" }, detailed, true);
  } else if (definition.id === 4) {
    addIndigenousFramedBody(add, original, [0, 0, 0], [1.3, 2.555, 1.12], detailed);
  } else if (definition.id === 14) {
    addIndigenousFramedBody(add, original, [0, 0, .06], [1.05, 1.715, .88], detailed);
  } else if (definition.id === 9) addIndigenousFortCamp(add, original, body, detailed);
  else if (shelter && !OPEN_WORK_AREAS.has(definition.id)) {
    let cap: number | undefined;
    if (MILITARY.has(definition.id)) cap = 1.65;
    if (definition.id === 31) cap = 2.40;
    let authoredRise: number | undefined;
    if (definition.id === 14) { cap = 1.72; authoredRise = 1.72; }
    if (definition.id === 31) authoredRise = 2.40;
    addIndigenousLodge(add, original, shelter, style.profile !== "tipi", detailed, cap, authoredRise);
  } else for (const roof of body.roofs.filter(roof => roof.min[1] < 2))
    addIndigenousRoof(add, roof, style, detailed, true);
  if (!resourceRoom && !reedWorkshop && !OPEN_WORK_AREAS.has(definition.id) && !MILITARY.has(definition.id))
    for (const roof of yards) addIndigenousRoof(add, roof,
      { profile: "awning", rise: .3, surface: "cloth" }, detailed, false);
  if (definition.id === 36) addIndigenousShipyardWalls(add, original, body);
  if (definition.id === 31) addIndigenousMillFrame(add, original, detailed);
  if (definition.id === 14) addIndigenousScoutLoft(add, original, detailed);
  if (definition.id === 39) addIndigenousHarbourLookout(add, detailed);
  if (MILITARY.has(definition.id)) addIndigenousMilitary(add, original, definition.id, detailed);
  if (!shelter) addPortal(add, original, detailed);
  addFlagMount(add, original, definition.id, detailed);
  if (definition.id === 23) {
    // The unchanged copper boiling vessel used to rest on Roman masonry. Rebuild its hearth.
    const [x, , z] = original.mechanism;
    add({ position: [x, .23, z], radialSegments: detailed ? 14 : 7,
      shape: "cylinder", size: [.43, .46, .43], stage: 1, surface: "stone" });
    add({ position: [x, .455, z], radialSegments: detailed ? 14 : 7,
      shape: "ring", size: [.46, .045, .46], stage: 2, surface: "iron" });
  }
  const cleared = clearIndigenousInheritedProps(parts, inherited);
  parts.splice(0, parts.length, ...cleared);
  addIndigenousWorkProps(add, parts, original, definition, limit, detailed);
  return { ...original, parts, tentDoor: definition.id !== 19,
    hideBalconyDoor: definition.id === 14 || original.hideBalconyDoor,
    hideDoor: definition.id === 18 || original.hideDoor };
};
