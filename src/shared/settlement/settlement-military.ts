import {
  GARRISON_CAPACITIES, MILITARY_TRAINING_FRAME_SPAN, MILITARY_TRAINING_MIN_FRAMES
} from "../balance/military";
import { deterministicPow } from "../math/deterministic-math";
import { countIslandAction } from "../script-world/script-action-counters";
import { emitSoldierPromoted } from "../script-world/script-unit-events";
import type { CatapultStatus } from "./military-catapult";
import {
  isOrdinaryTroopType, type MilitaryCombatant, militaryHealth, militaryPace, militaryTroopTool,
  type MilitaryTroopType, ORDINARY_TROOP_TYPES
} from "./military-combat-rules";
import { payMilitaryCost } from "./military-economy";
import type { GarrisonComposition, GarrisonTroop } from "./military-garrison-rules";
import { createMilitaryOrderQueues } from "./military-order-queue";
import { createMilitaryOrders } from "./military-orders";
import { nationMilitarySpeedFactor } from "./nation-bonuses";
import { nationDrinkChain } from "./nation-drinks";
import { addGood } from "./production-rules";
import { getBuilding } from "./settlement-building-index";
import { createSettlementCombat } from "./settlement-combat";
import { COMBAT_PHASE } from "./settlement-combat-tick-inputs";
import { createCommanderSystem } from "./settlement-commander-state";
import { exitPath } from "./settlement-entrance";
import { isOwnBuilding } from "./settlement-home";
import { createMilitaryActorUpdate } from "./settlement-military-actor-update";
import { createMilitaryControls } from "./settlement-military-controls";
import { createGarrisonScheduler, warehousesFor } from "./settlement-military-garrison-scheduler";
import { MAX_SOLDIER_RANK, migrateLegacyMilitaryRank } from "./settlement-military-ranks";
import { advanceMilitaryRecovery } from "./settlement-military-recovery";
import { createReserveRelease } from "./settlement-military-reserve-release";
import { releaseRemovedSiteSoldiers } from "./settlement-military-site-removal";
import { createSoldierBuildingIndex, type SoldierLookup } from "./settlement-military-soldier-index";
import { createMilitaryState } from "./settlement-military-state";
import {
  createMilitaryStorage, grantTrainingReserves, trainingEncounterPoints
} from "./settlement-military-storage";
import { militarySupplyDemand } from "./settlement-military-supplies";
import { createMilitaryTransfers } from "./settlement-military-transfers";
import { hasEconomy, ownerOf, PLAYER_FACTION } from "./settlement-ownership";
import { setActorPath } from "./settlement-paths";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "./settlement-types";
import { scriptedRandom } from "./simulation-random";
import { markTickPhase } from "./tick-phase-profile";

/** The weapon a soldier of this type carries in the hand. */
const soldierTool = militaryTroopTool;

/** A soldier who left this island; the destination island recreates the actor from it. */
export interface EmigratedTroop {
  hp: number; rank: number; type: MilitaryTroopType;
  /** Partial resting minute carried across island/ship transport, if any. */
  recoverySeconds?: number;
  /** A mounted commander's stable player-wide identity and transport receipt. */
  commander?: import("./settlement-commander-transport").CommanderManifest;
}

