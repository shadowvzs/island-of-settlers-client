import { STONE_TIER_WARES } from "@shared/catalog/balance";

import { HANDCART_LOGISTICS } from "../balance/economy";
import { POPULATION_GROWTH_SECONDS } from "../balance/population";
import { talentModifiers } from "../progression/talents";
import { MATERIAL_BUILDING_GROUPS } from "./advanced-material-production";
import { catapultGroundGoods } from "./catapult-ammo-kinds";
import type { GameSaveV1 } from "./game-save";
import { activeSaveKey } from "./game-save-rows";
import { nationProductionShare } from "./nation-bonuses";
import { getBuildingProductionRule } from "./production-rules";
import { productionTimeScale } from "./production-timing";
import { isActiveResidence, residenceGrowthSeconds } from "./residences";
import { isOwnBuilding } from "./settlement-home";
import type { Goods, SettlementActor, SettlementBuilding } from "./settlement-types";
import { workshopCycleFactor } from "./workshop-upgrades";

/** Margin on the production bound (phase C §8: 10 %). */
const RATE_MARGIN = 1.1;
/**
 * Goods in places the count does not see (offers, carts) and rounding: per ware, plus a share. Was 40 while quest
 * material and adventure loot were not ledger credits (D4 follow-up 2 credits them).
 */
const SLACK_UNITS = 15;
const SLACK_SHARE = 0.05;
/** The client's game time may run a little ahead of the server's real time between two uploads. */
const REAL_TIME_SLACK_SECONDS = 120;

interface PlausibilityViolation {
  after: number;
  allowed: number;
  before: number;
  /** Why a non-ware consistency check failed (currently the construction receipt). */
  reason?: string;
  ware: string;
}

export interface PlausibilityResult {
  /** Game seconds the bound allowed for. */
  seconds: number;
  violations: PlausibilityViolation[];
}

/**
 * What the decoded before/after maps attribute to the world itself. The bundle fills this in only when every
 * island pair decoded; absent means the map-specific checks are skipped and the production bound stands alone.
 */
export interface PlausibilityResourceDelta {
  /** One felled tree yields one log of its species, by log ware (logs, hardwoodLogs, ...). */
  felledTrees: Readonly<Goods>;
  /** Ore taken from surveyed mine zones, by ore ware (coal, ironOre, goldOre, granite stone). */
  minedOre: Readonly<Goods>;
  /** Finite stone/marble source extraction, including one respawn cycle when the interval permits it. */
  stoneSources?: Readonly<Goods>;
  /** Ore/stone from off-screen colony ore ships that leaves no decrease on a local map. */
  colonyShipments?: Readonly<Goods>;
}

export interface PlausibilityInput {
  after: GameSaveV1;
  before: GameSaveV1;
  /** Goods the server's ledger paid in between (level/quest coins, quest material, adventure loot, gem shop). */
  credits: Readonly<Goods>;
  /** Real seconds the server saw between the two uploads. */
  realSeconds: number;
  /**
   * Map-derived resource deltas (trees, surveyed ore). Only the async server bundle can decode maps; sync callers
   * omit this and keep the production-only bound.
   */
  resources?: PlausibilityResourceDelta;
}

const add = (goods: Goods, ware: string, count: number) => {
  if (Number.isFinite(count) && count > 0) goods[ware] = (goods[ware] ?? 0) + count;
};
const addAll = (goods: Goods, more: Readonly<Goods> | undefined) => {
  for (const [ware, count] of Object.entries(more ?? {})) add(goods, ware, count);
};

/** Every `cargo` goods object below `value` (ships, evacuations): goods on their way still count. */
const addCargo = (goods: Goods, value: unknown, depth = 0) => {
  if (!value || typeof value !== "object" || depth > 8) return;
  for (const [key, child] of Object.entries(value)) {
    if (key === "cargo" && child && typeof child === "object" && !Array.isArray(child)) addAll(goods, child as Goods);
    else addCargo(goods, child, depth + 1);
  }
};

/** Wares in trade escrow (offers, merchant payments): reserved in a storage or the harbour's trade stock. */
const addTradeEscrow = (goods: Goods, trade: unknown) => {
  const escrow = (trade as { escrow?: { held?: { goods?: Goods }[]; staged?: Goods }[] } | undefined)?.escrow;
  for (const entry of escrow ?? []) {
    for (const held of entry.held ?? []) addAll(goods, held.goods);
    addAll(goods, entry.staged);
  }
};

