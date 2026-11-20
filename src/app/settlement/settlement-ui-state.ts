import type { I18n } from "@lingui/core";
import { levelProgress } from "@shared/catalog/balance";

import { availabilityTier } from
  "../../../../island-of-settlers-shared/src/game-settings/building-availability";
import { BUILDING_CATALOG } from "../../render-common/buildings/building-catalog";
import { getNationBuildingDefinition } from "../../render-common/buildings/nation-building-text";
import { GARRISON_ARCHER_POSTS } from "../../shared/balance/military";
import {
  displayBanditSiteName, displayJobName, DOMAIN_SHIP_TERMS, formatDomainWareCount,
  translateDomainMessage, translateDomainText
} from "../../shared/i18n/domain";
import { hasMonumentBonus } from "../../shared/progression/monument-bonus";
import {
  effectivePlayerLevel, type ProgressionRules, type ProgressionVisibility, progressionVisibility, talentsEnabled
} from "../../shared/progression/progression-rules";
import { isMaterialQuarry, materialBuildingGroup } from "../../shared/settlement/advanced-material-production";
import { FARM_TYPE_ID, FLAX_FARM_TYPE_ID, SAWMILL_TYPE_ID } from "../../shared/settlement/building-type-ids";
import { isIdleExpeditionShip } from "../../shared/settlement/expedition-launch-rules";
import { featureStates } from "../../shared/settlement/feature-rules";
import type { MilitaryTroopType } from "../../shared/settlement/military-combat-rules";
import { retainedGarrisonIds } from "../../shared/settlement/military-garrison-preservation";
import { emptyComposition, isGarrisonTroop } from "../../shared/settlement/military-garrison-rules";
import { getBuildingProductionRule, STORAGE_IDS } from "../../shared/settlement/production-rules";
import { isDemolitionProtected, isOwnBuilding } from "../../shared/settlement/settlement-home";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { Goods, SettlementBuilding } from "../../shared/settlement/settlement-types";
import { islandStorageCapacity } from "../../shared/settlement/storage-capacity";
import type { SettlementNotification, SettlementUiSnapshot } from "../settlement-ui";
import { getBridgeSummaries } from "./bridge-summaries";
import { buildingSoldierDetails } from "./building-soldier-details";
import type { IslandTravel } from "./island-settlement";
import type { PlayerSession } from "./player-session";
import { productionBlockageHint, productionWaitStatus } from "./production-wait-status";
import { productionWorkProgress } from "./production-work-progress";
import { residenceSummary } from "./residence-summary";
import { troopRecallStatus } from "./troop-recall-status";

const workerLabel = (building: SettlementBuilding, nation: string, i18n?: I18n) => {
  if (building.worker === undefined) return undefined;
  if (building.construction < 1) return displayJobName("Builder", i18n);
  return displayJobName(getNationBuildingDefinition(building.typeId, nation).worker, i18n);
};

/** Military panel data; only where storages hold soldiers to send (never on an adventure). */
const garrisonSummaries = (simulation: SettlementSimulation, buildings: readonly SettlementBuilding[],
  homeStored?: { archer: number; heavy: number; shield: number }) => {
  if (!buildings.some(building => STORAGE_IDS.has(building.typeId) && building.construction === 1)) return new Map();
  const stored = emptyComposition();
  for (const entry of simulation.militaryStoredTroops()) if (isGarrisonTroop(entry.type)) stored[entry.type] = entry.count;
  return new Map(simulation.militaryBuildings().map(entry => [entry.uid, {
    assigned: entry.assignedTroops, capacity: entry.capacity,
    catapultStatus: entry.catapultStatus, stoneStock: entry.stoneStock, stoneGround: entry.stoneGround, stoneCarried: entry.stoneCarried, stoneIncoming: entry.stoneIncoming,
    coinCapacity: entry.coinCapacity, coinIncoming: entry.coinIncoming, coinStock: entry.coinStock,
    coinsAllowed: entry.coinsAllowed,
    drinkCapacity: entry.drinkCapacity, drinkIncoming: entry.drinkIncoming, drinkStock: entry.drinkStock,
    drinkWare: entry.drinkWare,
    manual: entry.manual,
    minimum: buildings.find(building => building.uid === entry.uid)?.territoryClaimed ? 1 : 0,
    posts: GARRISON_ARCHER_POSTS[buildings.find(building => building.uid === entry.uid)!.typeId] ?? 0,
    stationed: entry.stationedTroops, stationedByRank: entry.stationedByRank,
    trainingFocus: entry.trainingFocus, homeStored, stored: { ...stored }
  }]));
};

