import { HEADQUARTERS_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds } from "./building-recipe-fit";
import { classifyNationBody, type NationBody, type WallRun } from "./nation-kit-classify";
import { bodyCenter, wallNormal } from "./nation-kit-parts";
import { vikingRoofFrame } from "./nation-kit-viking";
import {
type Bounds, type DecorSite, type FaceSide,   fitsSite, hiddenSidePenalty, isBacked, type WallFace
} from "./nubian-decor-faces";
import {
type VikingAssembly,   vikingAssembly, type VikingDecorKind, type VikingSpot
} from "./viking-decor-props";

/** Viking HQ: type 0. */

/**
 * Wall ornaments per occupation (measured against the 9,800 High / 2,300 Minimal budgets with
 * tools/bench/viking-decor-review.ts): weapon trophies on the warriors' halls, helmets on halls of
 * feasting, longship carvings at the yards. Every kind also has a cheap Minimal form.
 */
const DECOR_PLANS: Readonly<Record<number, readonly VikingDecorKind[]>> = {
  1: ["axe-trophy", "antler-helmet"], 2: ["axe-trophy", "winged-helmet"], 9: ["axe-trophy"],
  24: ["double-axe-trophy", "axe-trophy"], 36: ["longship-relief"], 39: ["longship-relief"], 40: ["antler-helmet"]
};

const SIDE_RANK: Readonly<Record<FaceSide, number>> = { back: 4, front: 0, side: 1 };
const FACE_YAW: Readonly<Record<string, number>> = { "0:-1": -Math.PI / 2, "0:1": Math.PI / 2, "2:-1": Math.PI, "2:1": 0 };
const ALONG_STEP = .04;

const faceSide = (axis: 0 | 2, sign: 1 | -1): FaceSide => {
  if (axis === 0) return "side";
  return sign > 0 ? "front" : "back";
};

/** The outer face of a rebuilt wall run (stave planks or logs stand on the Roman wall line). */
const wallFace = (wall: WallRun, center: Point3): WallFace => {
  const normal = wallNormal(wall, center), axis = normal.axis as 0 | 2, sign = normal.sign as 1 | -1;
  const plane = (wall.min[axis]! + wall.max[axis]!) / 2 + sign * normal.thickness / 2;
  return { along: wall.along, axis, base: wall.base, from: wall.min[wall.along]!, plane, side: faceSide(axis, sign), sign,
    to: wall.max[wall.along]!, top: wall.base + wall.height, yaw: FACE_YAW[`${axis}:${sign}`]! };
};

/** Lower is better: front walls beside the door first, then the side walls (+X first) near their front corner. */
const spotScore = (face: WallFace, along: number, doorCenter: number) => {
  if (face.side === "front") return SIDE_RANK.front + Math.abs(Math.abs(along - doorCenter) - .55);
  const rank = SIDE_RANK[face.side] + hiddenSidePenalty(face);
  return rank + (face.side === "side" ? face.to - along : Math.abs(along - (face.from + face.to) / 2));
};

interface Placement { assembly: VikingAssembly; spot: VikingSpot }
interface Candidate extends Placement { score: number }

const DROPS = [.3, .38, .46, .54] as const;

/** The first drop below the eaves where the ornament fits a free, backed spot, or null. */
const hangAt = (kind: VikingDecorKind, spot: Omit<VikingSpot, "y">, site: DecorSite): Placement | null => {
  for (const drop of DROPS) {
    const placed = { ...spot, y: spot.face.top - drop }, assembly = vikingAssembly(kind, placed);
    if (fitsSite(spot.face, assembly.occupied, site) && isBacked(spot.face, assembly.occupied, site)) {
      return { assembly, spot: placed };
    }
  }
  return null;
};

/** The best free, backed spot for one authored-size ornament on any face, or null when no wall has room. */
const placeOrnament = (kind: VikingDecorKind, faces: readonly WallFace[], site: DecorSite, detailed: boolean,
  doorCenter: number) => {
  let best: Candidate | null = null;
  for (const face of faces) for (let along = face.from + ALONG_STEP; along < face.to; along += ALONG_STEP) {
    const score = spotScore(face, along, doorCenter);
    if (best && score >= best.score) continue;
    const placement = hangAt(kind, { along, detailed, face, scale: 1 }, site);
    if (placement) best = { ...placement, score };
  }
  return best;
};

/**
 * Enlargement passes (owner 2026-10-13: about 1.2×, at most 1.3×), largest first in each pass. Every
 * ornament first grows towards 1.2×, only then towards 1.3×, so one trophy does not take a neighbour's room.
 */