/** Troop limits (castle 10); ranks are recruit (0), soldier (1), veteran (2). */
export interface SettlementSoldier {
  actor: number; rank: number; building: number; stationed: boolean; stationedOrder?: number;
  /** Stable player commander identity; commanders use the mounted profile without ordinary promotion. */
  commanderId?: string;
  /** Eligible resting seconds toward the next 1 HP; always below one minute. */
  recoverySeconds?: number; combat?: MilitaryCombatant;
}
/** Stationed soldiers per type and rank index (rank 0..MAX_SOLDIER_RANK). */
export type GarrisonRankCounts = Readonly<Record<GarrisonTroop, readonly number[]>>;
export interface MilitaryBuildingSnapshot {
  stoneStock?: number; stoneGround?: number; stoneCarried?: number; stoneIncoming?: number;
  catapultStatus?: CatapultStatus;
  uid: number; typeId: number; capacity: number; target: number; coinsAllowed: boolean;
  /** Local supply stock only, never warehouse totals; incoming reservations are separate. */
  coinCapacity: number; coinStock: number; coinIncoming: number;
  drinkWare: string; drinkCapacity: number; drinkStock: number; drinkIncoming: number;
  stationed: number; travelling: number; ranks: number[]; trainingFocus: MilitaryTrainingFocus;
  /** Per-type counts inside, and including those on their way. */
  stationedTroops: GarrisonComposition; assignedTroops: GarrisonComposition;
  /** Physically inside soldiers, grouped by type and rank. */
  stationedByRank: GarrisonRankCounts;
  /** Manual per-type counts, or null while the building fills automatically. */
  manual: GarrisonComposition | null;
}
/** What carriers must still bring to one military building for promotion. */
/** `stone` units of the tower's chosen `stoneWare` ammunition kind. */
export interface MilitarySupplyDemand {
  coins: number; drink: number; drinkWare: string; stone?: number; stoneWare?: string;
}
export type MilitaryTrainingFocus = "balanced" | "elite";
/** One coin advances one eligible soldier by one tier; array order resolves equal ranks. */
export const promoteMilitaryRanks = (ranks: readonly number[], focus: MilitaryTrainingFocus = "balanced") => {
  const promoted = ranks.slice();
  let selected = -1;
  for (let index = 0; index < ranks.length; index++) {
    const rank = ranks[index]!;
    if (rank < 0 || rank >= MAX_SOLDIER_RANK) continue;
    if (selected < 0 || (focus === "elite" ? rank > ranks[selected]! : rank < ranks[selected]!)) selected = index;
  }
  if (selected >= 0) promoted[selected] = ranks[selected]! + 1;
  return promoted;
};
/** Promotes one living soldier, preserving its health fraction and any partial resting minute. */
export const promoteSettlementSoldier = (soldier: SettlementSoldier, rank: number) => {
  const combat = soldier.combat;
  if (!combat || combat.hp <= 0) return false;
  const maximum = militaryHealth(combat.type, rank);
  combat.hp = Math.min(maximum, combat.hp * deterministicPow(1.2, rank - soldier.rank));
  soldier.rank = rank;
  if (combat.hp >= maximum) delete soldier.recoverySeconds;
  return true;
};

interface MilitaryTrainingDeps {
  drinkWare: string;
  /** A soldier of any faction rose to `rank` (the tutorial counts the player's, the map script all). */
  onPromoted: (soldier: SettlementSoldier, rank: number) => void;
  randomFrames: (base: number, span: number, building: number) => number;
  trainTimers: Map<number, number>;
  trainingFocus: Map<number, MilitaryTrainingFocus>;
}
const updateMilitaryTraining = (
  building: SettlementBuilding, soldiers: readonly SettlementSoldier[], dt: number, deps: MilitaryTrainingDeps
) => {
  const stationed = soldiers.filter((soldier) => soldier.stationed)
    .sort((a, b) => (a.stationedOrder ?? a.actor) - (b.stationedOrder ?? b.actor));
  // Promotion is a service paid atomically from both local supplies. Disabling deliveries does
  // not destroy already-delivered coins or drink, or prevent their use.
  if (!stationed.some((soldier) => soldier.rank < MAX_SOLDIER_RANK) ||
    (building.input.coins ?? 0) < 1 || (building.input[deps.drinkWare] ?? 0) < 1) {
    deps.trainTimers.delete(building.uid); building.working = false; return;
  }
  const trainingDelay = deps.trainTimers.get(building.uid) ??
    deps.randomFrames(MILITARY_TRAINING_MIN_FRAMES, MILITARY_TRAINING_FRAME_SPAN, building.uid);
  const remaining = trainingDelay - dt;
  deps.trainTimers.set(building.uid, remaining); building.working = true;
  if (remaining > 0) return;
  const ranks = promoteMilitaryRanks(stationed.map((soldier) => soldier.rank), deps.trainingFocus.get(building.uid));
  if (!ranks.some((rank, index) => rank > stationed[index]!.rank)) {
    deps.trainTimers.delete(building.uid); building.working = false; return;
  }
  stationed.forEach((soldier, index) => {
    const previous = soldier.rank, rank = ranks[index]!;
    if (!promoteSettlementSoldier(soldier, rank)) return;
    if (rank > previous) deps.onPromoted(soldier, rank);
  });
  addGood(building.input, "coins", -1);
  addGood(building.input, deps.drinkWare, -1);
  deps.trainTimers.delete(building.uid);
};

/** One island's military training passes; kept outside the factory to keep its setup under the limit. */
const advanceMilitaryTraining = (
  buildings: readonly SettlementBuilding[], lookup: SoldierLookup, dt: number, deps: MilitaryTrainingDeps
) => {
  for (const building of buildings)
    updateMilitaryTraining(building, lookup(building.uid), dt, deps);
};