/** Tavern panel data: each completed Tavern's orders. */
const tavernSummaries = (simulation: SettlementSimulation) => {
  const freeSettlers = simulation.availableSettlers();
  return new Map(simulation.tavernOrders().map(entry => [entry.uid, { current: entry.current, freeSettlers,
    queue: entry.queue }]));
};

const upgradeSummary = (
  simulation: SettlementSimulation, building: SettlementBuilding, resources: Goods, i18n?: I18n
) => {
  if (!building.selected) return { upgradeSupply: resources };
  const availability = simulation.workshopUpgradeAvailability(building.uid);
  // A finished harbour's berths (a second one from level 3 where the shore allows).
  const berths = building.typeId === 39 && building.construction === 1
    ? { berths: simulation.harbourBerths(building.uid).length } : {};
  return { upgradeSupply: availability?.supply, upgradeAvailable: availability?.available,
    upgradeBlockedReason: availability?.reason && translateDomainText(availability.reason, i18n), ...berths };
};

/** "type:level" of each offered building the player's level still locks; a string compares by value. */
const getLockedBuildings = (simulation: SettlementSimulation) => BUILDING_CATALOG.flatMap(entry => {
  const level = simulation.buildingLockLevel(entry.id);
  return level === null ? [] : [`${entry.id}:${level}`];
}).join(",");

/** "type:tier" of each offered building the map's tier cap blocks (the menu greys it with the reason). */
const getTierBlockedBuildings = (simulation: SettlementSimulation) => BUILDING_CATALOG.flatMap(entry => {
  const tier = simulation.buildingTierBlock(entry.id);
  return tier === null ? [] : [`${entry.id}:${tier}`];
}).join(",");

/** The home sandbox switch exists only on the home island. */
const homeSandboxState = (simulation: SettlementSimulation) =>
  simulation.islandRole() === "home" ? { homeSandbox: !!simulation.homeBuildingRules()?.unlockAll } : {};

