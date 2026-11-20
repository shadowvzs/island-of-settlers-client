import { HEADQUARTERS_TYPE_ID } from "../../shared/settlement/building-type-ids";
import type { BuildingDefinition } from "./building-catalog";
import type { BuildingPart, BuildingRecipe, Point3 } from "./building-recipe";
import { getRomanRecipeBounds } from "./building-recipe-fit";
import { withoutRomanCupola } from "./headquarters-cupola";
import { createNationKitRecipe } from "./nation-architecture-kit";
import type { WallRun } from "./nation-kit-classify";
import { doorGapOf, type KitContext,runBetween, timberWindowFrame } from "./nation-kit-parts";
import { VIKING_GREAT_HALL_HQ, vikingWall } from "./nation-kit-viking";
import { ornamentOffset, ornamentSize } from "./viking-ornament-boxes";


/**
 * Stave tower over the hall's crossing: it stands on the ceiling slabs round the ladder hatch
 * (their top is 1.45), rises through the ridge and carries a shingled cap.
 */
const TOWER = { base: 1.45, half: .4, top: 2.62, wall: .08 } as const;
/** Truncated pyramid cap: eave overhang, height and the square crown it narrows to. */
const CAP = { crown: .34, height: .3, overhang: .1 } as const;
/** Shingle map density on the cap: about three courses from eave to crown. */
const CAP_SHINGLES = 2.5;
/** Carved timber collar on the cap, under the rune plinth. */
const COLLAR = { height: .07, width: .36 } as const;
const PLINTH_SCALE = .72;
/** Thor stands about 1.24 high, hammer raised: he reads above the hall from the gameplay camera. */
const THOR = { scale: .9, yaw: .3 } as const;
const SOUND_HOLE = { height: .2, width: .13 } as const;
/**
 * Round shields hang along the porch beam (its painted front strip ends at z 1.626, centre height
 * 1.295) between the posts. Short iron hangers keep the full rims below the projecting eaves.
 */
const PORCH_SHIELDS = { along: [-.85, -.42, 0, .42, .85], front: 1.626, scale: .2, y: 1 } as const;

const towerWall = (along: 0 | 2, side: number): WallRun => {
  const { base, half, top, wall } = TOWER, across = along === 0 ? 2 : 0;
  const min: Point3 = [-half, base, -half], max: Point3 = [half, top, half];
  min[across] = side > 0 ? half - wall : -half;
  max[across] = side > 0 ? half : -half + wall;
  return { along, base, height: top - base, length: half * 2, max, min };
};

const TOWER_WALLS: readonly WallRun[] = [towerWall(0, 1), towerWall(0, -1), towerWall(2, 1), towerWall(2, -1)];

/** Stave walls (planks and High battens) with square corner posts and a top plate under the cap. */
const addTowerBody = (context: KitContext) => {
  const { add } = context, { base, half, top } = TOWER;
  for (const wall of TOWER_WALLS) vikingWall(context, wall, false);
  for (const x of [-1, 1]) for (const z of [-1, 1]) add({
    position: [x * (half - .02), (base + top) / 2, z * (half - .02)], shape: "bevel-box",
    size: [.1, top - base, .1], stage: 2, surface: "wood" });
  add({ position: [0, top - .04, 0], shape: "bevel-box", size: [half * 2 + .06, .08, half * 2 + .06], stage: 3,
    surface: "wood" });
};

/** Dark sound holes in timber frames, high on each face above the hall ridge (front and back on Minimal). */
const addSoundHoles = (context: KitContext) => {
  const { add, detailed } = context, y = TOWER.top - .2, face = TOWER.half + .01;
  const faces: Array<[0 | 2, number]> = detailed ? [[0, 1], [0, -1], [2, 1], [2, -1]] : [[0, 1], [0, -1]];
  for (const [along, side] of faces) {
    const across = along === 0 ? 2 : 0, position: Point3 = [0, y, 0], size: Point3 = [0, SOUND_HOLE.height, 0];
    position[across] = side * face;
    size[along] = SOUND_HOLE.width;
    size[across] = .02;
    const pane: BuildingPart = { position, shape: "box", size, stage: 2, surface: "dark" };
    add(pane);
    if (detailed) timberWindowFrame(add, pane, along, side * TOWER.half, side * .04);
  }
};

