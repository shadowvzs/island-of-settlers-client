import { TROOP_DECK_SLOTS } from "../balance/colonies";
import { GARRISON_ARCHER_POSTS, MILITARY_REST_SECONDS_PER_HP } from "../balance/military";
import { COLONY_TROOP_TYPES, colonyDeckItems, packColonyLoads } from "./colony-expedition-rules";
import { militaryHealth, type MilitaryTroopType } from "./military-combat-rules";
import { compositionTotal, type GarrisonTroop,isGarrisonTroop } from "./military-garrison-rules";
import { commanderManifestError } from "./settlement-commander-transport";
import type { EmigratedTroop, MilitaryBuildingSnapshot, SettlementSoldier } from "./settlement-military";
import { MAX_SOLDIER_RANK } from "./settlement-military-ranks";
import type { NavalHomewardLoad } from "./settlement-naval-fleet";
import type { SettlementSaveV1 } from "./settlement-save-state";
import type { Goods } from "./settlement-types";

/** Archers for empty tower posts, melee soldiers for every other empty place. */
export interface GarrisonNeed { archer: number; melee: number }
export type TroopCounts = Partial<Record<MilitaryTroopType, number>>;
type MilitaryBuilding = Pick<MilitaryBuildingSnapshot, "assignedTroops" | "manual" | "target" | "typeId">;

/** A saved soldier between islands: a known troop type, a valid rank and some health left. */
export const isEmigratedTroop = (value: unknown): value is EmigratedTroop => {
  if (!value || typeof value !== "object") return false;
  const { commander, hp, rank, recoverySeconds, type } = value as Record<string, unknown>;
  if (commander !== undefined) {
    return type === "cavalry" && rank === 0 && Number.isFinite(hp) && (hp as number) >= 0 &&
      commanderManifestError(commander) === null;
  }
  return COLONY_TROOP_TYPES.includes(type as MilitaryTroopType) && Number.isSafeInteger(rank) &&
    (rank as number) >= 0 && (rank as number) <= MAX_SOLDIER_RANK && Number.isFinite(hp) && (hp as number) > 0 &&
    (recoverySeconds === undefined || (Number.isFinite(recoverySeconds) && (recoverySeconds as number) >= 0 &&
      (recoverySeconds as number) < MILITARY_REST_SECONDS_PER_HP));
};

const MELEE_FIRST: readonly GarrisonTroop[] = ["shield", "heavy", "archer"];
const ARCHERS_FIRST: readonly GarrisonTroop[] = ["archer", "shield", "heavy"];
const HARBOUR = 39;

const buildingNeed = (building: MilitaryBuilding): GarrisonNeed => {
  const assigned = building.assignedTroops;
  const missing = Math.max(0, building.target - compositionTotal(assigned));
  const archers = building.manual ? building.manual.archer : GARRISON_ARCHER_POSTS[building.typeId] ?? 0;
  const archer = Math.min(missing, Math.max(0, archers - assigned.archer));
  return { archer, melee: missing - archer };
};

/**
 * Soldiers a colony's own military buildings still miss beyond the ones `covered` (stored at the
 * harbour or sailing in): spare archers fill melee places and spare melee fill tower posts.
 */
export const garrisonShortfall = (buildings: readonly MilitaryBuilding[], covered: TroopCounts): GarrisonNeed => {
  const need = buildings.map(buildingNeed).reduce((sum, entry) =>
    ({ archer: sum.archer + entry.archer, melee: sum.melee + entry.melee }), { archer: 0, melee: 0 });
  const archers = covered.archer ?? 0, melee = (covered.shield ?? 0) + (covered.heavy ?? 0);
  const archer = Math.max(0, need.archer - archers), spareArchers = Math.max(0, archers - need.archer);
  const meleeLeft = Math.max(0, need.melee - melee - spareArchers);
  const spareMelee = Math.max(0, melee - need.melee);
  return { archer: Math.max(0, archer - spareMelee), melee: meleeLeft };
};

export const needTotal = (need: GarrisonNeed) => need.archer + need.melee;

/** Stored foot soldiers of a filed island: in a storage, not reserved for a ship. */
const storedReserves = (save: SettlementSaveV1) => {
  const actors = new Map(save.actors.map(actor => [actor.uid, actor]));
  return (save.military?.soldiers ?? []).filter(soldier => {
    const actor = actors.get(soldier.actor);
    return soldier.building === -1 && (soldier.combat?.faction ?? 0) === 0 &&
      isGarrisonTroop(soldier.combat?.type ?? "shield") && actor?.phase === "militaryReserve" &&
      actor.navalOrder === undefined;
  });
};

/** Free home reserves available for a colony's manual garrison requests. */
export const homeGarrisonReserves = (save: SettlementSaveV1) => {
  const counts = { archer: 0, heavy: 0, shield: 0 };
  for (const soldier of storedReserves(save)) {
    const type = soldier.combat?.type ?? "shield";
    if (isGarrisonTroop(type)) counts[type]++;
  }
  return counts;
};