export const getSettlementUiSnapshot = (
  simulation: SettlementSimulation,
  notifications: readonly SettlementNotification[],
  homeStored?: { archer: number; heavy: number; shield: number },
  i18n?: I18n
): SettlementUiSnapshot => {
  const resources: Goods = {};
  const buildings = simulation.buildings();
  const storageCapacity = islandStorageCapacity(buildings, simulation.talentModifiers().storageCapacity);
  const islandTheme=simulation.colony()?.island.theme??"forest";
  const campTheme=islandTheme==="tropical"?"pirate":islandTheme;
  const availableSettlers = simulation.availableSettlers();
  const { limit: populationLimit, people: population } = simulation.population();
  const populationFull = populationLimit !== undefined && population >= populationLimit;
  const workforce = new Map<number, Goods>(), workforceTotals: Goods = {};
  const militaryUnits: Record<MilitaryTroopType, number> = { archer: 0, cavalry: 0, heavy: 0, shield: 0 };
  const actors = simulation.frames();
  const actorsById = new Map(actors.map(actor => [actor.uid, actor]));
  const garrisons = garrisonSummaries(simulation, buildings, homeStored);
  const taverns = tavernSummaries(simulation);
  for (const actor of actors) {
    if (actor.phase === "retired") continue;
    const jobs = workforce.get(actor.home) ?? {};
    jobs[actor.job] = (jobs[actor.job] ?? 0) + 1;
    workforce.set(actor.home, jobs);
    if (actor.job !== "Mount" && actor.job !== "Soldier")
      workforceTotals[actor.job] = (workforceTotals[actor.job] ?? 0) + 1;
  }
  for (const soldier of simulation.militarySoldiers()) {
    if ((soldier.combat?.faction ?? 0) !== 0 || soldier.commanderId) continue;
    militaryUnits[soldier.combat?.type ?? "shield"]++;
  }
  Object.assign(resources, storageCapacity.stored);
  const commanderSnapshot = simulation.commanderSnapshot?.();
  return {
    resources,
    population,
    populationLimit,
    availableSettlers,
    workforce: workforceTotals,
    militaryUnits,
    ...(commanderSnapshot ? { commanders: [commanderSnapshot] } : {}),
    expeditionPreparations: simulation.seaExpeditionPreparations(),
    shippingDemands: simulation.seaShippingDemands(),
    colonyExpeditions: simulation.colonyExpeditions(),
    colonyTroops: simulation.colonyTroops(),
    colonyTroopsByHarbour: Object.fromEntries(buildings.filter(building =>
      building.typeId === 39 && building.construction === 1).map(building =>
      [building.uid, simulation.colonyTroops(building.uid)])),
    idleExpeditionShips: simulation.ships().filter(isIdleExpeditionShip).length,
    colonyIslands: simulation.colonyIslands(),
    adventureIslands: simulation.adventureIslands(),
    expeditionOngoing: simulation.expeditionOngoing(),
    features: featureStates(simulation.featureState),
    buildingMenuBlocked: Boolean(simulation.colony() && simulation.colony()!.status !== "conquered"),
    homeIsland: simulation.islandRole() === "home",
    islandRole: simulation.islandRole(),
    buildableTypes: BUILDING_CATALOG.filter(entry => simulation.offersBuilding(entry.id)).map(entry => entry.id),
    lockedBuildings: getLockedBuildings(simulation),
    tierBlockedBuildings: getTierBlockedBuildings(simulation),
    buildingTierCap: availabilityTier(simulation.buildingAvailability()),
    ...homeSandboxState(simulation),
    builtBuildings: BUILDING_CATALOG.filter(entry => entry.buildLimit?.max === 1 &&
      simulation.singleBuildingBuilt(entry.id)).map(entry => entry.id).join(","),
    playerNation: simulation.playerNation(),
    buildings: buildings.map((building) => ({
      bandit: building.bandit,
      enemyCampEnclosure:building.enemyCampEnclosure,
      enemyCampTheme:campTheme,
      displayName: building.bandit === undefined ? undefined
        : displayBanditSiteName(building.bandit, building.enemyCampEnclosure, i18n),
      id: String(building.uid),
      type: building.typeId,
      hostile: !isOwnBuilding(building) || undefined,
      inventory: { ...building.inventory },
      storage: simulation.storageSnapshot(building.uid),
      storageCollect: simulation.storageCollect(building.uid),
      storageCapacity: STORAGE_IDS.has(building.typeId) ? storageCapacity : undefined,
      storedHandcarts: STORAGE_IDS.has(building.typeId) ? building.handcarts ?? 0 : undefined,
      totalHandcarts: STORAGE_IDS.has(building.typeId) ? simulation.handcarts(building.uid) : undefined,
      workforce: STORAGE_IDS.has(building.typeId) ? workforce.get(building.uid) ?? {} : undefined,
      availableSettlers: STORAGE_IDS.has(building.typeId)
        ? simulation.availableSettlers(building.uid)
        : undefined,
      input: {
        ...(building.construction < 1
          ? Object.fromEntries(Object.keys(building.required ?? {}).map(ware => [ware, 0]))
          : {}),
        ...building.input
      },
      output: { ...building.output },
      incoming: { ...building.incoming },
      productionOrders: building.productionOrders && { ...building.productionOrders },
      selectedOutput: building.selectedOutput,
      workshopUpgrade: building.workshopUpgrade && { ...building.workshopUpgrade },
      ...upgradeSummary(simulation, building, resources, i18n),
      upgradeDelivered: { ...(building.workshopUpgrade?.reserved ?? building.input) },
      upgradeIncoming: { ...(building.workshopUpgrade?.incoming ?? building.incoming) },
      productionPaused: building.productionPaused ?? false,
      ...productionWorkProgress(building, actorsById.get(building.worker!),
        getBuildingProductionRule(building, simulation.playerNation()), simulation.felledTreeProgress),
      workerPhase: !building.selected || building.worker === undefined
        ? undefined : simulation.workerPhase?.(building.worker),
      accepts: { ...building.accepts },
      exports: { ...building.exports },
      completed: building.construction === 1,
      catapultAmmo: building.typeId === 16 ? simulation.catapultAmmo(building.uid) : undefined,
      construction: building.construction < 1 ? {
        progress: building.construction, foundationProgress: building.foundationProgress ?? 1,
        required: { ...building.required }, consumed: { ...building.constructionConsumed },
        incoming: { ...building.incoming }
      } : undefined,
      garrison: garrisons.get(building.uid),
      soldiers: building.selected ? buildingSoldierDetails(simulation, building, actorsById) : undefined,
      commander: building.typeId === 62 && building.selected ? simulation.commanderStatus(building.uid) : undefined,
      commanderRecruit: building.typeId === 62 && building.selected
        ? simulation.commanderRecruitStatus(building.uid) : undefined,
      tavern: taverns.get(building.uid),
      residence: residenceSummary(simulation, building),
      canDemolish: building.typeId !== 0 && !isDemolitionProtected(building),
      stoneArea: building.typeId === 19 ? simulation.stoneArea(building.uid) : undefined,
      stoneOutput: building.typeId === 19 ? (building.output.stone ?? 0) : undefined,
      marbleRemaining: isMaterialQuarry(building.typeId)
        ? simulation.marbleDeposits().filter(deposit => (deposit.material ?? "marble") ===
          materialBuildingGroup(building.typeId)?.stone).reduce((sum, deposit) => sum + deposit.remaining, 0)
        : undefined,
      farmArea: building.typeId === FARM_TYPE_ID || building.typeId === FLAX_FARM_TYPE_ID
        ? simulation.farmArea(building.uid) : undefined,
      farmGrowing: building.typeId === FARM_TYPE_ID || building.typeId === FLAX_FARM_TYPE_ID
        ? simulation.fieldFrames().filter((site) => site.owner === building.uid && site.state === "growing").length
        : undefined,
      farmRipe: building.typeId === FARM_TYPE_ID || building.typeId === FLAX_FARM_TYPE_ID
        ? simulation.fieldFrames().filter((site) => site.owner === building.uid &&
          (site.state === "ripe" || site.state === "drying")).length
        : undefined,
      farmWheat: building.typeId === FARM_TYPE_ID ? (building.output.grain ?? 0) : undefined,
      farmFlax: building.typeId === FLAX_FARM_TYPE_ID ? (building.output.flax ?? 0) : undefined,
      farmWare: ({ [FARM_TYPE_ID]: "grain", [FLAX_FARM_TYPE_ID]: "flax" } as Record<number, string>)[building.typeId],
      shipyardMode: building.typeId === 36 ? simulation.shipyardMode(building.uid) : undefined,
      shipyardSite: building.typeId === 36 ? simulation.shipyardSite(building.uid) ?? undefined : undefined,
      sawmillMode: building.typeId === SAWMILL_TYPE_ID ? simulation.sawmillMode(building.uid) : undefined,
      fisherBoat: building.selected ? simulation.fisherBoatStatus(building.uid) : undefined,
      status: translateDomainText(
        building.construction < 1
          ? `${building.status} (${Math.round(building.construction * 100)}%)`
          : productionWaitStatus(building, simulation.playerNation(), i18n),
        i18n
      ),
      blockageHint: productionBlockageHint(building, simulation.playerNation(), availableSettlers, populationFull,
        simulation.talentModifiers().settlerGrowthSpeed, i18n),
      worker: workerLabel(building, simulation.playerNation(), i18n)
    })),
    bridges: getBridgeSummaries(simulation),
    harbourShuttles: simulation.harbourShuttles?.() ?? [],
    seaOrders: [
      ...simulation.seaOrders().map(order => ({ id: order.id, sourceUid: order.sourceUid,
        destinationUid: order.destinationUid, passengers: order.passengers?.length ?? 0, expedition: Boolean(order.expedition), exploration: Boolean(order.exploration) })),
      ...simulation.ships().filter(ship => ship.orderId !== undefined && !ship.cancelled).map(ship => ({
        id: ship.orderId!, sourceUid: ship.sourceUid!, destinationUid: ship.destinationUid!,
        passengers: ship.passengers, expedition: ship.expedition, exploration: ship.exploration }))
    ],
    ships: simulation.ships().map((ship) => ({
      canSink: ship.canSink,
      owned: !ship.visitor,
      reliefQuestId: ship.reliefQuestId,
      nation: ship.nation,
      livery: ship.livery,
      id: String(ship.id),
      name: translateDomainText(ship.name, i18n),
      origin: ship.origin && translateDomainText(ship.origin, i18n),
      destination: ship.destination && translateDomainText(ship.destination, i18n),
      leg: ship.leg && translateDomainText(ship.leg, i18n), legSeconds: ship.legSeconds,
      status: translateDomainText(ship.phase === "loading" && ship.passengers
        ? `Boarding ${ship.aboardPassengers}/${ship.passengers}` : ship.phase, i18n),
      wares: ship.cargo,
      passengers: ship.passengerJobs,
      troops: ship.passengerTroops,
      cargo: [...Object.entries(ship.cargo).map(([ware, count]) => formatDomainWareCount(ware, count, i18n)),
        ...(ship.passengers ? [translateDomainMessage(i18n, DOMAIN_SHIP_TERMS.passengers,
          { count: ship.passengers })] : []),
        ...(ship.expedition ? [translateDomainMessage(i18n, DOMAIN_SHIP_TERMS.settlementExpedition)] : []),
        ...(ship.exploration ? [translateDomainMessage(i18n, DOMAIN_SHIP_TERMS.explorationExpedition)] : [])]
        .join(", ")
    })),
    notifications
  };
};

