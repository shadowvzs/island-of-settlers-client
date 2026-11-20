import { WORKER_RADIUS } from "../../render-common/workers/worker-dimensions";
import { getBuilding } from "./settlement-building-index";
import { isPublicBuildingPointClear } from "./settlement-building-navigation";
import type { SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** The assigned shovel crew may straddle its empty plot edge, retaining every other real obstacle. */
export const isOwnLevelerSitePoint = (
  context: SettlementContext, actor: Partial<SettlementActor>, point: SettlementPoint,
  site: SettlementBuilding | undefined = getBuilding(context, actor.stockBuilding)
) => {
  if (actor.job !== "Leveler" || !site || actor.building !== site.uid ||
    actor.stockBuilding !== site.uid || site.construction !== 0) return false;
  const margin = WORKER_RADIUS + 1e-7;
  if (Math.abs(point.x - site.x) > site.width / 2 + margin ||
    Math.abs(point.z - site.z) > site.depth / 2 + margin) return false;
  return isPublicBuildingPointClear(context, point, WORKER_RADIUS, site);
};
