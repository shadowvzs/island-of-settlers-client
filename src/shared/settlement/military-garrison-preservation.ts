import { isOwnBuilding } from "./settlement-home";
import { ownerOf } from "./settlement-ownership";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/** Keep one real stationed defender; soldiers still walking to the building do not replace it yet. */
export const canLeaveGarrison = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.phase !== "garrison") return true;
  const site = context.buildings.find(site => site.uid === actor.building);
  if (!site || ownerOf(site) > 0) return true;
  return context.actors.filter(other => other.job === "Soldier" && other.phase === "garrison" &&
    other.building === site.uid).length > 1;
};

/** A colony evacuation keeps one defender in each occupied military building. */
export const retainedGarrisonIds = (buildings: readonly SettlementBuilding[], actors: readonly SettlementActor[]) => {
  const own = new Set(buildings.filter(site => isOwnBuilding(site)).map(site => site.uid));
  const retained = new Set<number>(), guarded = new Set<number>();
  for (const actor of actors) {
    if (actor.job !== "Soldier" || actor.phase !== "garrison" || !own.has(actor.building) || guarded.has(actor.building)) continue;
    guarded.add(actor.building); retained.add(actor.uid);
  }
  return retained;
};
