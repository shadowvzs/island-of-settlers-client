import { DMath } from "../../shared/math/deterministic-math";
import { MILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { SettlerNation as WorkerNation } from "../workers/worker-unit";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanPartBounds, getRomanRecipeBounds } from "./building-recipe-fit";
import { createNationKitRecipe } from "./nation-architecture-kit";
import type { RoofEnvelope } from "./nation-kit-classify";
import { japaneseRoof } from "./nation-kit-japanese";
import { type Add, doorGapOf, type KitContext,runBetween } from "./nation-kit-parts";
import { vikingRoof } from "./nation-kit-viking";
import { JAPANESE_ROOF_TINTS, japaneseRoofClass, japaneseRoofUnderside } from "./nation-roof-palette";
import { nationRoofMeshHeight } from "./nation-roof-profile";

type BuildNation = Exclude<WorkerNation, "roman">;
interface Plan { maxX: number; maxZ: number; minX: number; minZ: number }

/** Top of the Roman mill's ground storey (finished recipe space): the door storey every nation keeps. */
const GROUND_STOREY_TOP = 1.18;
/** Outer face of the ground storey's front wall. */
const FRONT_FACE = .438;
/**
 * The sails turn in front of the hub (0, 2.47, 0.47); their arms reach back to z 0.47. Everything
 * inside the sail disc stays behind this line.
 */
const SAIL_CLEAR_Z = .455;
/** Occupation pictogram: right of the door, below the sail disc and outside the entrance lane. */
const PICTOGRAM_CENTRE: Readonly<Point3> = [.376, .58, 0];
const SIGN_BOARD = { depth: .03, height: .21, standoff: .03, width: .33 } as const;
/** Nubian front windows between the door and the sails: a centre column and a flanking pair. */
const NUBIAN_WINDOWS: ReadonlyArray<readonly [number, number]> = [[0, 1.34], [0, 1.76], [-.3, 1.55], [.3, 1.55]];
const NUBIAN_UPPER_FACE = .437;

const isAxle = (part: BuildingPart, recipe: BuildingRecipe) => part.surface === "iron" &&
  Math.abs(part.position[1] - recipe.mechanism[1]) < .01;
const isPictogram = (part: BuildingPart) => !part.stock && part.surface === "paint" &&
  getRomanPartBounds(part).min[1] > GROUND_STOREY_TOP;

/** The Roman ground storey (walls, door, floor, stock and axle); the tapering tower and roof go. */
const groundStorey = (original: BuildingRecipe): BuildingRecipe => ({
  ...original,
  parts: original.parts.filter(part => part.stock || isAxle(part, original) ||
    getRomanPartBounds(part).max[1] <= GROUND_STOREY_TOP + .01)
});

/** A plank board on the ground-storey front carrying the kept occupation pictogram. */
const addSignBoard = (add: Add, original: BuildingRecipe) => {
  const pictogram = original.parts.filter(isPictogram);
  if (!pictogram.length) return;
  const back = FRONT_FACE + SIGN_BOARD.standoff, front = back + SIGN_BOARD.depth;
  add({ position: [PICTOGRAM_CENTRE[0], PICTOGRAM_CENTRE[1], back + SIGN_BOARD.depth / 2], shape: "bevel-box",
    size: [SIGN_BOARD.width, SIGN_BOARD.height, SIGN_BOARD.depth], stage: 3, surface: "wood" });
  const bounds = pictogram.map(part => getRomanPartBounds(part));
  const minY = Math.min(...bounds.map(bound => bound.min[1])), maxY = Math.max(...bounds.map(bound => bound.max[1]));
  const minZ = Math.min(...bounds.map(bound => bound.min[2]));
  const shift: Point3 = [PICTOGRAM_CENTRE[0], PICTOGRAM_CENTRE[1] - (minY + maxY) / 2, front + .001 - minZ];
  for (const part of pictogram) add({ ...part,
    position: part.position.map((value, axis) => value + shift[axis]!) as Point3 });
};

const millContext = (original: BuildingRecipe, definition: BuildingDefinition, parts: BuildingPart[],
  detailed: boolean): KitContext => ({
  add: part => parts.push({ stage: 1, ...part }), center: [0, 0, 0], detailed, door: doorGapOf(original),
  lean: false, limit: getRomanRecipeBounds(definition, original), tower: false, typeId: MILL_TYPE_ID, walls: []
});