/**
 * Wares a trade ship still owes the island (`delivery.goods`): merchant purchases, sale proceeds and refunds.
 * They are not in a storage, an escrow or a carrier box, so without this the goods appear from nowhere when
 * the ship unloads. `aboard` is part of `goods`; `outbound` is still inside its escrow.
 */
const addTradeDeliveries = (goods: Goods, trade: unknown) => {
  const deliveries = (trade as { deliveries?: { goods?: Goods }[] } | undefined)?.deliveries;
  for (const delivery of deliveries ?? []) addAll(goods, delivery.goods);
};

/**
 * Goods on a hand cart bed plus a storage source's prepaid items (already debited from its inventory but not
 * loaded yet). Both are player property outside every building stock; a trip moves them between counted places.
 */
const addHandcartCargo = (goods: Goods, actor: SettlementActor) => {
  const cart = actor.handcart, trip = cart?.trip;
  if (!cart || !trip || typeof trip.ware !== "string") return;
  add(goods, trip.ware, (cart.cargo ?? 0) + (trip.prepaid ?? 0));
};

/** Wares landed on a colony/adventure that has no island save yet; its `landing` holds them until first visit. */
const addLandingHoldings = (goods: Goods, group: GameSaveV1["archipelago"]) => {
  for (const record of [...group?.colonies ?? [], ...group?.adventures ?? []]) {
    if (record.save) continue;
    addAll(goods, record.landing?.landed);
  }
};

interface IslandEntry { key: string; save: GameSaveV1 }
/**
 * The islands a game holds, keyed by their save row so before/after pairs match across a travel. A campaign run on
 * screen is left out (campaign server part 2): its map may author stock and buildings, nothing of it returns home
 * except the ledger-credited victory reward, and its own command log replay is what the reward route trusts.
 */
const islandEntries = (game: GameSaveV1): IslandEntry[] => {
  const group = game.archipelago;
  return [
    ...game.campaignRun ? [] : [{ key: activeSaveKey(game), save: game }],
    ...group?.home ? [{ key: "home", save: group.home }] : [],
    ...(group?.colonies ?? []).flatMap(colony => colony.save
      ? [{ key: `colony-${colony.expeditionId}`, save: colony.save }] : []),
    ...(group?.adventures ?? []).flatMap(adventure => adventure.save
      ? [{ key: `adventure-${adventure.expeditionId}`, save: adventure.save }] : [])
  ];
};
const islandsOf = (game: GameSaveV1) => islandEntries(game).map(entry => entry.save);

/** Wares the player holds anywhere: stores, upgrades, carts, trade escrow/deliveries, carriers, ships, rewards,
 * landing parties and evacuations. */
export const playerHoldings = (game: GameSaveV1): Goods => {
  const goods: Goods = {};
  for (const island of islandsOf(game)) {
    for (const building of island.settlement.buildings ?? []) {
      if (!isOwnBuilding(building)) continue;
      addAll(goods, building.inventory); addAll(goods, building.input); addAll(goods, building.output);
      addAll(goods, catapultGroundGoods(building.catapultSupply));
      // An upgrade's reserved wares sit outside inventory/input/output until it completes or is cancelled.
      addAll(goods, building.workshopUpgrade?.reserved);
      // Carts hold the logs they were built from; dismantling one refunds them into storage.
      add(goods, "logs", (building.handcarts ?? 0) * (HANDCART_LOGISTICS.cost.logs ?? 0));
    }
    const enemySoldiers = new Set((island.settlement.military?.soldiers ?? [])
      .filter(soldier => (soldier.combat?.faction ?? 0) > 0).map(soldier => soldier.actor));
    for (const actor of island.settlement.actors ?? []) {
      if (enemySoldiers.has(actor.uid)) continue;
      if (actor.ware) add(goods, actor.ware, actor.wareUnits ?? 1);
      addHandcartCargo(goods, actor);
      addAll(goods, actor.demolitionCargo);
    }
    // A load a fleeing cart crew left on the bed (MIL-CREWS).
    for (const cart of island.settlement.abandonedHandcarts ?? [])
      if (cart.ware) add(goods, cart.ware, cart.cargo ?? 0);
    addCargo(goods, island.settlement.naval);
    addTradeEscrow(goods, island.settlement.trade);
    addTradeDeliveries(goods, island.settlement.trade);
  }
  addAll(goods, game.archipelago?.rewards);
  addCargo(goods, game.archipelago?.evacuations);
  addLandingHoldings(goods, game.archipelago);
  return goods;
};