const ENLARGEMENT_PASSES = [[1.2, 1.15, 1.1], [1.3, 1.25]] as const;
/** How far along its wall an enlarged ornament may slide off its authored spot. */
const ENLARGE_SLIDE = [0, -.04, .04, -.08, .08, -.12, .12] as const;

/** The ornament at the largest listed size its wall spot has room for (unchanged when none fits). */
const enlarge = (kind: VikingDecorKind, placed: Placement, scales: readonly number[], site: DecorSite) => {
  for (const scale of scales.filter(size => size > placed.spot.scale)) for (const slide of ENLARGE_SLIDE) {
    const larger = hangAt(kind, { ...placed.spot, along: placed.spot.along + slide, scale }, site);
    if (larger) return larger;
  }
  return placed;
};

interface PlacedOrnament { kind: VikingDecorKind; placement: Placement }

/** Grows each placed ornament in turn, checked against the recipe and every other ornament's current box. */
const enlargeAll = (placed: PlacedOrnament[], recipeBoxes: readonly Bounds[], site: DecorSite) => {
  for (const scales of ENLARGEMENT_PASSES) placed.forEach(({ kind, placement }, index) => {
    const others = placed.filter((_, other) => other !== index).map(other => other.placement.assembly.occupied);
    placed[index] = { kind, placement: enlarge(kind, placement, scales, { ...site, boxes: [...recipeBoxes, ...others] }) };
  });
  return placed;
};

const addWallOrnaments = (recipe: BuildingRecipe, body: NationBody, kinds: readonly VikingDecorKind[],
  detailed: boolean, limit: DecorSite["limit"]) => {
  const center = bodyCenter(body.walls), faces = body.walls.map(wall => wallFace(wall, center));
  const recipeBoxes = recipe.parts.map(part => getRomanPartBounds(part));
  const site: DecorSite = { boxes: [...recipeBoxes], limit, recipe,
    walls: body.walls.map(({ max, min }) => ({ max, min })) };
  const doorCenter = recipe.door[0] + (recipe.doorDimensions?.width ?? .46) / 2;
  // Every ornament first claims its authored-size spot, so enlarging one never costs another its place.
  const placed = kinds.flatMap(kind => {
    const placement = placeOrnament(kind, faces, site, detailed, doorCenter);
    if (!placement) return [];
    site.boxes.push(placement.assembly.occupied);
    return [{ kind, placement }];
  });
  return enlargeAll(placed, recipeBoxes, site)
    .flatMap(({ placement }) => placement.assembly.parts.map(part => ({ ...part, nationDecor: true })));
};

/** The flag cloth hangs this high above the anchor; its own pole reaches this far below it. */
const FLAG_POLE_DROP = .2;
const FLAG_MAST = { radius: .028, rise: .16 } as const;

/**
 * The player flag flies from a mast on the porch ridge, in front of the hall and below the pavilion
 * eaves, where it reads at gameplay distance (its wind sweep stays inside the plot).
 */
const porchFlag = (body: NationBody) => {
  const porch = body.roofs.reduce((front, roof) => roof.min[2] > front.min[2] ? roof : front);
  const { at, eave, rise } = vikingRoofFrame(porch), foot = at(0, 0, eave + rise + .02);
  const anchor: Point3 = [foot[0], foot[1] + FLAG_MAST.rise + FLAG_POLE_DROP, foot[2]];
  const mast: BuildingPart = { position: [foot[0], foot[1] + FLAG_MAST.rise / 2 + .03, foot[2]], radialSegments: 8,
    shape: "cylinder", size: [FLAG_MAST.radius * 2, FLAG_MAST.rise + .06, FLAG_MAST.radius * 2], stage: 4,
    surface: "wood" };
  return { anchor, mast };
};

/**
 * Viking ornaments: a ridge flag mast at the headquarters (Thor crowns its tower, see
 * viking-headquarters.ts) and wall trophies (shields with bearded or two-bladed axes, antlered or
 * winged helmets, longship carvings) where the occupation fits. Gable dragons are part of the
 * roofs (nation-kit-viking.ts).
 */
export const addVikingDecor = (recipe: BuildingRecipe, original: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean, limit: DecorSite["limit"]): BuildingRecipe => {
  const body = classifyNationBody(original);
  if (definition.id === HEADQUARTERS_TYPE_ID) {
    const flag = porchFlag(body);
    return { ...recipe, flagAnchor: flag.anchor, parts: [...recipe.parts, flag.mast] };
  }
  const kinds = DECOR_PLANS[definition.id];
  if (!kinds || !body.walls.length) return recipe;
  return { ...recipe, parts: [...recipe.parts, ...addWallOrnaments(recipe, body, kinds, detailed, limit)] };
};