/** Viking post mill: body bottom/top half widths (it tapers), plan depth and storey heights. */
const POST_MILL = { bottom: 1.29, frontZ: .36, halfBottom: .56, halfTop: .46, rearZ: -.56, top: 2.17 } as const;

/** Turf-covered roundhouse roof on the stave ground storey, under the overhanging body. */
const addTurfCollar = (add: Add) => {
  const bottom = 1.15, height = .16, front = SAIL_CLEAR_Z - .005, rear = -.51;
  add({ position: [0, bottom + height / 2, (front + rear) / 2], shape: "box", size: [1.2, height, front - rear],
    stage: 3, surface: "leaf", tint: [.92, .86, .62], topOffset: [0, 0, -.04], topScale: [.72, 1, .72] });
};

/** Clapboard body tapering to the eaves, on sill beams, with leaning corner posts and a wall plate. */
const addPostMillBody = (add: Add, detailed: boolean) => {
  const { bottom, frontZ, halfBottom, halfTop, rearZ, top } = POST_MILL;
  const height = top - bottom, depth = frontZ - rearZ, centreZ = (frontZ + rearZ) / 2;
  add({ position: [0, bottom + height / 2, centreZ], shape: "box", size: [halfBottom * 2, height, depth],
    stage: 2, surface: "planks", topScale: [halfTop / halfBottom, 1, 1] });
  for (const [y, half] of [[bottom + .04, halfBottom + .02], [top - .03, halfTop + .03]] as const)
    add({ position: [0, y, centreZ], shape: "bevel-box", size: [half * 2, .08, depth + .04], stage: 2,
      surface: "wood" });
  const lean = DMath.atan2(halfBottom - halfTop, height);
  for (const side of [-1, 1]) for (const z of [frontZ - .02, rearZ + .02])
    add({ position: [side * (halfBottom + halfTop) / 2, bottom + height / 2, z], rotation: [0, 0, side * lean],
      shape: "bevel-box", size: [.07, height + .02, .07], stage: 2, surface: "wood" });
  for (const side of [-1, 1]) addBodyWindow(add, side, lean, detailed);
};

/** A shuttered side window on the leaning body wall. */
const addBodyWindow = (add: Add, side: number, lean: number, detailed: boolean) => {
  const y = 1.78, { bottom, halfBottom, halfTop, top } = POST_MILL;
  const face = halfBottom - (halfBottom - halfTop) * (y - bottom) / (top - bottom), z = -.12;
  add({ position: [side * (face + .006), y, z], rotation: [0, 0, side * lean], shape: "window-shadow", size: [.02, .2, .18],
    stage: 2, surface: "dark" });
  if (!detailed) return;
  for (const edge of [-1, 1]) add({ position: [side * (face + .03), y, z + edge * .15],
    rotation: [0, edge * side * .5, side * lean],
    shape: "bevel-box", size: [.025, .22, .11], stage: 3, surface: "wood" });
};

/** Rear door of the body, reached by a steep ladder from a stone step. */
const addRearLadder = (add: Add, detailed: boolean) => {
  const { bottom, rearZ } = POST_MILL, foot = -.8;
  add({ position: [0, bottom + .2, rearZ - .011], shape: "window-shadow", size: [.24, .36, .02], stage: 2, surface: "dark" });
  add({ position: [0, bottom + .4, rearZ - .03], shape: "bevel-box", size: [.32, .05, .05], stage: 2,
    surface: "wood" });
  add({ position: [0, .03, foot], shape: "stone-block", size: [.38, .06, .14], stage: 1, surface: "stone" });
  const from = (x: number): Point3 => [x, .03, foot], to = (x: number): Point3 => [x, bottom + .02, rearZ - .03];
  for (const x of [-.13, .13])
    runBetween(add, from(x), to(x), [.045, .06], { shape: "bevel-box", stage: 3, surface: "wood" });
  const rungs = detailed ? 6 : 3;
  for (let index = 1; index <= rungs; index++) {
    const t = index / (rungs + 1), start = from(0), end = to(0);
    add({ position: [0, start[1] + (end[1] - start[1]) * t, start[2] + (end[2] - start[2]) * t + .01], shape: "box",
      size: [.26, .03, .03], stage: 3, surface: "wood" });
  }
};

