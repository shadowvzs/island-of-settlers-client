import { doorFrontPoint } from "./settlement-entrance";
import type { SettlementSoldier } from "./settlement-military";
import type { SoldierBuildingIndex } from "./settlement-military-soldier-index";
import { isNavigationClear } from "./settlement-navigation";
import { ownerOf } from "./settlement-ownership";
import type { SettlementBuilding, SettlementContext, SettlementPoint } from "./settlement-types";

/** A soldier stored in a storage has this building id. */
const STORED = -1;
/** How far out of the storage door released soldiers muster (tiles; clear of the door lanes). */
const MUSTER_DISTANCES = [5, 6, 4, 7] as const;
const MUSTER_SIDES = [0, 2, -2] as const;

interface ReserveReleaseDeps {
  /** A finished garrison building of a computer economy. */
  isEconomyGarrison: (building: SettlementBuilding) => boolean;
  /** The computer side's ordinary field order (`combat.commandOpponent`). */
  march: (ids: readonly number[], point: SettlementPoint, owner: number, mode: "move") => boolean;
  soldierIndex: SoldierBuildingIndex;
  soldiers: ReadonlyMap<number, SettlementSoldier>;
  standing: (uid: number) => boolean;
}

/** The owner's standing garrison buildings with no soldier assigned yet (each keeps one stored soldier). */
const emptyGarrisons = (context: SettlementContext, deps: ReserveReleaseDeps, owner: number) => {
  deps.soldierIndex.rebuild();
  let empty = 0;
  for (const building of context.buildings)
    if (deps.isEconomyGarrison(building) && ownerOf(building) === owner && deps.standing(building.uid) &&
      !deps.soldierIndex.of(building.uid).length) empty++;
  return empty;
};

/** The first clear standing place in front of the storage's door, else its road access. */
const musterPointOf = (context: SettlementContext, storage: SettlementBuilding) => {
  for (const distance of MUSTER_DISTANCES) for (const side of MUSTER_SIDES) {
    const point = doorFrontPoint(storage, distance, side);
    if (isNavigationClear(context, point)) return point;
  }
  return storage.access;
};

/**
 * Releases a computer economy's stored soldiers into the field (EAI4-FOLLOWUP, the economy's reserve lever): its
 * soldiers waiting in its storages, none an A14 force holds, march out and muster in front of their storage, where
 * the director's forces take them as uncommitted field soldiers. One stored soldier stays for every garrison
 * building of the owner that has none yet (the economy AI's garrison minimum, EAI4a pass 1).
 */
export const createReserveRelease = (context: SettlementContext, deps: ReserveReleaseDeps) => {
  const { soldiers } = deps;
  /** Counts (and groups by storage into `out`) up to `limit` stored soldiers of `owner` the economy may release. */
  const releasable = (owner: number, limit: number, out?: Map<number, number[]>) => {
    let count = 0;
    for (const actor of context.actors) {
      if (count >= limit) break;
      if (actor.phase !== "militaryReserve" || actor.navalOrder !== undefined) continue;
      const soldier = soldiers.get(actor.uid), state = soldier?.combat;
      if (soldier?.building !== STORED || state?.faction !== owner || state.type === "cavalry" ||
        context.militaryDirector?.owns(actor.uid) === true) continue;
      if (out) {
        const group = out.get(actor.home) ?? [];
        group.push(actor.uid);
        out.set(actor.home, group);
      }
      count++;
    }
    return count;
  };
  /** Stored soldiers of `owner` it may send to the field now (beyond its garrison minimum). */
  const spareReserve = (owner: number) =>
    Math.max(0, releasable(owner, Infinity) - emptyGarrisons(context, deps, owner));
  /** Up to `count` spare stored soldiers march out to muster; returns how many accepted the order. */
  const releaseReserve = (owner: number, count: number) => {
    const groups = new Map<number, number[]>();
    releasable(owner, Math.min(count, spareReserve(owner)), groups);
    let released = 0;
    for (const [home, group] of groups) {
      const storage = context.buildings.find(building => building.uid === home);
      if (!storage || !deps.march(group, musterPointOf(context, storage), owner, "move")) continue;
      for (const uid of group) if (soldiers.get(uid)?.building !== STORED) released++;
    }
    return released;
  };
  return { releaseReserve, spareReserve };
};
