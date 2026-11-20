import { EXPEDITION_CREW, EXPEDITION_ROLES, expeditionSupplies } from "./settlement-naval-preparation";
import type { SettlementSaveV1 } from "./settlement-save-state";

const PREPARING_PHASES = new Set(["inside", "navalToHarbour", "navalEnterHarbour", "navalWaiting"]);

/** Validate isolated preparation receipts before accepting their otherwise unowned waiting crew. */
export const validateExpeditionPreparations = (save: SettlementSaveV1, held: Set<number>) => {
  const state = save.naval.preparation;
  if (state === undefined) return null; // Existing voyages/saves have no preparation extension.
  if (!state || !Number.isSafeInteger(state.nextPreparation) || state.nextPreparation < 1 ||
    !Array.isArray(state.preparations)) return "Invalid expedition preparation state";
  const ids = new Set<number>(), sources = new Set<number>();
  const supplies = expeditionSupplies(save.playerNation ?? "roman");
  for (const preparation of state.preparations) {
    if (!preparation || !Number.isSafeInteger(preparation.id) || preparation.id < 1 ||
      preparation.id >= state.nextPreparation || ids.has(preparation.id) ||
      sources.has(preparation.sourceUid)) return "Invalid expedition preparation identity";
    const source = save.buildings.find(building => building.uid === preparation.sourceUid);
    if (!source || source.typeId !== 39 || source.construction !== 1)
      return "Invalid expedition preparation harbour";
    const target = preparation.target;
    if (!target || ![target.x, target.z, target.water?.x, target.water?.z].every(Number.isFinite) ||
      target.x < 0 || target.z < 0 || target.x >= save.world.cellsX || target.z >= save.world.cellsZ ||
      target.water.x < 0 || target.water.z < 0 || target.water.x >= save.world.cellsX ||
      target.water.z >= save.world.cellsZ || !Number.isInteger(target.rotation) ||
      target.rotation < 0 || target.rotation > 3) return "Invalid expedition preparation shore";
    if (!preparation.cargo || typeof preparation.cargo !== "object" || Array.isArray(preparation.cargo) ||
      Object.entries(preparation.cargo).some(([ware, count]) => !Object.hasOwn(supplies, ware) ||
        !Number.isSafeInteger(count) || count < 0 || count > supplies[ware]!))
      return "Invalid expedition preparation supplies";
    if (preparation.shipId !== undefined &&
      (!Number.isSafeInteger(preparation.shipId) || preparation.shipId < 1))
      return "Invalid expedition preparation ship";
    if (!Array.isArray(preparation.passengers) || preparation.passengers.length > EXPEDITION_CREW)
      return "Invalid expedition preparation crew";
    for (const [index, uid] of preparation.passengers.entries()) {
      const actor = save.actors.find(candidate => candidate.uid === uid);
      // Helpers may still walk from another storage (settlers are born in the HQ, POP-01).
      if (!Number.isSafeInteger(uid) || held.has(uid) || !actor || actor.navalOrder !== 0 ||
        actor.building !== source.uid || actor.tool || actor.ware || !PREPARING_PHASES.has(actor.phase) ||
        (actor.phase === "navalWaiting" && actor.visible) ||
        actor.job !== EXPEDITION_ROLES[index])
        return "Invalid expedition preparation builder, leveler or carrier";
      held.add(uid);
    }
    ids.add(preparation.id); sources.add(preparation.sourceUid);
  }
  return null;
};
