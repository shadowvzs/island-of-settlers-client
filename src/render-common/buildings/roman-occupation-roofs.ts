import { DMath } from "../../shared/math/deterministic-math";
import { WOODCUTTER_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { addRomanRoofTiles } from "./roman-roof-tiles";

export const ROMAN_OCCUPATION_ROOF_IDS = [17] as const;

type AddRoofPart = (surface: BuildingPart["surface"], position: Point3, size: Point3,
  shape?: BuildingPart["shape"], rotation?: Point3, stage?: number) => BuildingPart;

/** Woodcutter authoring frame, before the shared 0.18 ground drop. */
const WOODCUTTER = {
  baseY: 1.425, // top of the stone wall plate
  depth: 1.43,
  gableFace: .6,
  leftEaveX: -1,
  leftPitch: .32,
  rightEaveX: .864,
  rightPitch: .5,
  roofThickness: .065,
  wallHalfWidth: .82,
  wallPlateHalfWidth: .845
} as const;

const PORCH = {
  eaveZ: 1.055,
  pitch: .3,
  postHeightBase: .18,
  postXs: [-1.04, -.38],
  postZ: 1.03,
  timber: .06,
  wallY: 1.26,
  wallZ: .63,
  xMax: -.3,
  xMin: -1.075
} as const;

/** Both pitches rest on the wall-plate edges, so their undersides meet above one ridge point. */
const getWoodcutterRidge = () => {
  const { leftPitch, rightPitch, wallHalfWidth } = WOODCUTTER;
  const left = DMath.tan(leftPitch), right = DMath.tan(rightPitch);
  const x = wallHalfWidth * (right - left) / (left + right);
  return { rise: (x + wallHalfWidth) * left, x };
};

/**
 * A slab sloping along X whose underside line passes through (pivotX, pivotY).
 * `fromX` and `toX` are the horizontal extent of the underside.
 */
const addSlopeAlongX = (add: AddRoofPart, fromX: number, toX: number, pivotX: number,
  pivotY: number, slope: number) => {
  const { depth, gableFace, roofThickness } = WOODCUTTER;
  const angle = DMath.atan(slope), midX = (fromX + toX) / 2;
  const underside = pivotY + (midX - pivotX) * slope;
  const normal: Point3 = [-DMath.sin(angle), DMath.cos(angle), 0];
  const length = Math.abs(toX - fromX) / DMath.cos(angle);
  const rotation: Point3 = [0, 0, angle];
  const offset = (distance: number): Point3 =>
    [midX + normal[0] * distance, underside + normal[1] * distance, 0];
  add("roof", offset(roofThickness / 2), [length, roofThickness, depth], "box", rotation);
  // Verge rafters hang from the slab directly against both gable faces.
  for (const end of [-1, 1]) {
    const [x, y] = offset(-.0275);
    add("wood", [x, y, end * (gableFace + .0325)], [length, .055, .065], "box", rotation, 2).roofSupport = true;
  }
};

const addWoodcutterMainRoof = (add: AddRoofPart) => {
  const { baseY, depth, leftEaveX, leftPitch, rightEaveX, rightPitch, wallHalfWidth } = WOODCUTTER;
  const ridge = getWoodcutterRidge(), overlap = .03;
  addSlopeAlongX(add, leftEaveX, ridge.x + overlap, -wallHalfWidth, baseY, DMath.tan(leftPitch));
  addSlopeAlongX(add, ridge.x - overlap, rightEaveX, wallHalfWidth, baseY, -DMath.tan(rightPitch));
  add("roof", [ridge.x, baseY + ridge.rise + .085, 0], [.09, depth, .09], "cylinder",
    [Math.PI / 2, 0, 0]);
};

/** Solid gables fill the full wall-plate-to-ridge triangle, flush with the plate face. */
const addWoodcutterGables = (add: AddRoofPart) => {
  const { baseY, gableFace, wallHalfWidth, wallPlateHalfWidth } = WOODCUTTER;
  const ridge = getWoodcutterRidge(), thickness = .11;
  for (const end of [-1, 1]) {
    const gable = add("stone", [0, baseY + ridge.rise / 2, end * (gableFace - thickness / 2)],
      [wallHalfWidth * 2, ridge.rise, thickness], "box", undefined, 3);
    gable.topScale = [.02, 1, 1];
    gable.topOffset = [ridge.x, 0, 0];
    // The complete occupation-roof replacement must remove this old tapered end too.
    gable.roofSupport = true;
    // Tie beam bedded on the wall plate; its ends tuck under both eave slabs.
    add("wood", [0, baseY + .025, end * gableFace], [wallPlateHalfWidth * 2, .05, .06],
      "box", undefined, 2).roofSupport = true;
  }
};

const porchUndersideY = (z: number) =>
  PORCH.wallY - (z - PORCH.wallZ) * DMath.tan(PORCH.pitch);

/** Log-store lean-to: ledger on the facade, front beam on two posts, slab falling away. */
const addWoodcutterPorch = (add: AddRoofPart) => {
  const { eaveZ, pitch, postHeightBase, postXs, postZ, timber, wallZ, xMax, xMin } = PORCH;
  const { roofThickness } = WOODCUTTER;
  const width = xMax - xMin, midX = (xMin + xMax) / 2, midZ = (wallZ + eaveZ) / 2;
  const rotation: Point3 = [Math.PI / 2, pitch - Math.PI / 2, -Math.PI / 2];
  const half = roofThickness / 2;
  add("roof", [midX, porchUndersideY(midZ) + half * DMath.cos(pitch), midZ + half * DMath.sin(pitch)],
    [(eaveZ - wallZ) / DMath.cos(pitch), roofThickness, width], "box", rotation);
  const ledgerZ = wallZ + timber / 2;
  for (const z of [ledgerZ, postZ])
    add("wood", [midX, porchUndersideY(z) - timber / 2, z], [width - .02, timber, timber],
      "box", undefined, 2);
  const postTop = porchUndersideY(postZ) - timber;
  for (const x of postXs)
    add("wood", [x, (postHeightBase + postTop) / 2, postZ], [timber, postTop - postHeightBase, timber],
      "box", undefined, 2);
};

/** Roof-only revision, applied after original anchoring and ware fitting. */
export const applyRomanOccupationRoofs = (id: number, recipe: BuildingRecipe, detailed: boolean) => {
  if (!(ROMAN_OCCUPATION_ROOF_IDS as readonly number[]).includes(id)) return;
  const offset = recipe.modelOriginOffset ?? [0, 0, 0];
  const add: AddRoofPart = (surface, position, size, shape = "box", rotation, stage = 4) => {
    const piece: BuildingPart = { surface, shape, size, stage, rotation,
      position: [position[0] + offset[0], position[1] - .18, position[2] + offset[2]] };
    recipe.parts.push(piece);
    return piece;
  };
  // Keep all non-roof architecture, doors, inventory and animal markers unchanged.
  recipe.parts = recipe.parts.filter(piece => !(piece.surface === "roof" && piece.stage === 4) &&
    !(piece.surface === "stone" && piece.stage === 4) && piece.shape !== "gable");
  if (id === WOODCUTTER_TYPE_ID) {
    // Offset ridge and unequal pitches, with an attached open timber storage shelter.
    addWoodcutterMainRoof(add);
    addWoodcutterGables(add);
    addWoodcutterPorch(add);
  }
  if (detailed) addRomanRoofTiles({ detailed, parts: recipe.parts, roof: () => {},
    part: (surface, position, size, stage = 2, shape = "box", rotation, tint) => {
      recipe.parts.push({ surface, position, size, stage, shape, rotation, tint });
    } });
};
