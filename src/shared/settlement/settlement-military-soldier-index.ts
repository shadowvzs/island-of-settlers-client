import type { SettlementSoldier } from "./settlement-military";

/** The soldiers assigned to one building. */
export type SoldierLookup = (buildingUid: number) => readonly SettlementSoldier[];

/**
 * Building uid -> its soldiers, so a military pass asks each building once instead of scanning
 * the whole soldier map per building. Rebuilt from the soldier map at the start of a pass and
 * kept current by the pass's own deploy/release writes; it is not a persistent save-level index.
 */
export interface SoldierBuildingIndex {
  /** The soldiers of one building (empty for a building with none). */
  of: SoldierLookup;
  /** Rebuilds every bucket from the soldier map in one pass, reusing the bucket arrays. */
  rebuild: () => void;
  /** Reflects a soldier added or moved during the pass; `previousBuilding` is where it was. */
  move: (soldier: SettlementSoldier, previousBuilding?: number) => void;
}

export const createSoldierBuildingIndex = (
  soldiers: ReadonlyMap<number, SettlementSoldier>
): SoldierBuildingIndex => {
  const noSoldiers: readonly SettlementSoldier[] = [];
  const buckets = new Map<number, SettlementSoldier[]>();
  const remove = (buildingUid: number, actorUid: number) => {
    const bucket = buckets.get(buildingUid);
    if (!bucket) return;
    const index = bucket.findIndex((soldier) => soldier.actor === actorUid);
    if (index >= 0) bucket.splice(index, 1);
  };
  const add = (soldier: SettlementSoldier) => {
    const bucket = buckets.get(soldier.building);
    if (bucket) {
      bucket.push(soldier);
      return;
    }
    buckets.set(soldier.building, [soldier]);
  };
  return {
    move: (soldier, previousBuilding) => {
      if (previousBuilding === soldier.building) return;
      if (previousBuilding !== undefined) remove(previousBuilding, soldier.actor);
      add(soldier);
    },
    of: (buildingUid) => buckets.get(buildingUid) ?? noSoldiers,
    rebuild: () => {
      for (const bucket of buckets.values()) bucket.length = 0;
      for (const soldier of soldiers.values()) add(soldier);
    }
  };
};