/** Colony panel rows: the colony on screen also reports its soldiers, recall and ore ship. */
export const getColonySummaries = (simulation: SettlementSimulation, travel: IslandTravel, i18n?: I18n) =>
  travel.colonies().map(colony => ({ conqueredAt: colony.conqueredAt, id: colony.expeditionId,
    island: colony.island, status: colony.status,
    soldiers: colony.expeditionId === travel.active() ? simulation.militarySoldiers()
      .filter(soldier => (soldier.combat?.faction ?? 0) === 0).length : undefined,
    recallableSoldiers: colony.expeditionId === travel.active() ? recallableSoldierCount(simulation) : undefined,
    troopRecallPending: colony.expeditionId === travel.active() && simulation.ships().some(ship => ship.troopRecall),
    troopRecallStatus: colony.expeditionId === travel.active()
      ? translateDomainText(troopRecallStatus(simulation.ships()) ?? "", i18n) || undefined : undefined,
    nextResourceShipAt: colony.nextOreShipAt,
    resourceShipArrivalSeconds: colony.expeditionId === travel.active()
      ? simulation.ships().find(ship => ship.visitorRole === "ore")?.arrivalSeconds : undefined,
    incomingShips: simulation.ships().filter(ship => ship.incoming &&
      (colony.expeditionId === travel.active() || ship.sourceColony === colony.expeditionId))
      .map(ship => ({ id: String(ship.id), name: translateDomainText(ship.name, i18n),
        status: translateDomainText(ship.phase, i18n),
        wares: ship.cargo, troops: ship.passengerTroops, passengers: ship.passengerJobs,
        arrivalSeconds: ship.arrivalSeconds }))
  }));