/** Shingled cap narrowing to the crown; High adds hip boards along its four hips. */
const addTowerCap = (context: KitContext) => {
  const { add, detailed } = context, eave = TOWER.half * 2 + CAP.overhang * 2, taper = CAP.crown / eave;
  add({ position: [0, TOWER.top + CAP.height / 2, 0], shape: "box", size: [eave, CAP.height, eave], stage: 4,
    surface: "roof", topScale: [taper, 1, taper], worldUv: CAP_SHINGLES });
  if (!detailed) return;
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    const foot: Point3 = [x * eave / 2, TOWER.top + .02, z * eave / 2];
    const head: Point3 = [x * CAP.crown / 2, TOWER.top + CAP.height + .01, z * CAP.crown / 2];
    runBetween(add, foot, head, [.045, .045], { shape: "bevel-box", stage: 4, surface: "wood" });
  }
};

const isPorchStud = (part: BuildingPart) => part.surface === "gold" && part.shape === "box" &&
  part.position[2] > PORCH_SHIELDS.front;

/** The longship's round shields, planks upright (one shared model, owner 2026-10-13). */
const porchShields = (): BuildingPart[] => {
  const { along, front, scale, y } = PORCH_SHIELDS, back = ornamentOffset("round-shield", [0, 0, -.03], scale)[2];
  return along.flatMap(x => [
    { position: [x, y, front - back], shape: "round-shield",
      size: ornamentSize("round-shield", scale), stage: 4, surface: "paint" } as BuildingPart,
    { position: [x, 1.205, front + .01], shape: "box", size: [.024, .225, .02],
      stage: 4, surface: "iron" } as BuildingPart
  ]);
};

/** The collar, the rune-carved plinth and the bronze Thor on top of the tower. */
const addThorCrown = (context: KitContext) => {
  const { add } = context, collarBase = TOWER.top + CAP.height;
  add({ position: [0, collarBase + COLLAR.height / 2, 0], shape: "bevel-box",
    size: [COLLAR.width, COLLAR.height, COLLAR.width], stage: 4, surface: "wood" });
  const plinthBase = collarBase + COLLAR.height, plinth = ornamentSize("rune-plinth", PLINTH_SCALE);
  add({ position: [0, plinthBase + plinth[1] / 2, 0], rotation: [0, THOR.yaw, 0], shape: "rune-plinth", size: plinth,
    stage: 4, surface: "stone" });
  const feet = ornamentOffset("thor-statue", [0, 0, 0], THOR.scale)[1];
  add({ position: [0, plinthBase + plinth[1] - feet, 0], rotation: [0, THOR.yaw, 0], shape: "thor-statue",
    size: ornamentSize("thor-statue", THOR.scale), stage: 4, surface: "paint" });
};

const towerContext = (original: BuildingRecipe, definition: BuildingDefinition, detailed: boolean,
  parts: BuildingPart[]): KitContext => ({
  add: part => parts.push({ stage: 1, ...part }), center: [0, 0, 0], detailed, door: doorGapOf(original), lean: false,
  limit: getRomanRecipeBounds(definition, original), tower: false, typeId: definition.id, walls: TOWER_WALLS
});

/** True for the building this design replaces (the Viking HQ, unless rolled back). */
export const isVikingGreatHall = (typeId: number) => VIKING_GREAT_HALL_HQ && typeId === HEADQUARTERS_TYPE_ID;

/**
 * Viking headquarters as a great mead hall: the kit rebuilds the hall, wings and porch as stave
 * walls on a stone sill under shingled gables with carved dragon heads; a stave tower rises from
 * the ridge crossing and Thor stands on its crown. Plan, door, stocks and anchors stay canonical.
 */
export const createVikingGreatHallRecipe = (original: BuildingRecipe, definition: BuildingDefinition,
  detailed: boolean): BuildingRecipe => {
  const hall = createNationKitRecipe(withoutRomanCupola(original), definition, "viking", detailed);
  const parts = [...hall.parts.filter(part => !isPorchStud(part)), ...porchShields()];
  const context = towerContext(original, definition, detailed, parts);
  addTowerBody(context);
  addSoundHoles(context);
  addTowerCap(context);
  addThorCrown(context);
  return { ...hall, parts };
};
