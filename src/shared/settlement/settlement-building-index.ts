import type { SettlementBuilding, SettlementContext } from "./settlement-types";

/**
 * O(1) building lookup for hot traffic paths. Claim, demolition and load keep the index current;
 * isolated unit-test contexts without an index (or with buildings pushed directly) fall back to a scan.
 */
export const getBuilding = (context: SettlementContext, uid: number | undefined) => {
  if (uid === undefined) return undefined;
  return context.buildingByUid?.get(uid) ?? context.buildings.find((entry) => entry.uid === uid);
};

export const indexBuilding = (context: SettlementContext, building: SettlementBuilding) => {
  context.buildingByUid?.set(building.uid, building);
};

export const unindexBuilding = (context: SettlementContext, building: SettlementBuilding) => {
  if (context.buildingByUid?.get(building.uid) === building) context.buildingByUid.delete(building.uid);
};

export const rebuildBuildingIndex = (context: SettlementContext) => {
  if (!context.buildingByUid) return;
  context.buildingByUid.clear();
  for (const building of context.buildings) context.buildingByUid.set(building.uid, building);
};
