import type { BufferGeometry, Group, Matrix4, MeshStandardMaterial } from "three";

import { shipModelRecipe, type ShipStyle } from "../../../render-common/content/vessel-model-recipes";
import type { ShipLivery } from "../../../render-common/ships/ship-frame";
import type { WorkerNation } from "../../../render-common/workers/worker-unit";
import { createVikingRoundShieldGeometry, createVikingShieldMaterial } from "../viking-round-shield";
import { buildChineseShipHull,buildIndigenousShipHull,buildMayaShipHull, buildPersianShipHull } from "./expansion-ship-hulls";
import { buildChineseShipRig, buildIndigenousShipRig,
buildMayaShipRig, buildPersianShipRig, CHINESE_MAST_FLAG_RISE, createChineseShipSail,createIndigenousShipSail,createMayaShipSail, createPersianShipSail } from "./expansion-ship-sails";
import { buildJapaneseHull, buildJapaneseRig } from "./japanese-ship-hull";
import { buildNubianHull, buildNubianRig } from "./nubian-ship-hull";
import { buildRaiderHull, buildRaiderRig, RAIDER_FIGUREHEAD_OFFSET } from "./raider-ship-hull";
import { buildRomanHull, buildRomanRig } from "./roman-ship-hull";
import type { ShipKit } from "./ship-kit";
import type { ShipMaterialName } from "./ship-materials";
import { createBattenedSail, createLateenSail, createSquareSail } from "./ship-sails";
import { buildVikingHull, buildVikingRig, VIKING_FIGUREHEAD_OFFSET, vikingShieldPlacements } from "./viking-ship-hull";

/**
 * The hull style of a ship frame, from the model recipe its catalog entry names (`shipModelRecipe`): raiders (enemy
 * livery) sail their own galley under the serpent; neutral traders use their assigned nation's hull with a plain stem
 * (see `shipFigureheadKind`, which follows the same rule); the player's ships and sites use the player's nation.
 */
export const shipStyleFor = (livery?: ShipLivery, nation: WorkerNation = "roman",
  traderNation?: WorkerNation): ShipStyle => shipModelRecipe(livery, nation, traderNation).style;

export type { ShipStyle };

/** Identical fittings drawn as one instanced mesh per craft (the longship's rail shields). */
export interface ShipInstancedFitting {
  name: string;
  /** Geometry and material, built once per ship layer and detail level. */
  create: (detailed: boolean) => { geometry: BufferGeometry; material: MeshStandardMaterial };
  /** Ship-space transform of every copy. */
  placements: () => readonly Matrix4[];
}

/**
 * Only the look differs: every style keeps the shared deck (slots, floor, mast, hatch and stern
 * canopy footprint), navigation envelope, speed and capacity of the Roman merchant ship.
 */
export interface ShipStyleRecipe {
  /** Static planking, deck and fittings (merged into material batches once per style). */
  buildHull: (kit: ShipKit, planking: Group, fittings?: Group) => void;
  /** Static mast, spars and ropes (the sail and flag are added per craft). */
  buildRig: (kit: ShipKit, rig: Group) => void;
  /** The player's sail cloth of this style. */
  cloth: ShipMaterialName;
  /** Optional supported flag staff offset, independent of the main mast and sail. */
  flagOffset?: readonly [number, number, number];
  /** Where the figurehead group sits relative to its authored place on the merchant stem. */
  figureheadOffset: readonly [number, number, number];
  /** The sail cloth geometry at rest, with its `clothWind` attribute (shared by every craft of the style). */
  createSail: (detailed: boolean) => BufferGeometry;
  fittings?: ShipInstancedFitting;
}

const VIKING_SHIELDS: ShipInstancedFitting = {
  create: detailed => ({ geometry: createVikingRoundShieldGeometry(detailed),
    material: createVikingShieldMaterial(detailed) }),
  name: "ship_shields",
  placements: vikingShieldPlacements
};

export const SHIP_STYLES: Readonly<Record<ShipStyle, ShipStyleRecipe>> = {
  maya: { buildHull: buildMayaShipHull, buildRig: buildMayaShipRig, cloth: "mayaCloth", createSail: createMayaShipSail,
    figureheadOffset: [0, 0, 0] },
  persian: { buildHull: buildPersianShipHull, buildRig: buildPersianShipRig, cloth: "persianCloth", createSail: createPersianShipSail,
    figureheadOffset: [0, 0, 0] },
  chinese: { flagOffset: [0, CHINESE_MAST_FLAG_RISE, 0], buildHull: buildChineseShipHull, buildRig: buildChineseShipRig, cloth: "chineseCloth", createSail: createChineseShipSail,
    figureheadOffset: [0, 0, 0] },
  indigenous: { buildHull: buildIndigenousShipHull, buildRig: buildIndigenousShipRig, cloth: "indigenousCloth", createSail: createIndigenousShipSail,
    figureheadOffset: [0, 0, 0] },
  japanese: { buildHull: buildJapaneseHull, buildRig: buildJapaneseRig, cloth: "japaneseCloth",
    createSail: createBattenedSail, figureheadOffset: [0, 0, 0] },
  nubian: { buildHull: buildNubianHull, buildRig: buildNubianRig, cloth: "nubianCloth", createSail: createLateenSail,
    figureheadOffset: [0, 0, 0] },
  raider: { buildHull: buildRaiderHull, buildRig: buildRaiderRig, cloth: "enemyCloth", createSail: createSquareSail,
    figureheadOffset: RAIDER_FIGUREHEAD_OFFSET },
  roman: { buildHull: buildRomanHull, buildRig: buildRomanRig, cloth: "cloth", createSail: createSquareSail,
    figureheadOffset: [0, 0, 0] },
  viking: { buildHull: buildVikingHull, buildRig: buildVikingRig, cloth: "vikingCloth", createSail: createSquareSail,
    figureheadOffset: VIKING_FIGUREHEAD_OFFSET, fittings: VIKING_SHIELDS }
};