const troopOf = (soldier: SettlementSoldier): EmigratedTroop => {
  const type = soldier.combat?.type ?? "shield";
  return { hp: soldier.combat?.hp ?? militaryHealth(type, soldier.rank), rank: soldier.rank, type,
    ...(soldier.recoverySeconds !== undefined ? { recoverySeconds: soldier.recoverySeconds } : {}) };
};

const pick = (reserves: SettlementSoldier[], order: readonly GarrisonTroop[], count: number) => {
  const picked: SettlementSoldier[] = [];
  for (const type of order) for (const soldier of reserves) {
    if (picked.length >= count) return picked;
    if ((soldier.combat?.type ?? "shield") === type && !picked.includes(soldier)) picked.push(soldier);
  }
  return picked;
};

/**
 * Takes up to `limit` stored soldiers for `need` out of a filed home island (archers for the tower
 * posts first); they leave that island for good and return as emigrated troops.
 */
export const takeHomeReserves = (save: SettlementSaveV1, need: GarrisonNeed, limit: number): EmigratedTroop[] => {
  const reserves = storedReserves(save);
  const archers = pick(reserves, ARCHERS_FIRST, Math.min(limit, need.archer));
  const rest = reserves.filter(soldier => !archers.includes(soldier));
  const chosen = [...archers, ...pick(rest, MELEE_FIRST, Math.min(limit - archers.length, need.melee))];
  if (!chosen.length || !save.military) return [];
  const leaving = new Set(chosen.map(soldier => soldier.actor));
  save.military.soldiers = save.military.soldiers.filter(soldier => !leaving.has(soldier.actor));
  save.actors = save.actors.filter(actor => !leaving.has(actor.uid));
  return chosen.map(troopOf);
};

const harbourOf = (save: SettlementSaveV1) =>
  save.buildings.find(building => building.typeId === HARBOUR && building.construction === 1);
/** Own ships of a filed island lying idle (no order, no voyage). */
const idleShips = (save: SettlementSaveV1) =>
  save.naval.fleet.ships.filter(ship => !ship.visitor && ship.phase === "idle");

/** Idle own ships of a filed island that can sail (it still has a harbour to come back to). */
export const idleShipCount = (save: SettlementSaveV1) => harbourOf(save) ? idleShips(save).length : 0;

/**
 * Idle ships of a filed home island sail for a colony: each is away for the round trip and returns
 * to its harbour on the home island's own clock. Returns how many ships left.
 */
export const sendIdleShipsAway = (
  save: SettlementSaveV1, count: number, voyage: { expeditionId: number; voyageSeconds: number },
  loads: readonly NavalHomewardLoad[] = []
) => {
  const harbour = harbourOf(save);
  if (!harbour) return 0;
  const ships = idleShips(save).slice(0, count);
  for (const [index, ship] of ships.entries()) Object.assign(ship, {
    colony: { ...voyage, arrived: true, boxes: 0, exit: { x: ship.x, z: ship.z },
      manifest: loads[index] ? { cargo: { ...loads[index]!.cargo }, jobs: { Soldier: loads[index]!.troops.length },
        troops: loads[index]!.troops.reduce((counts, troop) => {
          counts[troop.type] = (counts[troop.type] ?? 0) + 1; return counts;
        }, {} as TroopCounts) } : undefined },
    cursor: 0, destinationUid: harbour.uid, phase: "away", route: [], sourceUid: harbour.uid,
    timer: 2 * voyage.voyageSeconds
  });
  return ships.length;
};

/** Ship loads of soldiers (first) and wares, each filling one deck. */
export const shipLoads = (troops: readonly EmigratedTroop[], cargo: Goods = {}): NavalHomewardLoad[] => {
  const passengers = troops.map((troop, uid) => ({ slots: TROOP_DECK_SLOTS[troop.type], uid }));
  return packColonyLoads(colonyDeckItems(passengers, cargo)).map(load =>
    ({ cargo: load.cargo, troops: load.passengers.map(index => ({ ...troops[index]! })) }));
};

/** Stored foot soldiers plus soldiers aboard visiting ships: they will fill empty places soon. */
export const coveredTroops = (
  soldiers: readonly Pick<SettlementSoldier, "building" | "combat">[],
  ships: ReadonlyArray<{ visitor: boolean; passengerTroops: TroopCounts }>
): TroopCounts => {
  const counts: TroopCounts = {};
  const add = (type: MilitaryTroopType, count = 1) => { counts[type] = (counts[type] ?? 0) + count; };
  for (const soldier of soldiers)
    if (soldier.building === -1 && (soldier.combat?.faction ?? 0) === 0) add(soldier.combat?.type ?? "shield");
  for (const ship of ships) if (ship.visitor)
    for (const [type, count] of Object.entries(ship.passengerTroops)) add(type as MilitaryTroopType, count);
  return counts;
};