/** The fastest a building can produce, per ware per second: its cycle without walking, upgrades and talents. */
const addBuildingRates = (rates: Goods, building: SettlementBuilding, nation: GameSaveV1["settlement"]["playerNation"],
  talentBonus: number) => {
  if (building.construction !== 1 || !isOwnBuilding(building)) return;
  const rule = getBuildingProductionRule(building, nation);
  if (!rule || rule.service || !(rule.seconds > 0)) return;
  const factor = workshopCycleFactor(building,
    talentBonus + nationProductionShare(nation, building.typeId));
  for (const ware of rule.outputs)
    rates[ware] = (rates[ware] ?? 0) + factor / (rule.seconds * productionTimeScale(building.typeId, ware));
};

/** Production capacity of every island of a game (ware per second; talents at their best case). */
export const productionRates = (game: GameSaveV1): Goods => {
  const talents = talentModifiers(game.player?.talents);
  const bonus = talents.productionSpeed + talents.colonyProductionSpeed + talents.hunterFisherSpeed;
  const rates: Goods = {};
  for (const island of islandsOf(game))
    for (const building of island.settlement.buildings ?? [])
      addBuildingRates(rates, building, island.settlement.playerNation, bonus);
  return rates;
};

/**
 * Extra bound for single-output chains: the output growth cannot exceed the inputs available from the
 * starting stock, the observed production capacity and the ledger credits. Multi-output workshops are
 * skipped because their outputs cannot be attributed to one recipe ratio.
 */
const chainOutputCaps = (input: PlausibilityInput, seconds: number, before: Readonly<Goods>,
  earlyRates: Readonly<Goods>, lateRates: Readonly<Goods>) => {
  const caps = new Map<string, number>();
  const consider = (game: GameSaveV1) => {
    for (const island of islandsOf(game)) for (const building of island.settlement.buildings ?? []) {
      if (building.construction !== 1 || !isOwnBuilding(building)) continue;
      const rule = getBuildingProductionRule(building, island.settlement.playerNation);
      if (!rule || rule.service || rule.alternativeFood || rule.outputs.length !== 1 || !rule.inputs.length) continue;
      const output = rule.outputs[0]!, inputCounts = new Map<string, number>();
      for (const ware of rule.inputs) inputCounts.set(ware, (inputCounts.get(ware) ?? 0) + 1);
      let cap = Infinity;
      for (const [ware, perCycle] of inputCounts) {
        const held = before[ware] ?? 0;
        const rate = Math.max(earlyRates[ware] ?? 0, lateRates[ware] ?? 0);
        const available = held + rate * seconds * RATE_MARGIN + (input.credits[ware] ?? 0) +
          SLACK_UNITS + held * SLACK_SHARE;
        cap = Math.min(cap, available / perCycle);
      }
      if (!Number.isFinite(cap)) continue;
      const outputCount = rule.outputs.filter(ware => ware === output).length;
      caps.set(output, Math.max(caps.get(output) ?? 0, cap * outputCount));
    }
  };
  consider(input.before);
  consider(input.after);
  return caps;
};

/** Settler births per second on one island: the base timer plus every completed residence. */
const islandBirthRate = (island: GameSaveV1) => {
  let rate = 1 / POPULATION_GROWTH_SECONDS;
  for (const building of island.settlement.buildings ?? [])
    if (isActiveResidence(building)) rate += 1 / residenceGrowthSeconds(building.typeId);
  return rate;
};

/** Seconds the bound allows: the game time between the saves, at most the server's real time plus a slack. */
export const plausibilitySeconds = (before: GameSaveV1, after: GameSaveV1, realSeconds: number) => {
  const game = Math.max(0, (after.savedAt - before.savedAt) / 1000);
  return Math.min(game, Math.max(0, realSeconds) + REAL_TIME_SLACK_SECONDS);
};
const boundSeconds = (input: PlausibilityInput) =>
  plausibilitySeconds(input.before, input.after, input.realSeconds);

/** Wares a tree species yields: ordinary trees give logs, a colony's specialist trees their own logs. */
const LOG_WARES: ReadonlySet<string> = new Set([
  "logs", ...MATERIAL_BUILDING_GROUPS.map(group => group.logs)
]);
/** Ores whose world source is a surveyed mine; non-mine production (coal from charburners) is added separately. */
const ORE_WARES: ReadonlySet<string> = new Set(["coal", "ironOre", "goldOre"]);
/** Quarry/deposit wares with finite stone sources; the ordinary production bound still applies too. */
const STONE_WARES: ReadonlySet<string> = new Set(STONE_TIER_WARES);

