import type { ScenarioFactionAi } from "../../world/scenario-faction-ai";
import { applyArmoryOrder, ARMORY_OUTPUTS, armoryOrder } from "../armory-orders";
import { ARMORY_TYPE_ID, TAVERN_TYPE_ID } from "../building-type-ids";
import type { OrdinaryTroopType } from "../military-combat-rules";
import { ownerOf } from "../settlement-ownership";
import { ownerSpareSettlers } from "../settlement-population";
import type { SettlementBuilding, SettlementContext } from "../settlement-types";
import { TAVERN_RECIPES } from "../tavern-rules";
import { DEFAULT_RECRUIT, RECRUIT_SPARE_SETTLERS, RECRUITS_PER_ORDER } from "./constants";
import { garrisonDemand } from "./develop-garrison";
import { developSoldierLimit } from "./develop-level";
import { type EconomyStock, economyWareIndex, freeStock } from "./economy-stock";

/** The faction's soldiers alive (in buildings, in its depot and in the field). */
export const factionSoldierCount = (context: SettlementContext, faction: number) => {
  const records = context.military?.soldierRecords?.();
  let count = 0;
  if (!records) return count;
  for (const soldier of records) if (soldier.combat?.faction === faction) count++;
  return count;
};

/** The troop the director asks for first (A14-4c `armyRequests`; never cavalry), else a swordsman. */
const requestedTroop = (context: SettlementContext, faction: number): OrdinaryTroopType =>
  context.militaryDirector?.strategy.armyRequests(faction)[0]?.type ?? DEFAULT_RECRUIT;

/** The soldiers the director's requests still ask for (losses, shortfalls, counters). */
const requestedSoldiers = (context: SettlementContext, faction: number) => {
  let count = 0;
  for (const request of context.militaryDirector?.strategy.armyRequests(faction) ?? []) count += request.count;
  return count;
};

/**
 * Recruits the economy funds now (plan §3.6/§3.7): its garrison targets, its style's depot reserve (`reserve`: for
 * the next tower and its forces) and what the director asks for, within its soldier limit, minus the soldiers
 * it has and has queued.
 */
const recruitsWanted = (context: SettlementContext, entry: ScenarioFactionAi, fortify: boolean, reserve: number) => {
  const { faction } = entry;
  const wanted = Math.min(developSoldierLimit(context, entry),
    garrisonDemand(context, faction, fortify) + reserve + requestedSoldiers(context, faction));
  const queued = context.tavern?.queuedRecruits?.(faction) ?? 0;
  return Math.max(0, wanted - factionSoldierCount(context, faction) - queued);
};

/** The equipment of `count` recruits of `type` the faction's free stock lacks, per armory ware. */
const missingWeapon = (stock: EconomyStock, type: OrdinaryTroopType, ware: string, count: number) => {
  const each = TAVERN_RECIPES[type][ware] ?? 0;
  if (!each) return 0;
  const index = economyWareIndex(ware);
  return Math.max(0, each * count - (index < 0 ? 0 : freeStock(stock, index)));
};

/**
 * Orders the armory's weapons for the recruits the economy funds (the player's armory order lever): each output's
 * order is what those recruits still lack beyond the free stock and the armory's own output; an output no recruit
 * needs gets 0, so the armory makes nothing the economy does not use.
 */
const orderWeapons = (building: SettlementBuilding, stock: EconomyStock, type: OrdinaryTroopType, count: number) => {
  for (const ware of ARMORY_OUTPUTS) {
    const order = Math.max(0, missingWeapon(stock, type, ware, count) - (building.output[ware] ?? 0));
    if (armoryOrder(building, ware) !== order) applyArmoryOrder(building, ware, order);
  }
};

/** The faction's free stock holds every ware of one recruit's recipe. */
const recipeInStock = (stock: EconomyStock, type: OrdinaryTroopType) => {
  const recipe = TAVERN_RECIPES[type];
  for (const ware in recipe) {
    const index = economyWareIndex(ware);
    if (index < 0 || freeStock(stock, index) < recipe[ware]!) return false;
  }
  return true;
};

/** One recruit order at the first own Academy with an empty queue, while the recipe and a spare settler are there. */
const orderRecruit = (context: SettlementContext, faction: number, stock: EconomyStock, type: OrdinaryTroopType) => {
  const tavern = context.tavern;
  if (!tavern?.orderRecruits || tavern.queuedRecruits?.(faction) || !recipeInStock(stock, type)) return false;
  if (ownerSpareSettlers(context, faction, "worker") <= RECRUIT_SPARE_SETTLERS) return false;
  for (const building of context.buildings) {
    if (building.typeId !== TAVERN_TYPE_ID || building.construction !== 1 || ownerOf(building) !== faction) continue;
    if (tavern.orderRecruits(building.uid, type, RECRUITS_PER_ORDER, faction).ok) return true;
  }
  return false;
};

/**
 * The economy layer's military step of a `develop` faction (plan §3.6, EAI4a): it decides how many soldiers to fund
 * (`recruitsWanted`), orders their weapons at its armories and one recruit at a time at its Academy from its own
 * wares. The Academy's carriers bring the equipment; nothing is written to stock. `stock` is the decision's read;
 * `reserve` the soldiers its style keeps beyond its garrisons (EAI5a).
 */
export const runMilitaryEconomy = (
  context: SettlementContext, entry: ScenarioFactionAi, stock: EconomyStock, fortify: boolean, reserve: number
) => {
  const { faction } = entry;
  const wanted = recruitsWanted(context, entry, fortify, reserve);
  const type = requestedTroop(context, faction);
  for (const building of context.buildings)
    if (building.typeId === ARMORY_TYPE_ID && building.construction === 1 && ownerOf(building) === faction)
      orderWeapons(building, stock, type, wanted);
  return wanted > 0 && orderRecruit(context, faction, stock, type);
};
