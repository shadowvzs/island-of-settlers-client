import { roadPlanCrossesBridgeSite } from "./bridge-placement-conflicts";
import { boatJettyRoadClear } from "./harbour-boat-reservations";
import type { RoadPlan, RoadTier, RoadUpgradePayment,RoadUpgradeTier } from "./road-types";
import { ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { refreshSettlementRoadTerrain } from "./settlement-road-terrain";
import { ownsTerritoryRoute, settlementTerritory } from "./settlement-territory";
import type { SettlementContext, SettlementPoint } from "./settlement-types";

/**
 * Real road plans are checked over their whole route, including segments between endpoints, inside the
 * territory of `owner`; upgrades inherit tiers at that owner's building flags.
 */
export const createTerritoryRoadControls = (context: SettlementContext, owner = PLAYER_FACTION) => {
  const { roads } = context.options;
  const buildingFlags = () => context.buildings.filter(building => ownerOf(building) === owner)
    .map(building => building.access);
  const ownsRoute = (points: readonly SettlementPoint[]) => ownsTerritoryRoute(context, points, undefined, owner);
  const rawPlan = (start: SettlementPoint, end: SettlementPoint, tier: RoadTier): RoadPlan | null => {
    if (tier === "dirt") return roads.planRoad?.(start, end) ?? null;
    if (roads.planUpgrade) return roads.planUpgrade(start, end, tier, buildingFlags());
    const route = roads.route(start, end);
    if (!route || route.points.length < 2) return null;
    return { points: route.points, segments: route.points.slice(1).map((point, index) => ({
      start: route.points[index]!, end: point, tier
    })) };
  };
  const planRoad = (start: SettlementPoint, end: SettlementPoint, tier: RoadTier) => {
    const plan = rawPlan(start, end, tier);
    if (!plan) return null;
    const newRoad = tier === "dirt";
    if (newRoad && (!boatJettyRoadClear(context, plan.points) || roadPlanCrossesBridgeSite(context, plan.segments)))
      return null;
    // The territory is read once for the whole plan and each of its segments (nothing changes in between).
    const { owned } = settlementTerritory(context, owner);
    const ownsPlanned = (points: readonly SettlementPoint[]) => ownsTerritoryRoute(context, points, owned, owner);
    return ownsPlanned(plan.points) && plan.segments.every(segment => ownsPlanned([segment.start, segment.end])) &&
      (context.roadDecorations?.roadPlacementClear(plan.segments) ?? true) ? plan : null;
  };
  return {
    planRoad,
    connectRoads: (start: SettlementPoint, end: SettlementPoint) => {
      const plan = roads.planRoad ? planRoad(start, end, "dirt") : null;
      const points = roads.planRoad ? plan?.points : [start, end];
      if (!points || !boatJettyRoadClear(context, points) || !ownsRoute(points)) return false;
      const segments = points.slice(1).map((end, index) => ({ start: points[index]!, end, tier: "dirt" as const }));
      if (context.roadDecorations?.roadPlacementClear(segments) === false) return false;
      // The checked plan is laid as it is: planning it again between its ends gives the same plan.
      const result = plan && roads.addPlannedRoad ? roads.addPlannedRoad(plan) : roads.addRoad(start, end);
      if (result && context.roadDecorations?.hasState()) refreshSettlementRoadTerrain(context);
      return result;
    },
    /**
     * Lays a dirt road `planRoad` already checked (territory, jetties, bridges, decorations) without planning it
     * again; false when the network cannot take a plan (the caller then connects its endpoints).
     */
    addPlannedRoad: (plan: Pick<RoadPlan, "points">) => {
      const result = roads.addPlannedRoad?.(plan) ?? false;
      if (result && context.roadDecorations?.hasState()) refreshSettlementRoadTerrain(context);
      return result;
    },
    upgradeRoad: (start: SettlementPoint, end: SettlementPoint, pay: RoadUpgradePayment, targetTier: RoadUpgradeTier = "stone") => {
      if (!planRoad(start, end, targetTier)) return false;
      const result = roads.upgradeRoad(start, end, pay, targetTier, buildingFlags());
      if (result && context.roadDecorations?.hasState()) refreshSettlementRoadTerrain(context);
      return result;
    }
  };
};