const addViolation = (violations: PlausibilityViolation[], violation: PlausibilityViolation) => {
  if (!violations.some(entry => entry.ware === violation.ware)) violations.push(violation);
};

/** Production of an ore ware outside its mine: coal also comes from the charburner's logs. */
const nonMineRate = (game: GameSaveV1, ware: string) => {
  const talents = talentModifiers(game.player?.talents);
  const bonus = talents.productionSpeed + talents.colonyProductionSpeed + talents.hunterFisherSpeed;
  let rate = 0;
  for (const island of islandsOf(game)) for (const building of island.settlement.buildings ?? []) {
    if (building.construction !== 1 || !isOwnBuilding(building)) continue;
    // Mine output is already counted from the surveyed ore decrease.
    if (building.typeId >= 10 && building.typeId <= 13) continue;
    const rule = getBuildingProductionRule(building, island.settlement.playerNation);
    if (!rule || rule.service || !(rule.seconds > 0)) continue;
    const outputs = rule.outputs.filter(output => output === ware).length;
    if (!outputs) continue;
    rate += outputs * workshopCycleFactor(building,
      bonus + nationProductionShare(island.settlement.playerNation, building.typeId)) /
      (rule.seconds * productionTimeScale(building.typeId, ware));
  }
  return rate;
};

/**
 * Extra map-derived bounds. Felling one tree makes one log, so logs cannot grow by more than the trees the
 * maps lost (plus credits and the usual slack for goods in flight). Surveyed ore decreases bound coal, iron
 * and gold the same way; colony ore ships leave no local decrease and are allowed by their mine-hour capacity,
 * and coal also gets the charburner's (log-fed) capacity rather than being mistaken for mined coal.
 *
 * TODO(D4): stone/marble is deliberately not bounded here. `runtime.stone` and `settlement.marbleDeposits`
 * store remaining amounts, but a worked-out source respawns after STONE_SOURCE_REST_SECONDS, so a
 * before/after delta is not an upper bound on quarried units without replaying those timers. The production
 * bound still limits quarry output; do not add a silent approximation.
 */
const checkResourceGrowth = (input: PlausibilityInput, seconds: number, before: Readonly<Goods>,
  after: Readonly<Goods>, violations: PlausibilityViolation[]) => {
  const resources = input.resources;
  if (!resources) return;
  const cap = (ware: string, source: number) => {
    const held = before[ware] ?? 0, count = after[ware] ?? 0;
    const allowed = held + source + (input.credits[ware] ?? 0) + SLACK_UNITS + held * SLACK_SHARE;
    if (count > allowed) addViolation(violations, { after: count, allowed: Math.floor(allowed), before: held, ware });
  };
  for (const ware of LOG_WARES) cap(ware, resources.felledTrees[ware] ?? 0);
  for (const ware of ORE_WARES) {
    const nonMine = Math.max(nonMineRate(input.before, ware), nonMineRate(input.after, ware));
    cap(ware, (resources.minedOre[ware] ?? 0) + (resources.colonyShipments?.[ware] ?? 0) +
      nonMine * seconds * RATE_MARGIN);
  }
  // The map/runtime pass also attributes finite quarry and material sources. Do not run this
  // stricter check when an older save carries no source ledger; the production bound still applies.
  if (resources.stoneSources || resources.minedOre.stone) {
    for (const ware of STONE_WARES) {
      const produced = Math.max(nonMineRate(input.before, ware), nonMineRate(input.after, ware)) *
        seconds * RATE_MARGIN;
      cap(ware, (resources.stoneSources?.[ware] ?? 0) + (resources.colonyShipments?.[ware] ?? 0) +
        (ware === "stone" ? resources.minedOre.stone ?? 0 : 0) + produced);
    }
  }
};

/**
 * A building that was still under construction in the earlier snapshot and is finished in the later one must
 * carry the earlier blueprint as consumed material (`constructionConsumed`). Completion cannot consume less (or
 * more) than the blueprint, and the receipt is never cleared afterwards. Buildings without a saved receipt or
 * whose blueprint was already empty are skipped, so prebuilt structures and older saves never fail this check.
 */
