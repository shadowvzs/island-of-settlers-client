import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { claimBuilding, makeBuilding, placementReason } from "./settlement-placement";
import { territoryPlacementReason } from "./settlement-territory";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/** Plot size in cells after `rotation` quarter turns. */
export const rotatedFootprint = (typeId: number, rotation: number) => {
  const [baseWidth, baseDepth] = getBuildingDefinition(typeId).gridFootprint;
  return rotation % 2 ? { depth: baseWidth, width: baseDepth } : { depth: baseDepth, width: baseWidth };
};

/**
 * A legal draft with its plot's top-left cell at (left, top), or null. Uses the real placement
 * and territory rules; drafts never consume building ids.
 */
export const legalDraft = (context: SettlementContext, typeId: number, left: number, top: number, rotation: number) => {
  const { depth, width } = rotatedFootprint(typeId, rotation);
  const next = context.nextBuilding;
  const draft = makeBuilding(context, typeId, left + width / 2, top + depth / 2, rotation);
  context.nextBuilding = next;
  // The territory check is cheap; some placement checks (the harbour shore) search routes.
  const blocked = territoryPlacementReason(context, draft) ?? placementReason(context, draft);
  return blocked ? null : draft;
};

/** Marks a draft as already built: no builders, no construction wares, a level foundation once claimed. */
export const finishDraft = (draft: SettlementBuilding, status: string) =>
  Object.assign(draft, { construction: 1, foundationProgress: 1, input: {}, required: {}, status });

/** Claims the draft as a finished building: no builders, no construction wares, a level foundation. */
export const raiseFinishedBuilding = (context: SettlementContext, draft: SettlementBuilding, status: string) => {
  draft.uid = context.nextBuilding++;
  finishDraft(draft, status);
  claimBuilding(context, draft);
  return draft;
};