/** Painted round shield on the body breast, behind the sail arms. */
const addBreastShield = (add: Add, detailed: boolean) => {
  const centre: Point3 = [0, 1.76, POST_MILL.frontZ + .02];
  add({ position: centre, rotation: [Math.PI / 2, 0, 0], shape: "cylinder", size: [.32, .035, .32], stage: 3,
    surface: "wood" });
  add({ position: [0, centre[1], centre[2] + .025], shape: "sphere", size: [.07, .07, .04], stage: 3,
    surface: "iron" });
  if (!detailed) return;
  for (const side of [-1, 1]) add({ position: [side * .07, centre[1], centre[2] + .019], shape: "box",
    size: [.13, .25, .004], stage: 3, surface: "paint", tint: side < 0 ? [.62, .14, .1] : [.86, .8, .62] });
};

/**
 * Viking post mill: a stave ground storey under a turf roundhouse roof carries an overhanging,
 * tapering clapboard body; the steep shingled gable faces the sails, a ladder climbs to its rear.
 */
const vikingPostMill = (context: KitContext) => {
  const { add, detailed } = context;
  addTurfCollar(add);
  addPostMillBody(add, detailed);
  const roof: RoofEnvelope = { max: [.5, 2.9, .41], min: [-.5, POST_MILL.top, -.61] };
  vikingRoof(context, roof);
  addRearLadder(add, detailed);
  addBreastShield(add, detailed);
};

/** Japanese tiers: plan of each storey and of the skirt roof above it (front eaves clear the sails). */
const TIERS = [
  { bottom: 1.26, plan: { maxX: .43, maxZ: .26, minX: -.43, minZ: -.36 }, roofBase: 1.86, top: 1.94,
    roof: { maxX: .64, maxZ: .42, minX: -.64, minZ: -.54 } },
  { bottom: 1.98, plan: { maxX: .3, maxZ: .2, minX: -.3, minZ: -.24 }, roofBase: 2.56, top: 2.62,
    roof: { maxX: .5, maxZ: .36, minX: -.5, minZ: -.42 } }
] as const;
const GROUND_SKIRT = { base: 1.14, plan: { maxX: .76, maxZ: SAIL_CLEAR_Z, minX: -.76, minZ: -.62 } } as const;

const roofTint = () => JAPANESE_ROOF_TINTS[japaneseRoofClass(MILL_TYPE_ID)];

/**
 * A skirt roof (mokoshi) round a storey: the swept hip roof without ridge tiles (the storey above
 * rises through its ridge), corner tips curling up on High.
 */
const addSkirtRoof = (context: KitContext, plan: Plan, base: number) => {
  const { add, detailed } = context, tint = roofTint();
  const length = plan.maxX - plan.minX, across = plan.maxZ - plan.minZ, height = Math.max(.3, across * .34);
  const centre: Point3 = [(plan.minX + plan.maxX) / 2, base + height / 2 - .02, (plan.minZ + plan.maxZ) / 2];
  const roof: BuildingPart = { position: centre, roofProfile: "japanese", rotation: [0, Math.PI / 2, 0],
    shape: "nation-roof", size: [across, height, length], stage: 4, surface: "roof", tint };
  add(roof);
  for (const part of japaneseRoofUnderside(roof, japaneseRoofClass(MILL_TYPE_ID), detailed)) add(part);
  if (!detailed) return;
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const unitAcross = sz * .42, unitAlong = sx * .46;
    const y = base - .02 + height * (.5 + nationRoofMeshHeight("japanese", true, unitAcross, unitAlong));
    const corner: Point3 = [centre[0] + unitAlong * length, y, centre[2] - unitAcross * across];
    const tip: Point3 = [corner[0], corner[1] + .09, corner[2]];
    runBetween(add, corner, tip, [.05, .04], { tint });
    add({ position: [tip[0], tip[1] + .03, tip[2]], shape: "cone", size: [.04, .06, .04], stage: 4, surface: "roof",
      tint });
  }
};

