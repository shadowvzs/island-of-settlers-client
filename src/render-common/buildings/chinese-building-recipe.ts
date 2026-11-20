import { HARBOUR_TYPE_ID, MILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "./building-recipe-fit";
import { chineseObsoleteAtticWindows } from "./chinese-attic-window-fit";
import { addChineseWorkProps } from "./chinese-building-props";
import {
  addChineseBracket, addChineseRoof, CHINESE_TIMBER, chineseRoofSurface
} from "./chinese-building-roofs";
import { addChineseTowerPavilions } from "./chinese-building-towers";
import {
  addChineseHarbourTowerFlashing, addChineseHarbourTowerShell, chineseHarbourTowerBlocks,
  fitChineseHarbourHallRoof, isChineseHarbourTowerCourse
} from "./chinese-harbour-roof";
import { addChineseHeadquarters } from "./chinese-headquarters";
import { chineseMonumentRecipe } from "./chinese-monument";
import {
  addChineseGableWallBearings, fitChineseFarmWingBearings, fitChineseHeadquartersBearings, seatChineseRoofPurlins
} from "./chinese-roof-bearings";
import { addChineseSpecialStructure, chineseSpecialStructureSource } from "./chinese-special-structures";
import { withoutRomanCupola } from "./headquarters-cupola";
import { roofTopAt } from "./levels/level-roof-surface";
import { classifyNationBody, type NationBody, type WallRun } from "./nation-kit-classify";
import {
type Add,   alongWall, bodyCenter, doorGapOf, insideRoof, onWall, timberDoorFrame, wallNormal
} from "./nation-kit-parts";
import { normalizeMirroredRoofPlan } from "./nation-kit-roof-plan";
import { withoutMilitaryTowers } from "./nation-kit-towers";
import { createNationWellRecipe } from "./nation-well-designs";

const MASONRY = new Set<BuildingPart["surface"]>(["stone", "cut-stone", "plaster"]);
const CIVIC_HALLS = new Set([0, 2, 9, 24, 29, 34, 39, 40, 59, 62]);
const IVORY: Point3 = [.94, .91, .83];
const RAMMED_EARTH: Point3 = [.88, .83, .72];

/** Specialist goods keep their mineral colours; the hall's plaster retains its national palette. */
export const withChinesePlasterPalette = (recipe: BuildingRecipe): BuildingRecipe => ({ ...recipe,
  parts: recipe.parts.map(part => !part.stock && part.surface === "plaster"
    ? { ...part, tint: RAMMED_EARTH } : part)
});
const WINDOW = { jambWidth: .045, jambHeight: .37 };

/** Existing quoin stacks, roof cornices and gable infill belong to Rome, not the new timber frame. */
const keepChinesePart = (part: BuildingPart, body: NationBody, original: BuildingRecipe) => {
  if (part.occupationSign) return false;
  if (part.stock || part.militaryTower) return true;
  if (MASONRY.has(part.surface) && part.shape === "box" && part.size.every(size => size <= .15) &&
    Math.abs(part.position[2] - original.door[2]) < .16 &&
    Math.abs(part.position[0] - original.door[0] - .23) < .4 && part.position[1] > .55) return false;
  if (MASONRY.has(part.surface) && part.stage === 4 && part.position[1] > .25) return false;
  if (MASONRY.has(part.surface) && part.shape === "box" && Math.abs(part.size[0] - WINDOW.jambWidth) < .002 &&
    Math.abs(part.size[1] - WINDOW.jambHeight) < .002 && Math.abs(part.size[2] - WINDOW.jambWidth) < .002) return false;
  return !MASONRY.has(part.surface) || !insideRoof(part, body.roofs, getRomanPartBounds(part));
};

const chinesePart = (part: BuildingPart, civic: boolean): BuildingPart => {
  if (part.stock) return part;
  if (part.shape === "civic-column-shaft") return { ...part, radialSegments: 12, shape: "cylinder",
    surface: "paint", tint: CHINESE_TIMBER };
  if (part.shape === "cylinder" && !part.rotation && Math.max(part.size[0], part.size[2]) < .25 &&
    part.size[1] > .08 && part.position[1] > .2 && MASONRY.has(part.surface))
    return { ...part, surface: "paint", tint: CHINESE_TIMBER };
  if (part.surface === "mosaic") return { ...part, surface: "planks", tint: undefined };
  if (part.surface === "paint" && part.size[1] < .11 && Math.max(part.size[0], part.size[2]) > .4)
    return { ...part, tint: CHINESE_TIMBER };
  if (MASONRY.has(part.surface)) {
    if (part.position[1] + part.size[1] / 2 < .2) return { ...part, surface: "cut-stone", tint: [.73, .72, .65] };
    return { ...part, surface: "plaster", tint: civic ? IVORY : RAMMED_EARTH };
  }
  return part;
};

const wallFrame = (add: Add, wall: WallRun, centre: Point3, detailed: boolean, civic: boolean,
  windows: readonly BuildingPart[], frontLimit = Infinity,
  blocked?: (at: Point3, radius: number) => boolean) => {
  const normal = wallNormal(wall, centre), face = normal.thickness / 2;
  const crossesWindow = (at: Point3, width: number, bottom: number, top: number) => windows.some(pane => {
    if (pane.surface !== "dark" || pane.stock || pane.size[1] <= .15 || pane.size[1] > .7 ||
      Math.min(pane.size[0], pane.size[2]) >= .06) return false;
    return Math.abs(at[normal.axis]! - pane.position[normal.axis]!) < .14 &&
      Math.abs(at[wall.along] - pane.position[wall.along]) < (width + pane.size[wall.along]) / 2 &&
      top > pane.position[1] - pane.size[1] / 2 && bottom < pane.position[1] + pane.size[1] / 2;
  });
  add({ position: onWall(wall, centre, .5, wall.base + wall.height / 2), shape: "box",
    size: alongWall(wall, wall.length, wall.height, normal.thickness), stage: 1,
    surface: "plaster", tint: civic ? IVORY : RAMMED_EARTH });
  const bays = Math.max(1, Math.round(wall.length / (detailed ? .62 : 1.05)));
  for (let index = 0; index <= bays; index++) {
    const share = .035 + .93 * index / bays;
    const at = onWall(wall, centre, share, wall.base + wall.height / 2, face - .018);
    if (!crossesWindow(at, .075, wall.base, wall.base + wall.height) && !blocked?.(at, .04))
      add({ position: at, radialSegments: detailed ? 10 : 5, shape: "cylinder",
        size: [.075, wall.height, .075], stage: 2, surface: "paint", tint: CHINESE_TIMBER });
    if (wall.length > .35 && wall.height > .55) {
      const top = onWall(wall, centre, share, wall.base + wall.height - .19, face - .03);
      const scale = civic ? .9 : .7;
      if (!crossesWindow(top, .30 * scale, top[1] - .033 * scale, top[1] + .16 * scale) &&
        !blocked?.(top, .18 * scale))
        addChineseBracket(add, top, wall.along === 0 ? 0 : Math.PI / 2, detailed, scale, frontLimit);
    }
  }
  for (const y of [wall.base + .1, wall.base + wall.height - .04])
    add({ position: onWall(wall, centre, .5, y, face - .01), shape: "box",
      size: alongWall(wall, wall.length, .07, .055), stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  if (!detailed || wall.length < .6 || wall.base > .1) return;
  add({ position: onWall(wall, centre, .5, wall.base + .17), shape: "box",
    size: alongWall(wall, wall.length, .24, normal.thickness + .015), stage: 1,
    surface: "cut-stone", tint: [.66, .65, .59] });
};

/** A timber lattice is fitted directly over the original window recess, leaving its depth unchanged. */
const addChineseWindowLattice = (add: Add, part: BuildingPart, body: NationBody, detailed: boolean) => {
  if (part.surface !== "dark" || part.stock || Math.min(...part.size) > .04 || part.size[1] < .15) return;
  const wall = body.walls.find(run => {
    const axis = run.along === 0 ? 2 : 0;
    return Math.abs(part.position[axis]! - (run.min[axis]! + run.max[axis]!) / 2) < .14 &&
      part.position[run.along]! >= run.min[run.along]! && part.position[run.along]! <= run.max[run.along]!;
  });
  if (!wall) return;
  const normal = wallNormal(wall, bodyCenter(body.walls)), along = wall.along, across = normal.axis;
  const width = part.size[along]!, height = part.size[1], face = part.position[across]! + normal.sign * .025;
  const stick = (offset: number, y: number, length: number, tall: number) => {
    const position = [...part.position] as Point3, size: Point3 = [.025, tall, .025];
    position[along] += offset; position[across] = face; position[1] = y; size[along] = length;
    add({ position, shape: "box", size, stage: 2, surface: "paint", tint: CHINESE_TIMBER });
  };
  for (const side of [-1, 1]) {
    stick(side * (width / 2 + .018), part.position[1], .035, height + .07);
    stick(0, part.position[1] + side * (height / 2 + .018), width, .035);
  }
  const count = detailed ? 3 : 1;
  for (let index = 1; index <= count; index++)
    stick(-width / 2 + width * index / (count + 1), part.position[1], .015, height);
  if (detailed) stick(0, part.position[1], width, .015);
};

/** Each canonical occupation receives original Chinese architecture and retained working equipment. */
export const createChineseBuildingRecipe = (original: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean): BuildingRecipe => {
  if (definition.id === 7) return chineseMonumentRecipe(detailed);
  if (definition.id === 35) return createNationWellRecipe(original, "chinese", detailed);
  const hall = definition.id === 0 ? withoutRomanCupola(original) : original;
  const source = chineseSpecialStructureSource(withoutMilitaryTowers(normalizeMirroredRoofPlan(hall), definition.id), definition.id);
  const body = classifyNationBody(source), civic = CIVIC_HALLS.has(definition.id);
  const limit = getRomanRecipeBounds(definition, original), centre = bodyCenter(body.walls);
  const obsoleteAttic = chineseObsoleteAtticWindows(body, definition.id);
  const towerCourses = new Set([...body.keep, ...body.doorSurround].filter(isChineseHarbourTowerCourse));
  const parts: BuildingPart[] = body.keep
    .filter(part => !obsoleteAttic.has(part) && !towerCourses.has(part) && keepChinesePart(part, body, original))
    .map(part => chinesePart(part, civic));
  const add: Add = part => {
    const built: BuildingPart = { compactGeometry: true, stage: 1, ...part };
    const bounds = getRomanPartBounds(built);
    if (Math.max(Math.abs(bounds.min[0]), Math.abs(bounds.max[0])) > limit.extentX + .0001 ||
      Math.max(Math.abs(bounds.min[2]), Math.abs(bounds.max[2])) > limit.extentZ + .0001) return;
    parts.push(built);
  };
  const bracketFront = definition.id === MILL_TYPE_ID && detailed ? original.mechanism[2] - .012 : Infinity;
  const towerBlocked = definition.id === HARBOUR_TYPE_ID ? chineseHarbourTowerBlocks : undefined;
  for (const wall of body.walls)
    wallFrame(add, wall, centre, detailed, civic, body.keep, bracketFront, towerBlocked);
  parts.push(...body.doorSurround.filter(part => !towerCourses.has(part)).map(part => {
    if (part.shape === "arch-spandrel") return { ...part, surface: "paint" as const, tint: CHINESE_TIMBER };
    // The classifier also places structural tunnel and belfry rings in this collection.
    return { ...part, surface: "plaster" as const, tint: civic ? IVORY : RAMMED_EARTH };
  }));
  for (const roof of body.roofs) {
    const fit = fitChineseHarbourHallRoof(roof, definition.id);
    addChineseRoof(add, fit?.roof ?? roof, definition.id, detailed, civic, undefined, fit?.purlinShares);
  }
  addChineseHarbourTowerShell(add, definition.id, detailed, "plaster", civic ? IVORY : RAMMED_EARTH);
  addChineseHarbourTowerFlashing(add, definition.id, detailed, chineseRoofSurface(civic));
  if (definition.id === 0) addChineseHeadquarters(add, detailed);
  addChineseTowerPavilions(add, original, definition.id, detailed);
  addChineseSpecialStructure(add, original, definition.id, detailed);
  // The lower swept eaves cannot inherit tablets at the old Roman gable's height.
  const signs = source.parts.filter(part => part.occupationSign);
  const tablet = signs.find(part => part.surface === "stone");
  const frontWalls = body.walls.filter(wall => wall.along === 0 && wall.max[2] > original.door[2] - .14);
  if (tablet && frontWalls.length) {
    const top = Math.max(...frontWalls.map(wall => wall.max[1]));
    const yShift = Math.min(0, top - .19 - tablet.position[1]);
    for (const part of signs) add(chinesePart({ ...part,
      position: [part.position[0], part.position[1] + yShift, part.position[2]] }, civic));
  }
  if (definition.id !== 0 && original.flagAnchor && !original.hideFlag && body.walls.length) {
    const [x, top, z] = original.flagAnchor;
    const wall = frontWalls[0] ?? body.walls[0]!;
    const base = Math.min(wall.max[1] - .10, top - .22), height = top - .16 - base;
    if (height > .03) {
      add({ position: [x, base + height / 2, z], shape: "box", size: [.035, height, .035],
        stage: 2, surface: "paint", tint: CHINESE_TIMBER });
      add({ position: [x, base, (wall.max[2] + z) / 2], shape: "box",
        size: [.055, .055, Math.abs(z - wall.max[2]) + .08], stage: 2,
        surface: "paint", tint: CHINESE_TIMBER });
    }
  }
  for (const part of body.keep) if (!obsoleteAttic.has(part)) addChineseWindowLattice(add, part, body, detailed);
  if (body.walls.length) timberDoorFrame(add, doorGapOf(original), "wood");
  addChineseWorkProps(add, parts, original, definition, limit, detailed);
  let flagAnchor = original.flagAnchor;
  if (definition.id === 0 && flagAnchor) {
    const roof = roofTopAt(parts, 0, 0, detailed);
    if (roof !== null) flagAnchor = [0, roof + .20, 0];
  }
  let fitted = definition.id === 0 ? fitChineseHeadquartersBearings(parts, detailed) : parts;
  if (definition.id === 17) fitted = addChineseGableWallBearings(fitted, detailed);
  if (definition.id === 37) fitted = fitChineseFarmWingBearings(fitted, detailed);
  if (definition.id === HARBOUR_TYPE_ID) fitted = seatChineseRoofPurlins(fitted, detailed);
  if (definition.id === 0 && !detailed) {
    const floor = fitted.findIndex(part => !part.stock && part.shape === "box" && part.stage === 0 &&
      part.surface === "planks" && part.position[0] === 0 && part.position[2] === 0 &&
      Math.abs(part.position[1] - part.size[1] / 2) < 1e-8);
    // This underside is flush with the canonical graded ground; its top and four edges stay exact.
    if (floor >= 0) fitted[floor] = { ...fitted[floor]!, omitGroundBottom: true };
  }
  return { ...original, flagAnchor, parts: fitted };
};
