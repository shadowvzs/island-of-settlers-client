import { actorOpensDoor, passageBuilding } from "./settlement-entrance";
import { hasStorageDoorLanes, storageDoorFootTraffic, storageDoorLeafAt } from "./settlement-storage-door-lanes";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import { settlementWorkCounters } from "./settlement-work-counters";

const openness = new WeakMap<SettlementBuilding, number>();
const leafOpenness = new WeakMap<SettlementBuilding, [number, number]>();

/** Transient presentation derived from nearby actors; never adds an authoritative save field. */
export const storageDoorLeafOpenings = (building: SettlementBuilding): readonly [number, number] | undefined =>
  leafOpenness.get(building);

/** Doors that an actor is physically passing this tick: one pass over the actors, each tested
 * only against its own passage building. */
const openedDoors = (context: SettlementContext) => {
  const byUid = new Map<number, SettlementBuilding>();
  for (const building of context.buildings) byUid.set(building.uid, building);
  const opened = new Map<SettlementBuilding, number>();
  for (const actor of context.actors) {
    const uid = passageBuilding(actor);
    const building = uid === undefined ? undefined : byUid.get(uid);
    if (building && actorOpensDoor(actor, building)) {
      const mask = hasStorageDoorLanes(building) && storageDoorFootTraffic(actor)
        ? 1 << storageDoorLeafAt(building, actor) : 3;
      opened.set(building, (opened.get(building) ?? 0) | mask);
    }
  }
  settlementWorkCounters(context).doorActivityVisits += context.actors.length;
  return opened;
};

/** Actual doorway use controls the door; work-cycle state changes cannot open it remotely. */
export const updateDoorActivity = (context: SettlementContext, dt: number) => {
  const opened = openedDoors(context);
  for (const building of context.buildings) {
    if (hasStorageDoorLanes(building)) {
      const leaves = leafOpenness.get(building) ?? [building.door, building.door];
      const mask = opened.get(building) ?? 0;
      leaves[0] = mask & 1 ? 1 : Math.max(0, leaves[0] - dt * 1.5);
      leaves[1] = mask & 2 ? 1 : Math.max(0, leaves[1] - dt * 1.5);
      leafOpenness.set(building, leaves);
      building.door = Math.max(...leaves);
      openness.set(building, building.door);
      continue;
    }
    const value = opened.has(building) ? 1 : Math.max(0, (openness.get(building) ?? 0) - dt * 1.5);
    building.door = value;
    openness.set(building, value);
  }
};

export const restoreDoorActivity = (context: SettlementContext) => {
  for (const building of context.buildings) {
    openness.set(building, building.door);
    leafOpenness.delete(building);
  }
};