/** Actual finite soldiers, recruitment at storage, road deployment and coin-and-drink promotion. */
export const createSettlementMilitary = (context: SettlementContext, suppliedRandom?: () => number) => {
  const state = createMilitaryState(context);
  const { coinsAllowed, compositions, recruitTimers, soldiers, targets, trainingFocus, trainTimers } = state;
  const random = suppliedRandom ? scriptedRandom("military", suppliedRandom) : state.random;
  const commander = createCommanderSystem(context, soldiers);
  context.commander = commander;
  const combat = createSettlementCombat(context, soldiers, random);
  const randomFrames = (base: number, span: number, building: number) =>
    (base + Math.floor(Math.max(0, Math.min(0.999999, random.at("military.trainingDelay", building)())) * span)) * 0.05;
  const drinkWare = nationDrinkChain(context.playerNation).drink;
  const isMilitaryBuilding = (building: SettlementBuilding) =>
    building.construction === 1 && isOwnBuilding(building) &&
    GARRISON_CAPACITIES[building.typeId] !== undefined &&
    (building.typeId !== 16 || combat.buildingStanding(building.uid));
  const militaryBuildings = () => context.buildings.filter(isMilitaryBuilding);
  /** A finished garrison building of a computer faction that runs an economy (enemy economy AI, EAI2b). */
  const isEconomyGarrison = (building: SettlementBuilding) => building.construction === 1 &&
    !isOwnBuilding(building) && GARRISON_CAPACITIES[building.typeId] !== undefined &&
    hasEconomy(context, ownerOf(building));
  const soldierIndex = createSoldierBuildingIndex(soldiers);
  /** One building's soldiers by a direct scan, for calls outside the indexed pass. */
  const scanTroops = (building: number) => [...soldiers.values()].filter((soldier) => soldier.building === building);
  const orders = createMilitaryOrders(context, soldiers, combat);
  const storage = createMilitaryStorage(context, soldiers, GARRISON_CAPACITIES, (uid, count) => {
    targets.set(uid, Math.max(targets.get(uid) ?? 0, count));
  });
  const queueOrders = {
    ...orders,
    siegeAccepted: (ids: readonly number[], uid: number) => {
      const before = new Set(ids.filter(id => soldiers.get(id)?.combat?.siege === uid));
      orders.siege(ids, uid);
      return ids.filter(id => soldiers.get(id)?.combat?.siege === uid && !before.has(id));
    },
    garrisonAccepted: (ids: readonly number[], uid: number) => {
      const before = new Set(ids.filter(id => soldiers.get(id)?.building === uid));
      storage.garrison(ids, uid);
      return ids.filter(id => soldiers.get(id)?.building === uid && !before.has(id));
    },
    returnAccepted: (ids: readonly number[], uid: number) => {
      const before = new Set(ids.filter(id => soldiers.get(id)?.combat?.returnToStorage));
      combat.returnHome(ids, uid);
      return ids.filter(id => soldiers.get(id)?.combat?.returnToStorage && !before.has(id));
    },
    boardAccepted: (ids: readonly number[], ship: number) => {
      const result = context.options.embarkMilitary?.(ids, ship);
      return result?.ok ? result.boarding : [];
    }
  };
  const queues = createMilitaryOrderQueues(context, soldiers, queueOrders,
    { actorById: combat.actorById, chaseRefusal: combat.chase.refusal, marchPending: combat.marchPending });
  const scheduler = createGarrisonScheduler(context, { buildingStanding: combat.buildingStanding, compositions,
    fortifyEconomyGarrison: combat.fortifyEconomyGarrison, isEconomyGarrison, militaryBuildings, soldierIndex,
    soldiers, storage, targets });
  const { releaseSurplus, scheduleWith, target } = scheduler;
  const reserveRelease = createReserveRelease(context, { isEconomyGarrison, march: combat.commandOpponent,
    soldierIndex, soldiers, standing: combat.buildingStanding });
  /** The public scheduling pass (the tick calls this): reads the current assignments. */
  const schedule = () => {
    soldierIndex.rebuild();
    scheduleWith(soldierIndex.of);
  };
  const updateActor = createMilitaryActorUpdate(context, soldiers,
    { allocateGarrisonOrder: state.allocateGarrisonOrder, updateCombatActor: combat.updateActor });
  /** Resting recovery after combat and promotion: damage and death are already resolved this tick. */
  const recoverSoldiers = (seconds: number) => advanceMilitaryRecovery(soldiers.values(), context.actors,
    context.buildings, seconds, combat.buildingInCombat);
  const recover = (seconds: number) => {
    commander.rest(seconds);
    return recoverSoldiers(seconds);
  };
  /** Tutorial steps count the player's promotions; the map script hears every faction's (TRG3a). */
  const reportPromotion = (soldier: SettlementSoldier, rank: number) => {
    if ((soldier.combat?.faction ?? 0) === 0) countIslandAction(context, `promote:${rank}`);
    if (context.script) emitSoldierPromoted(context, soldier.actor, rank);
  };
  const update = (dt: number) => {
    if (!Number.isFinite(dt) || dt <= 0) return;
    markTickPhase(COMBAT_PHASE);
    combat.update(dt);
    markTickPhase("military.orders");
    orders.update();
    markTickPhase("military.queues");
    queues.update(dt);
    markTickPhase("military.commander");
    commander.update(dt);
    // Combat orders, the commander and the scheduler above may all rewrite assignments.
    soldierIndex.rebuild();
    markTickPhase("military.releaseSurplus");
    releaseSurplus(soldierIndex.of);
    markTickPhase("military.schedule");
    scheduleWith(soldierIndex.of);
    markTickPhase("military.training");
    advanceMilitaryTraining(militaryBuildings().filter(building => building.typeId !== 16), soldierIndex.of, dt,
      { drinkWare, onPromoted: reportPromotion, randomFrames, trainTimers, trainingFocus });
    markTickPhase("military.recovery");
    recoverSoldiers(dt);
  };
  /** The player's military buildings; of a computer economy only the Catapult's ground stone (EAI2b). */
  const suppliesBuilding = (site: SettlementBuilding) =>
    isMilitaryBuilding(site) || (site.typeId === 16 && isEconomyGarrison(site));
  const supplyDemand = (uid: number) => {
    // The logistics pass asks once per building: look the building up by uid and read the
    // soldier bucket instead of filtering every building and every soldier on each call.
    const site = getBuilding(context, uid);
    soldierIndex.rebuild();
    return militarySupplyDemand(site && suppliesBuilding(site) ? site : undefined, soldierIndex.of(uid),
      coinsAllowed.get(uid), drinkWare, combat.buildingStanding(uid));
  };
  const coinDemand = (uid: number) => supplyDemand(uid).coins;
  const drinkDemand = (uid: number) => supplyDemand(uid).drink;
  const removeBuilding = (uid: number) => {
    const removed = context.buildings.find((building) => building.uid === uid);
    if (!removed) return;
    // Detach a commander from its lodge before generic soldier release rewrites its home.
    commander.beforeBuildingRemoved(uid);
    combat.removeSiegeBuilding(uid);
    releaseRemovedSiteSoldiers(context, soldiers, removed, uid);
    targets.delete(uid); trainingFocus.delete(uid); compositions.delete(uid); coinsAllowed.delete(uid); recruitTimers.delete(uid);
    trainTimers.delete(uid);
  };
  /**
   * A Tavern recruit becomes a soldier: it leaves through the Tavern door and walks
   * to the nearest reachable storage as a reserve. Returns false while no storage is reachable.
   */
  const enlist = (actor: SettlementActor, tavern: SettlementBuilding, type: MilitaryTroopType) => {
    const storage = warehousesFor(context, tavern)[0]?.home;
    if (!storage || !isOrdinaryTroopType(type)) return false;
    // Recruits start at the lowest rank.
    const rank = 0;
    // A computer economy's recruit serves its faction and is no civilian of it any more (EAI4a).
    const faction = ownerOf(tavern);
    const combat: MilitaryCombatant = { type, faction, hp: militaryHealth(type, rank), cooldown: 0 };
    if (faction !== PLAYER_FACTION) delete actor.hostileCivilianFaction;
    // Leaving through the Tavern door; the arrival at the storage door makes it a reserve there.
    Object.assign(actor, { building: tavern.uid, home: storage.uid, job: "Soldier", tool: soldierTool(type) });
    soldiers.set(actor.uid, { actor: actor.uid, building: -2, combat, rank, stationed: false });
    setActorPath(actor, exitPath(tavern), "outbound");
    orders.welcome(actor.uid);
    return true;
  };
  return { buildingStanding: combat.buildingStanding, factionWalls: combat.factionWalls,
    garrisonFromReserve: scheduler.garrisonFromReserve,
    releaseReserve: reserveRelease.releaseReserve, repairWalls: combat.repairWalls, schedule,
    spareReserve: reserveRelease.spareReserve, update, updateActor, recover,
    coinDemand, drinkDemand, supplyDemand, removeBuilding, enlist, random,
    commander,
    /** Soldiers and running recruit/training timers (the counter checksum's military part). */
    counters: () => [soldiers.size, recruitTimers.size + trainTimers.size] as const,
    trainingStarted: state.trainingStarted,
    storedTroops: storage.storedTroops,
    orders,
    /** The player's Shift order queues (owner 2026-11-17). */
    queues,
    recruitStored: storage.recruit,
    startTrainingEncounter: () => {
      if (state.trainingStarted()) return { ok: false, reason: "Training encounter already started" };
      const points = trainingEncounterPoints(context);
      if (!points) return { ok: false, reason: "No reachable space for the opposing training troops" };
      grantTrainingReserves(context, soldiers);
      points.forEach((point, index) => combat.spawnOpponent(point,
        ORDINARY_TROOP_TYPES[index % ORDINARY_TROOP_TYPES.length]!));
      state.markTrainingStarted();
      return { ok: true };
    },
    trainOpponentGarrison: (uid: number, maximumRank = MAX_SOLDIER_RANK) => {
      const site = context.buildings.find(building => building.uid === uid && ownerOf(building) > 0);
      const guards = scanTroops(uid).filter(soldier => soldier.stationed && soldier.rank < maximumRank);
      if (!site || !guards.length || !payMilitaryCost(site.inventory, { coins: 1 })) return false;
      const ranks = promoteMilitaryRanks(guards.map(soldier => soldier.rank));
      guards.forEach((soldier, index) => {
        const previous = soldier.rank, rank = ranks[index]!;
        if (!promoteSettlementSoldier(soldier, rank)) return;
        if (rank > previous) reportPromotion(soldier, rank);
      });
      return true;
    },
    combat,
    /** Troop ships (MIL-SHIPS-SIM): gangway passage, and the order for soldiers a full ship leaves ashore. */
    commandSoldiers: orders.command, landFromShip: combat.landFromShip, leaveFieldForShip: combat.leaveFieldForShip,
    ...createMilitaryTransfers(context, { combat, commander, militaryBuildings, orders, scanTroops, soldiers,
      storage, target }),
    troopType: (uid: number) => soldiers.get(uid)?.combat?.type,
    soldierOf: (uid: number) => soldiers.get(uid),
    scriptUnits: combat.scriptUnits,
    soldierRecords: () => soldiers.values(),
    /** Read-only combat identity for diagnostics (orders, targets, destinations). */
    combatant: (uid: number) => soldiers.get(uid)?.combat,
    factionOf: (uid: number) => soldiers.get(uid)?.combat?.faction,
    movementSpeed: (actor: SettlementActor) => {
      const combat = soldiers.get(actor.uid)?.combat;
      if (!combat) return .9;
      const factor = combat.faction === 0 ? nationMilitarySpeedFactor(context.playerNation) : 1;
      return militaryPace(combat, actor, actor.phase === "militaryField", factor);
    },
    saveState: () => {
      const rally = orders.save();
      const commanderSave = commander.saveState();
      const orderQueues = queues.save();
      return { ...state.saveState(), combat: combat.save(), ...(commanderSave ? { commander: commanderSave } : {}),
        ...(rally ? { rally } : {}), ...(orderQueues ? { orderQueues } : {}) };
    }, quietSkip: () => soldiers.size === 0 && orders.save() === undefined && combat.quietSkip(), advanceQuiet: (dt: number) => combat.advanceQuiet(dt),
    restore: (saved?: import("./settlement-military-state").SettlementMilitarySave) => {
      state.restore(saved);
      commander.restore(saved?.commander);
      const savedCombat = saved?.combat;
      const combatState = savedCombat && saved.rankVersion === undefined
        ? { ...savedCombat, arrows: savedCombat.arrows.map(arrow => ({
          ...arrow, rank: migrateLegacyMilitaryRank(arrow.rank) })) } : savedCombat;
      combat.restore(combatState);
      orders.restore(saved?.rally);
      queues.restore(saved?.orderQueues);
    },
    isSoldier: (actor: SettlementActor) => soldiers.has(actor.uid),
    soldiers: () => [...soldiers.values()].map((soldier) => ({ ...soldier,
      combat: soldier.combat && { ...soldier.combat } })),
    ...createMilitaryControls(context, { coinsAllowed, compositions, drinkWare, militaryBuildings, soldierIndex,
      soldiers, target, targets, trainingFocus })
  };
};
