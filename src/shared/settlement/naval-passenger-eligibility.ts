import { hasRoadRoute } from "./road-route-helpers";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

export const isFreeOwnReserve = (context: SettlementContext, actor: SettlementActor) =>
  actor.job === "Soldier" && actor.phase === "militaryReserve" && actor.navalOrder === undefined &&
  context.military?.factionOf?.(actor.uid) === 0;

export const reserveReachesHarbour = (
  context: SettlementContext, actor: SettlementActor, source: SettlementBuilding
) => {
  if (actor.home === source.uid) return true;
  const home = context.buildings.find(building => building.uid === actor.home);
  if (!home) return false;
  return hasRoadRoute(context.options.roads, home.access, source.access);
};

/** Source-specific pool shared by launch readiness and reservation selection. */
export const expeditionReserveSoldiers = (
  context: SettlementContext, type: string, source?: SettlementBuilding
) => {
  const reachableHomes = new Map<number, boolean>();
  return context.actors.filter(actor => {
    if (!isFreeOwnReserve(context, actor) || context.military?.troopType?.(actor.uid) !== type) return false;
    if (!source) return true;
    let reaches = reachableHomes.get(actor.home);
    if (reaches === undefined) {
      reaches = reserveReachesHarbour(context, actor, source);
      reachableHomes.set(actor.home, reaches);
    }
    return reaches;
  });
};