/** Player soldiers on the island that are not kept back as a building's garrison. */
const recallableSoldierCount = (simulation: SettlementSimulation) => {
  const retained = retainedGarrisonIds(simulation.buildings(), simulation.frames());
  return simulation.militarySoldiers().filter(soldier =>
    (soldier.combat?.faction ?? 0) === 0 && !retained.has(soldier.actor)).length;
};

const visibilityByRules = new WeakMap<ProgressionRules, ProgressionVisibility>();

/**
 * The §9.4 visibility of the island's rules. The effective rules object lives until the island adopts other rules,
 * so the pinned settings (a copy per read) are looked at once per rules, not per snapshot.
 */
const progressionOf = (simulation: SettlementSimulation, rules: ProgressionRules) => {
  const known = visibilityByRules.get(rules);
  if (known) return known;
  const visibility = progressionVisibility(rules, simulation.gameRules()?.level.kind);
  visibilityByRules.set(rules, visibility);
  return visibility;
};

const NO_TALENTS = Object.freeze({});

/**
 * HUD numbers for the player corner and quest window, with this island's quest stock. The level and talents are
 * the ones the island plays with under its rules (plan §9): a fixed or capped level, no ranks with talents off.
 */
export const getPlayerSummary = (player: PlayerSession, simulation: SettlementSimulation) => {
  const progress = player.progress(), level = levelProgress(progress.experience);
  const rules = simulation.effectiveGameRules();
  const stock = Object.fromEntries(progress.quests.map(quest => [quest.ware, simulation.resourceTotal(quest.ware)]));
  return { current: level.current, experience: progress.experience, gameTime: simulation.gameNow(),
    fraction: level.fraction, gems: progress.gems, monumentBonus: hasMonumentBonus(progress),
    inventory: progress.inventory, level: effectivePlayerLevel(rules, level.level),
    nation: simulation.playerNation(), needed: level.needed, messages: progress.messages,
    progression: progressionOf(simulation, rules), quests: progress.quests, reliefQuests: player.reliefQuests(),
    questNew: progress.questSeenDay !== progress.questDay, stock,
    talents: talentsEnabled(rules) ? progress.talents : NO_TALENTS, tutorial: player.tutorialSummary() };
};
