import type { NavalShip } from "./settlement-naval-fleet";
import { countNavalPassengerJobs, countNavalPassengerTroops } from "./settlement-naval-fleet";
import type { SettlementContext } from "./settlement-types";

/** Display receipts survive actor emigration; they never deliver or recreate any items or soldiers. */
export const shipRegisterManifest = (ship: NavalShip, context: SettlementContext) => {
  const voyage = ship.colony;
  if (ship.phase === "away" && voyage) {
    if (voyage.manifest && ship.timer > voyage.voyageSeconds) return voyage.manifest;
    if (voyage.homeward && ship.timer <= voyage.voyageSeconds) return {
      cargo: voyage.homeward.cargo, jobs: { Soldier: voyage.homeward.troops.length },
      troops: countNavalPassengerTroops([], undefined, voyage.homeward.troops)
    };
  }
  return { cargo: ship.cargo, jobs: countNavalPassengerJobs(ship.passengers ?? [], context.actors),
    troops: countNavalPassengerTroops(ship.passengers ?? [], context.military?.troopType, ship.troops) };
};