const constructionReceiptProblem = (old: SettlementBuilding | undefined, building: SettlementBuilding) => {
  if (building.construction !== 1 || !isOwnBuilding(building)) return null;
  if (!old || old.typeId !== building.typeId || old.construction >= 1) return null;
  if (!Object.keys(old.required ?? {}).length || old.constructionConsumed === undefined) return null;
  const consumed = building.constructionConsumed ?? {};
  const missing = Object.entries(old.required).find(([ware, count]) => (consumed[ware] ?? 0) !== count);
  return missing ? `completed ${building.typeId} without the ${missing[0]} construction receipt` : null;
};
const checkConstructionReceipts = (before: GameSaveV1, after: GameSaveV1, violations: PlausibilityViolation[]) => {
  const earlierIslands = new Map(islandEntries(before).map(entry => [entry.key, entry.save]));
  for (const { key, save } of islandEntries(after)) {
    const earlier = earlierIslands.get(key);
    if (!earlier) continue;
    const earlierBuildings = new Map((earlier.settlement.buildings ?? []).map(building => [building.uid, building]));
    for (const building of save.settlement.buildings ?? []) {
      const problem = constructionReceiptProblem(earlierBuildings.get(building.uid), building);
      if (!problem) continue;
      addViolation(violations, { after: 1, allowed: 0, before: 0, reason: problem, ware: "construction" });
      break;
    }
  }
};

/**
 * Production plausibility of an upload (BACKEND-04, phase C §8): no ware may grow beyond what the islands could
 * produce in the elapsed time (the faster of both snapshots' buildings, 10 % margin), plus the ledger's credits and
 * a slack for goods the count does not see. Consumption and walking are ignored, so it is an upper bound; gems
 * are the ledger's own check. When the caller decoded the maps, tree felling and surveyed ore also cap their wares.
 */
export const checkPlausibility = (input: PlausibilityInput): PlausibilityResult => {
  const seconds = boundSeconds(input);
  const before = playerHoldings(input.before), after = playerHoldings(input.after);
  const early = productionRates(input.before), late = productionRates(input.after);
  const violations: PlausibilityViolation[] = [];
  for (const [ware, count] of Object.entries(after)) {
    if (ware === "gems") continue;
    const held = before[ware] ?? 0, rate = Math.max(early[ware] ?? 0, late[ware] ?? 0);
    const allowed = held + rate * seconds * RATE_MARGIN + (input.credits[ware] ?? 0) + SLACK_UNITS + held * SLACK_SHARE;
    if (count > allowed) violations.push({ after: count, allowed: Math.floor(allowed), before: held, ware });
  }
  // A single-output chain also cannot outrun the inputs it could have had. This is deliberately a
  // conservative upper bound (starting stock + measured capacity + credits), not a full consumption ledger.
  for (const [ware, cap] of chainOutputCaps(input, seconds, before, early, late)) {
    const held = before[ware] ?? 0, count = after[ware] ?? 0;
    if (count - held > cap && !violations.some(violation => violation.ware === ware))
      violations.push({ after: count - held, allowed: Math.floor(held + cap), before: held, ware });
  }
  // Births are the other server-visible growth: the base island timer plus every completed residence,
  // at the settler-growth talent's best case. One extra per island absorbs a timer that was about to fire.
  const beforeIslands = islandsOf(input.before), afterIslands = islandsOf(input.after);
  const growthSpeed = talentModifiers(input.after.player?.talents).settlerGrowthSpeed;
  const birthRate = Math.max(
    beforeIslands.reduce((sum, island) => sum + islandBirthRate(island), 0),
    afterIslands.reduce((sum, island) => sum + islandBirthRate(island), 0)
  );
  const allowedBirths = birthRate * (1 + growthSpeed) * seconds * RATE_MARGIN +
    Math.max(beforeIslands.length, afterIslands.length);
  const beforeBirths = beforeIslands
    .reduce((sum, island) => sum + (island.settlement.settlerBirths ?? 0), 0);
  const afterBirths = afterIslands.reduce((sum, island) => sum + (island.settlement.settlerBirths ?? 0), 0);
  if (afterBirths - beforeBirths > allowedBirths)
    violations.push({ after: afterBirths - beforeBirths, allowed: Math.floor(allowedBirths),
      before: beforeBirths, ware: "births" });
  checkConstructionReceipts(input.before, input.after, violations);
  checkResourceGrowth(input, seconds, before, after, violations);
  return { seconds, violations };
};
