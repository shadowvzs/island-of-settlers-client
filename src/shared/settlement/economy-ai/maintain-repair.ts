import { getConstructionCost } from "../construction-costs";
import { ownerThreatenedAt } from "../military-civilian-safety";
import { getBuilding } from "../settlement-building-index";
import { localConstructionStock } from "../settlement-local-stock";
import { buildingNation } from "../settlement-nation";
import { outingPath, outingStorage } from "../settlement-outing-dispatch";
import { ownerOf } from "../settlement-ownership";
import { createActor } from "../settlement-paths";
import type { Goods, SettlementBuilding, SettlementContext } from "../settlement-types";
import { repairsWalls, startWallRepairer } from "../settlement-wall-repair";
import { payStorageGoods } from "../shared-storage";
import { needsWallRepair, wallRepairLoad } from "../wall-repair-rules";
import { backOffGoal, forgetGoal, isGoalDue, type MaintainRepair, type MaintainState } from "./maintain-state";

/**
 * Wall repair (enemy economy AI plan §4.1 `maintain`, EAI2d): the faction mends its own damaged walls with its own
 * settlers and depot stock. Each decision sends at most one repairer, and only while none of the faction is out: the
 * first finished building of the faction (building order) whose own walls stand below their maximum, whose backoff
 * is over and near which the faction knows no enemy (A13 threat view, as its clearers use). One trip pays the
 * restored HP's share of the construction cost from the nearest storage's free stock (`wallRepairLoad`); a short
 * stock or a missing way backs the wall off (10 s × attempts, at most 60 s), so a faction out of stock stops
 * repairing without stalling anything else. Reads only the faction's own buildings, walls and stock (plan §3.2).
 */

/** The faction's own walls on the building, when they stand and miss hit points. */
const damagedWalls = (context: SettlementContext, faction: number, building: SettlementBuilding) => {
  if (building.construction !== 1 || ownerOf(building) !== faction) return undefined;
  const walls = context.military?.factionWalls?.(building.uid, faction);
  return needsWallRepair(walls) ? walls : undefined;
};

/** Forgets the backoff of walls that were mended, fell, or left the faction. */
const pruneRepairs = (context: SettlementContext, faction: number, repairs: MaintainRepair[]) => {
  for (let index = repairs.length - 1; index >= 0; index--) {
    const building = getBuilding(context, repairs[index]!.uid);
    if (!building || !damagedWalls(context, faction, building)) repairs.splice(index, 1);
  }
};

const repairOf = (state: MaintainState, uid: number) => state.repairs.find(entry => entry.uid === uid);

/** The first building whose walls the faction may send a repairer to now (cheap checks before the threat read). */
const nextDamagedBuilding = (context: SettlementContext, faction: number, state: MaintainState, now: number) => {
  for (const building of context.buildings) {
    if (!damagedWalls(context, faction, building)) continue;
    const entry = repairOf(state, building.uid);
    if (entry && !isGoalDue(entry, now)) continue;
    if (!ownerThreatenedAt(context, faction, building.access)) return building;
  }
  return undefined;
};

const busyRepairing = (context: SettlementContext, faction: number) =>
  context.actors.some(actor => actor.hostileCivilianFaction === faction && repairsWalls(actor));

/** Whether the storage's pool can pay the whole load without touching stock promised to construction sites. */
const canPay = (context: SettlementContext, storage: SettlementBuilding, goods: Readonly<Goods>, faction: number) =>
  Object.entries(goods).every(([ware, count]) =>
    localConstructionStock(context, ware, storage.access, faction) >= count);

const backOff = (state: MaintainState, uid: number, now: number) => {
  let entry = repairOf(state, uid);
  if (!entry) {
    entry = { uid };
    state.repairs.push(entry);
  }
  backOffGoal(entry, now);
  return false;
};

/** Pays the load and sends the storage's settler out, or backs the wall off (no load, stock or way). */
const sendRepairer = (context: SettlementContext, faction: number, state: MaintainState,
  building: SettlementBuilding, now: number) => {
  const walls = damagedWalls(context, faction, building);
  const load = wallRepairLoad(getConstructionCost(building.typeId, buildingNation(context, building)), walls);
  if (!load) return backOff(state, building.uid, now);
  const storage = outingStorage(context, faction, building.access);
  // No idle settler, or an enemy at the door: wait for the next decision, no backoff.
  if (!storage) return false;
  if (!canPay(context, storage, load.goods, faction)) return backOff(state, building.uid, now);
  const path = outingPath(context, storage, building.access);
  if (!path || !payStorageGoods(context, storage, load.goods)) return backOff(state, building.uid, now);
  const actor = createActor(context, "Settler", storage.uid);
  startWallRepairer(actor, storage, { building: building.uid, hp: load.hp }, load.goods, path);
  const entry = repairOf(state, building.uid);
  if (entry) forgetGoal(state.repairs, entry);
  return true;
};

/** One `planner` decision of wall repair; returns whether a repairer was sent. */
export const repairOneWall = (context: SettlementContext, faction: number, state: MaintainState, now: number) => {
  if (!context.military?.factionWalls) return false;
  pruneRepairs(context, faction, state.repairs);
  const building = nextDamagedBuilding(context, faction, state, now);
  if (!building || busyRepairing(context, faction)) return false;
  return sendRepairer(context, faction, state, building, now);
};
