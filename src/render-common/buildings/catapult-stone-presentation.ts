import { STONE_WARE_BLOCK } from "../wares/ware-dimensions";
import { WORKER_SCALE } from "../workers/worker-dimensions";
import { CATAPULT_DECK_HEIGHT } from "./catapult-dimensions";
import { CATAPULT_STONE_DIAMETER } from "./catapult-mechanism";

/**
 * Presentation only (owner, 2026-11-07): delivered stone stays the carriers' cut block outdoors
 * and in the ground pile; the porter shapes it into round shot out of sight, inside the tower.
 * Stock counts, ownership and timings are unchanged.
 */
export type CatapultStoneShape = "block" | "round";
export type CatapultEvacuationStage = "roof" | "stairs" | "door";

/** World height of a resting block's ware origin above the surface beneath it. */
export const CATAPULT_BLOCK_REST_LIFT = (STONE_WARE_BLOCK.edge / 2 - STONE_WARE_BLOCK.centreY) * WORKER_SCALE;

/**
 * `porterOutside` is defined only for the tower's active porter. Its outdoor legs carry the block;
 * stairs and roof carry round shot. An evacuating worker turns it back into a block on the hidden
 * walk to the door, and any later cargo outside stays a block.
 */
export const catapultCarrierStoneShape = (
  porterOutside: boolean | undefined, evacuationStage?: CatapultEvacuationStage
): CatapultStoneShape => {
  if (porterOutside !== undefined) return porterOutside ? "block" : "round";
  if (evacuationStage === "roof" || evacuationStage === "stairs") return "round";
  return "block";
};

/** A casualty drop keeps the shape it was carried in: raised (stairs/roof) drops were round shot. */
export const catapultDropStoneShape = (dropY: number, siteY: number, structureScale: number): CatapultStoneShape =>
  dropY - siteY > CATAPULT_DECK_HEIGHT * structureScale / 2 ? "round" : "block";

/** Height of the displayed stone's origin above its resting surface. */
export const catapultRestingStoneLift = (shape: CatapultStoneShape, structureScale: number) =>
  shape === "block" ? CATAPULT_BLOCK_REST_LIFT : CATAPULT_STONE_DIAMETER / 2 * structureScale;
