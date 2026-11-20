import { DMath } from "../math/deterministic-math";
import { STORAGE_IDS } from "./production-rules";
import { carrierRoadRecoveryPath } from "./settlement-carrier-road-recovery";
import { actorEconomyOwnerOf, servesEconomyOf } from "./settlement-ownership";
import { groundPath, setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * Returning crews use the same local join and public roads as an active delivery. Only when no
 * storage is reachable by road may an EMPTY carrier walk home over dry ground (new shipments and
 * loaded carriers still require roads).
 */
export const returnCarrierHome = (
  context: SettlementContext,
  actor: SettlementActor,
  site: SettlementBuilding
) => {
  const owner = actorEconomyOwnerOf(context, actor);
  const homes = context.buildings.filter(building =>
    building.construction === 1 && STORAGE_IDS.has(building.typeId) && servesEconomyOf(context, building, owner)
  ).sort((a, b) => Number(b.uid === actor.home) - Number(a.uid === actor.home) ||
    DMath.hypot(a.access.x - actor.x, a.access.z - actor.z) -
      DMath.hypot(b.access.x - actor.x, b.access.z - actor.z) || a.uid - b.uid);
  if (homes.some(home => sendCarrierHomeTo(context, actor, home))) return true;
  if (actor.ware) return false;
  return homes.some(home => walkCarrierHomeOverGround(context, actor, home, site));
};

/** Walks the empty carrier home to `home` (which becomes its home); false without a road join. */
export const sendCarrierHomeTo = (context: SettlementContext, actor: SettlementActor, home: SettlementBuilding) => {
  const recovery = carrierRoadRecoveryPath(context, actor, home.access);
  if (!recovery) return false;
  actor.home = home.uid;
  actor.stockBuilding = recovery.court;
  setActorPath(actor, recovery.path, "home");
  return true;
};

/** Dry-ground walk that may leave only `site`'s own plot; other footprints and water stay blocked. */
const walkCarrierHomeOverGround = (
  context: SettlementContext, actor: SettlementActor, home: SettlementBuilding, site: SettlementBuilding
) => {
  const path = groundPath(context, actor, home.access, site.uid);
  if (!path) return false;
  actor.home = home.uid;
  actor.stockBuilding = undefined;
  setActorPath(actor, path, "home");
  return true;
};