/** A plastered storey framed by dark corner posts and a tie beam (High adds middle posts). */
const addTierStorey = (add: Add, plan: Plan, bottom: number, top: number, detailed: boolean) => {
  const height = top - bottom, y = (bottom + top) / 2, width = plan.maxX - plan.minX, depth = plan.maxZ - plan.minZ;
  const centre: Point3 = [(plan.minX + plan.maxX) / 2, y, (plan.minZ + plan.maxZ) / 2];
  add({ position: centre, shape: "box", size: [width, height, depth], stage: 2, surface: "plaster" });
  const posts = detailed ? [plan.minX, centre[0], plan.maxX] : [plan.minX, plan.maxX];
  for (const x of posts) for (const z of [plan.minZ - .012, plan.maxZ + .012])
    add({ position: [x, y, z], shape: "box", size: [.06, height, .03], stage: 2, surface: "wood" });
  for (const x of [plan.minX - .012, plan.maxX + .012]) add({ position: [x, y, centre[2]], shape: "box",
    size: [.03, height, .06], stage: 2, surface: "wood" });
  if (!detailed) return;
  const beamY = bottom + height * .7;
  for (const z of [plan.minZ - .015, plan.maxZ + .015]) add({ position: [centre[0], beamY, z], shape: "box",
    size: [width + .03, .05, .03], stage: 2, surface: "wood" });
  for (const x of [plan.minX - .015, plan.maxX + .015]) add({ position: [x, beamY, centre[2]], shape: "box",
    size: [.03, .05, depth + .03], stage: 2, surface: "wood" });
};

/** Lattice window (High: kōshi bars) on the middle storey's front, between the door and the sails. */
const addLatticeWindow = (add: Add, detailed: boolean) => {
  const face = TIERS[0].plan.maxZ, y = 1.56;
  add({ position: [0, y, face + .008], shape: "window-shadow", size: [.3, .2, .016], stage: 2, surface: "dark" });
  if (!detailed) return;
  for (let index = -2; index <= 2; index++) add({ position: [index * .06, y, face + .022], shape: "box",
    size: [.015, .2, .012], stage: 3, surface: "wood" });
  add({ position: [0, y - .115, face + .025], shape: "box", size: [.36, .03, .04], stage: 3, surface: "wood" });
};

/**
 * Japanese tiered mill: the timber-framed ground storey under a skirt roof, two receding storeys
 * each under its own swept roof, the windshaft entering the top storey below the main tiled roof.
 */
const japaneseTieredMill = (context: KitContext) => {
  const { add, detailed } = context;
  addSkirtRoof(context, GROUND_SKIRT.plan, GROUND_SKIRT.base);
  for (const [index, tier] of TIERS.entries()) {
    addTierStorey(add, tier.plan, tier.bottom, tier.top, detailed);
    const main = index === TIERS.length - 1;
    if (!main) { addSkirtRoof(context, tier.roof, tier.roofBase); continue; }
    japaneseRoof(context, { max: [tier.roof.maxX, tier.roofBase + .3, tier.roof.maxZ],
      min: [tier.roof.minX, tier.roofBase, tier.roof.minZ] }, false);
  }
  addLatticeWindow(add, detailed);
};

/** Nubian mill keeps its tower; a centre column and a flanking pair of windows open its front. */
const addNubianMillWindows = (recipe: BuildingRecipe, detailed: boolean): BuildingRecipe => {
  const parts = [...recipe.parts], face = NUBIAN_UPPER_FACE;
  for (const [x, y] of NUBIAN_WINDOWS) {
    parts.push({ position: [x, y, face + .011], shape: "window-shadow", size: [.16, .27, .02], stage: 2, surface: "dark" });
    parts.push({ position: [x, y + .155, face + .02], shape: "box", size: [.24, .04, .04], stage: 2, surface: "wood" });
    parts.push({ position: [x, y - .15, face + .015], shape: "box", size: [.2, .03, .03], stage: 2,
      surface: "plaster" });
    if (detailed) for (const offset of [-.035, .035]) parts.push({ position: [x + offset, y, face + .024],
      shape: "box", size: [.012, .27, .012], stage: 3, surface: "wood" });
  }
  return { ...recipe, parts };
};

const DESIGNS: Readonly<Record<Exclude<BuildNation, "nubian">, (context: KitContext) => void>> = {
  japanese: japaneseTieredMill, viking: vikingPostMill
};

/**
 * Nation mills on the original plot, door, stock, axle and sail anchors: Viking and Japanese rebuild
 * the tower above the ground storey in their own mill form; the Nubian tower gains front windows.
 */
export const createNationMillRecipe = (
  original: BuildingRecipe, definition: BuildingDefinition, nation: BuildNation, detailed: boolean
): BuildingRecipe => {
  if (nation === "nubian")
    return addNubianMillWindows(createNationKitRecipe(original, definition, nation, detailed), detailed);
  const recipe = createNationKitRecipe(groundStorey(original), definition, nation, detailed);
  const parts = [...recipe.parts], context = millContext(original, definition, parts, detailed);
  DESIGNS[nation](context);
  addSignBoard(context.add, original);
  return { ...recipe, parts };
};
