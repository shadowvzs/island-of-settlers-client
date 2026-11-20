import { PRODUCTION_OUTPUT_CAPACITY, WORKER_REST_SECONDS } from "../balance/economy";
import { DMath } from "../math/deterministic-math";
import { emitDepositMined } from "../script-world/nature/nature-events";
import { countIslandAction, countProducedWare } from "../script-world/script-action-counters";
import {
  emitBuildingOccupied, emitConstructionCompleted, emitWareProduced
} from "../script-world/script-building-events";
import { emitJobAssigned, emitToolReceived } from "../script-world/script-unit-events";
import { isMaterialForester, isMaterialQuarry, isMaterialWoodcutter, materialBuildingGroup, materialMineOutput,
  materialPlantingSpecies } from "./advanced-material-production";
import { completeArmoryOrder, nextArmoryOutput } from "./armory-orders";
import { bridgeSiteBuilderLimit, bridgeStageStatus } from "./bridge-construction";
import { COMMANDER_LODGE_TYPE_ID } from "./building-type-ids";
import { hasMarbleTarget } from "./colony-marble-deposits";
import { startFisherBoatTrip, updateFisherBoatTrip } from "./fisher-boat-trip";
import { mixedCycleOutput } from "./mixed-output";
import { advanceFishingPhase, FISHING_WORK_TIMING, type FishingPhase } from "./outdoor-work-timing";
import { reservedInputReturns } from "./sawmill-input-returns";
import { validateBuilderAssignment } from "./settlement-builder-validation";
import {
  applyConstructionContact, builderHammerContacts, constructionFacing, constructionSupplied,
  constructionWorkPositions
} from "./settlement-construction";
import { updateDemolitionReturn } from "./settlement-demolition";
import { continueFarmerSowing } from "./settlement-farmer-work";
import { startForesterPickup, updateForester } from "./settlement-forester-work";
import { updateFoundationWorker } from "./settlement-foundation-worker";
import { isHomeBuilding } from "./settlement-home";
import { updateHunter } from "./settlement-hunting";
import { reclaimIdleCarriers } from "./settlement-idle-carriers";
import { isFirstSettlementOnLandmass } from "./settlement-landmass";
import { mineOreCell } from "./settlement-mine-ore";
import { buildingNation } from "./settlement-nation";
import { actorEconomyOwnerOf, economyOwnerOf, ownerOf, servesEconomyOf } from "./settlement-ownership";
import {routePigInputToPen,startPigProduction,updatePigBreeder} from "./settlement-pig-work";
import { addIdleSettlers, ownerSpareSettlers, retirePerson } from "./settlement-population";
import { advanceWareTransfer, clearWareTransfer,startWareTransfer, stockContact } from "./settlement-stock-transfers";
import { isPublicTerrainSingleLeg, publicTerrainPath } from "./settlement-terrain-routing";
import { WHEAT_SOW_SECONDS } from "./settlement-wheat-planning";
import { recoverResourceApproach } from "./settlement-worker-resource-recovery";
import {
  farStockReturnPath, outputStockPath, stockErrandPath, stockToDoorPath
} from "./settlement-worker-stock-paths";
const builderSides = new WeakMap<SettlementActor, { edge: number; side: number }>();
import { HANDCART_OUTPUT } from "../../render-common/logistics/handcart-rules";
import { addGood, countGoods, getBuildingProductionRule, STORAGE_IDS } from "./production-rules";
import { RESIDENCE_IDS } from "./residences";
import { hasRoadRoute } from "./road-route-helpers";
import { roadVergeStatus } from "./road-verge-planting";
import { approachDrinkWorkstation, drinkWorkstation, isExpansionDrinkMaker } from "./settlement-drink-work";
import { canEnterDoor, entrancePath, exitPath } from "./settlement-entrance";
import { nearestStorage } from "./settlement-logistics";
import { createActor, groundPath, moveActor, setActorPath } from "./settlement-paths";
import { consumeWorkTarget, findWorkTarget, targetKey } from "./settlement-resources";
import {
  canCraftHandcart,
  finishHandcart,
  handcartCycleRule,
  isCraftingHandcarts
} from "./settlement-sawmill-handcarts";
import { chooseYieldTarget } from "./settlement-traffic";
import {
  isRoadWorkShell, type ProductionRule, type SettlementActor, type SettlementBuilding, type SettlementContext
} from "./settlement-types";
import { tickSystemMasked } from "./settlement-types";
import { approachWeaverWorkstation, weaverWorkstation } from "./settlement-weaver-work";
import { approachWellWorkstation, updateWellWorker } from "./settlement-well-work";
import { beginWorkerHandling, releaseWorkerHandling } from "./settlement-worker-movement-plan";

export const recruitWorkers = (context: SettlementContext) => {
  reclaimIdleCarriers(context);
  for (const building of context.buildings) {
    if (building.construction === 1 && STORAGE_IDS.has(building.typeId)) continue;
    let bridgeCrew = building.worker === undefined ? 0 : 1;
    if (building.bridgeSite) bridgeCrew = context.actors.filter(actor =>
      actor.job === "Builder" && actor.building === building.uid &&
      !actor.demolitionReturning && actor.phase !== "retired").length;
    const crewLimit = building.bridgeSite ? bridgeSiteBuilderLimit(building.bridgeSite) : 1;
    if (bridgeCrew >= crewLimit) continue;
    // A founding site's crew is already ashore; ordinary village recruitment must not steal its slot.
    if (building.construction < 1 && building.foundedByExpedition) continue;
    // Hostile forts of a faction without an economy keep the status their island (colony) gives them.
    const owner = economyOwnerOf(context, building);
    if (owner !== ownerOf(building)) continue;
    if (building.typeId === 16 && building.construction === 1 &&
      context.military?.buildingStanding?.(building.uid) === false) continue;
    if (building.construction === 1 && [1, 2, 4, 9].includes(building.typeId)) {
      building.status = "Military units pending"; continue;
    }
    const constructionWorker = (building.foundationProgress ?? 1) < 1
      ? { job: "Leveler", tool: "shovel" } : { job: "Builder", tool: "hammer" };
    const constructing = building.construction < 1;
    const rule = constructing ? constructionWorker
      : getBuildingProductionRule(building, buildingNation(context, building));
    const idle = ownerSpareSettlers(context, owner, constructing ? "builder" : "worker");
    if (!rule || idle <= 0) continue;
    const home = nearestStorage(context, building, rule.tool, undefined, true)?.building;
    if (!home) {
      building.status = "Road not connected to storage";
      // Status only: any road-connected storage proves the missing piece is the tool.
      if (rule.tool && context.buildings.some(storage => storage.construction === 1 &&
        STORAGE_IDS.has(storage.typeId) && servesEconomyOf(context, storage, owner) &&
        hasRoadRoute(context.options.roads, storage.access, building.access)))
        building.status = `Waiting for ${rule.tool}`;
      continue;
    }
    const route = context.options.roads.route(home.access, building.access);
    if (!route) continue;
    if (rule.tool) addGood(home.inventory, rule.tool, -1);
    const actor = createActor(context, rule.job, home.uid, building.uid);
    actor.tool = rule.tool;
    if (context.script) emitJobAssigned(context, actor, building, rule.tool);
    building.worker = actor.uid; setActorPath(actor, [...exitPath(home), ...route.points], "assigned");
    building.status = `${rule.job} travelling`;
  }
};
const availableInputs = (building: SettlementBuilding, rule: ProductionRule) =>
  rule.alternativeFood ? rule.inputs.filter((ware) => (building.input[ware] ?? 0) > 0).slice(0, 1) : rule.inputs;
const consumeInputs = (context: SettlementContext, building: SettlementBuilding, rule: ProductionRule,
  actor: SettlementActor) => {
  const inputs = availableInputs(building, rule);
  // A recipe may list one ware several times (a hand cart takes four logs).
  const missing = (ware: string) => (building.input[ware] ?? 0) - reservedInputReturns(context, building, ware) < inputs.filter(entry => entry === ware).length;
  if ((rule.inputs.length && !inputs.length) || inputs.some(missing)) return false;
  actor.consumed = {};
  actor.productionInputs = inputs.slice();
  return true;
};
export const returnBuilder = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  actor.stockBuilding = building.uid;
  const owner = actorEconomyOwnerOf(context, actor);
  const storages = context.buildings.filter(entry => entry.construction === 1 && STORAGE_IDS.has(entry.typeId) &&
    servesEconomyOf(context, entry, owner));
  storages.sort((a, b) => Number(isHomeBuilding(b)) - Number(isHomeBuilding(a)) ||
    DMath.hypot(a.x - actor.x, a.z - actor.z) - DMath.hypot(b.x - actor.x, b.z - actor.z));
  const reachable = storages.map(home => {
    const road = context.options.roads.route(building.access, home.access);
    const approach = road && groundPath(context, actor, building.access, building.uid);
    const path = road && approach ? [...approach, ...road.points]
      : groundPath(context, actor, home.access, building.uid);
    return { home, path };
  }).find(entry => entry.path);
  const home = reachable?.home, path = reachable?.path;
  if (home && path) {
    actor.home = home.uid;
    setActorPath(actor, path, "retire");
  } else {
    actor.phase = "builderReturnBlocked"; actor.action = "idle"; actor.timer = 1;
  }
};
const finishConstruction = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  // A road work shell waits for the tick's bridge/verge pass to commit its road work, then is
  // removed without reporting an ordinary building completion (never XP, never a finished Well).
  if (isRoadWorkShell(building)) {
    building.construction = 1; building.working = false;
    building.status = building.bridgeSite ? bridgeStageStatus(1, 100)
      : roadVergeStatus(building.vergeSite!.kind, 1);
    return;
  }
  building.construction = 1; building.working = false; building.input = {}; building.required = {}; building.worker = undefined;
  // Completing the first harbour on a player-empty landmass is the permanent protection commitment.
  if (building.typeId === 39 && !building.foundingAnchor && isFirstSettlementOnLandmass(context, building))
    building.foundingAnchor = true;
  if (RESIDENCE_IDS.has(building.typeId)) building.status = "Residence";
  context.options.onBuildingCompleted?.(building);
  if (context.script) emitConstructionCompleted(context, building);
  context.naval?.shippingDemandChanged?.(building.uid);
  actor.job = "Settler";
  // A founded outpost keeps its landing crew: the founding operation walks and settles them into
  // this harbour. A generic return-to-storage search would send them across the island (or sea).
  if (building.foundedByExpedition) {
    actor.phase = "foundingWait"; actor.action = "idle"; actor.path = []; actor.pathIndex = 0;
    return;
  }
  returnBuilder(context, actor, building);
};
const beginWorkerRest = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  actor.ware = null; actor.wareScale=undefined; actor.target = undefined; actor.consumed = undefined;
  actor.wareUnits = undefined;
  clearWareTransfer(actor);
  if (building.typeId === 35) {
    approachWellWorkstation(context, actor, building, true);
    building.status = "Returning to windlass";
    return;
  }
  const path = actor.visible && stockToDoorPath(context, actor, building);
  if (actor.visible && path && canEnterDoor(context, actor, building)) setActorPath(actor, path, "enterRest");
  else if (actor.visible) { actor.phase = "workerRestWait"; actor.action = "idle"; actor.timer = 1; }
  else { actor.phase = "rest"; actor.timer = WORKER_REST_SECONDS; actor.action = "idle"; }
  if(building.typeId===28) building.pigFeedPhase="idle";
  building.door = 1; building.working = false; building.status = "Resting";
};
// Capacity gates new cycles. A paid, completed cycle always deposits its whole harvest.
const deposit = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  if (actor.ware) {
    actor.stockBuilding = building.uid; actor.stockContact = stockContact(context, building, "output", actor.ware, countGoods(building.output));
    if(DMath.hypot(actor.x-actor.stockContact.approach.x,actor.z-actor.stockContact.approach.z)>.15){
      const path=outputStockPath(context,actor,building,actor.stockContact.approach,false);
      if(path)setActorPath(actor,path,"outputWalk");else {actor.phase="returnBlocked";actor.action="idle";actor.timer=1;}
      return;
    }
    startWareTransfer(actor, "putdown", actor.ware, actor.stockContact);
    beginWorkerHandling(context, actor, "putdown", actor.ware);
    actor.phase = "outputPutdown"; building.status = "Stacking output";
    context.options.onWorkerPhase?.(actor);
  } else beginWorkerRest(context,actor,building);
};
const startPreparedProduction = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  if (startPigProduction(actor,building)) {
    context.options.onWorkerPhase?.(actor); return;
  }
  const nation = buildingNation(context, building);
  const rule = getBuildingProductionRule(building, nation);
  if (!rule) {
    // A building whose production was retired (for example a legacy Stable) must not crash an
    // already-assigned worker or fall through to a stale default recipe.
    actor.phase = "retired";
    actor.action = "idle";
    building.working = false;
    return;
  }
  if (building.typeId === 35) { approachWellWorkstation(context, actor, building); return; }
  if ((building.typeId === 20 || isMaterialForester(building.typeId)) && actor.preparedTarget) {
    startForesterPickup(context, actor, building); return;
  }
  if (isExpansionDrinkMaker(building, nation)) approachDrinkWorkstation(context, actor, building);
  else if (building.typeId === 61) approachWeaverWorkstation(context, actor, building);
  else if (actor.preparedTarget) {
    actor.target = actor.preparedTarget;
    setActorPath(actor, [building.workerApproach, ...(actor.productionPath ?? [])], "outbound");building.door=1;
  } else {
    actor.phase="work";actor.timer=actor.productionSeconds ?? rule.seconds;actor.action="work";building.working=true;
    context.options.onWorkerPhase?.(actor);
  }
  actor.preparedTarget=undefined;actor.productionPath=undefined;actor.productionInputs=undefined;
  building.status="Working";
};
const beginInputFetch = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const ware=actor.productionInputs?.[0];
  if (!ware) {startPreparedProduction(context,actor,building);return;}
  if (building.typeId >= 10 && building.typeId <= 13) {
    // Mine provisions are stored and consumed indoors, away from the ore piles.
    for (const input of actor.productionInputs ?? []) {
      addGood(building.input, input, -1);
      addGood(actor.consumed!, input);
    }
    actor.productionInputs = [];
    startPreparedProduction(context, actor, building);
    return;
  }
  actor.stockBuilding=building.uid;actor.stockContact=stockContact(context,building,"input",ware,Math.max(0,(building.input[ware] ?? 0)-1));
  const path=stockErrandPath(context,actor,building,actor.stockContact.approach);
  if (path) {setActorPath(actor,path,"inputApproach");building.door=1;}
  else {actor.phase="inputFetchBlocked";actor.action="idle";actor.timer=1;building.status="Waiting for input access";}
};
/** Output a production order dictates: a hand cart, the armory's next order, or none (free rule). */
const getOrderedOutput = (building: SettlementBuilding, craftingCart: boolean) => {
  if (craftingCart) return HANDCART_OUTPUT;
  return building.typeId === 24 ? nextArmoryOutput(building) : undefined;
};

const getProductionAction = (typeId: number) => {
  if (typeId === 17 || isMaterialWoodcutter(typeId)) return "chop";
  return typeId === 20 || isMaterialForester(typeId) ? "plant" : "work";
};

const beginProduction = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const rule = getBuildingProductionRule(building, buildingNation(context, building))!;
  if (rule.service) {
    // The commander system owns the lodge's status line (resting/recovering/awaiting home).
    if (building.typeId !== COMMANDER_LODGE_TYPE_ID) building.status = "Staffed";
    return;
  }
  if ([5, 6].includes(building.typeId) && rule.tool && actor.tool !== rule.tool) {
    const home = context.buildings.find(site => site.uid === actor.home);
    if (!home || !(home.inventory[rule.tool] ?? 0)) {
      building.status = `Waiting for ${rule.tool}`;
      return;
    }
    addGood(home.inventory, rule.tool, -1);
    actor.tool = rule.tool;
    if (context.script) emitToolReceived(context, actor, rule.tool);
  }
  if (building.productionPaused) {
    building.working = false; building.status = "Production stopped"; actor.action = "idle"; return;
  }
  if (rule.outputs.length && countGoods(building.output) >= PRODUCTION_OUTPUT_CAPACITY) { building.status = "Output stock full"; return; }
  if (building.typeId >= 10 && building.typeId <= 13 && mineOreCell(context.options.world, building) < 0) {
    building.status = "Deposit exhausted"; return;
  }
  const fieldCycle = [5, 27, 37, 60].includes(building.typeId) && context.fieldCycles;
  const carcass = building.typeId === 3 && findWorkTarget(context, building, "carcass");
  const fieldWork = fieldCycle ? fieldCycle.findWork(building) : null;
  const work = carcass || (fieldCycle ? fieldWork :
    rule.outdoor && findWorkTarget(context, building, rule.outdoor));
  if (rule.outdoor && !work) {
    const fieldWaiting: Readonly<Record<number, string>> = {
      37: "Waiting for a clear sowing plot", 60: "Waiting for a clear flax plot"
    };
    building.status = fieldWaiting[building.typeId] ?? "Waiting for reachable resource";
    actor.phase = "workSearchWait"; actor.timer = 1; actor.action = "idle";
    return;
  }
  const craftingCart = isCraftingHandcarts(building);
  if (craftingCart && !canCraftHandcart(context, building)) {
    building.working = false; building.status = "No storage has room for another hand cart"; return;
  }
  const orderedOutput = getOrderedOutput(building, craftingCart);
  if (building.typeId === 24 && !orderedOutput) {
    building.working = false; building.status = "Production orders complete"; actor.action = "idle"; return;
  }
  const cycleRule = cycleRuleFor(building, rule, carcass, fieldWork);
  if (!consumeInputs(context, building, cycleRule, actor)) { building.status = "Waiting for inputs"; return; }
  actor.productionOutput = orderedOutput ?? (([17, 19, 33].includes(building.typeId) || !!materialBuildingGroup(building.typeId))
    ? building.selectedOutput ?? mixedCycleOutput(building, rule.outputs) : undefined);
  if (building.typeId === 10)
    actor.productionOutput = materialMineOutput(context, building, actor.productionOutput ?? "stone");
  actor.productionSeconds = cycleRule.seconds;
  actor.fieldWork = fieldWork?.stage;
  actor.sowingBatch = fieldWork?.batch;
  for (const target of actor.sowingBatch ?? []) context.reservations.add(targetKey(target));
  if (work) {
    actor.preparedTarget=materialPlantingSpecies(building.typeId)
      ? { ...work.target, treeSpecies: materialPlantingSpecies(building.typeId) } : work.target;actor.productionPath=work.path;
    context.reservations.add(targetKey(work.target));
  }
  beginInputFetch(context,actor,building);
};
const cycleRuleFor = (
  building: SettlementBuilding, rule: ProductionRule, carcass: unknown, fieldWork: { inputs: string[] } | null
) => {
  if (carcass) return { ...rule, inputs: [] };
  if (fieldWork) return { ...rule, inputs: fieldWork.inputs };
  return isCraftingHandcarts(building) ? handcartCycleRule(rule) : rule;
};
const mustExitPlot = (actor:SettlementActor,building:SettlementBuilding) => ![28, 35, 61].includes(building.typeId) && (!actor.visible ||
  actor.x>=building.x-building.width/2 && actor.x<building.x+building.width/2 && actor.z>=building.z-building.depth/2 && actor.z<building.z+building.depth/2);
const finishProduction = (context: SettlementContext, actor: SettlementActor, building: SettlementBuilding) => {
  const rule = getBuildingProductionRule(building, buildingNation(context, building))!;
  const fieldCycle = [5, 27, 37, 60].includes(building.typeId) && context.fieldCycles;
  let fieldWare: string | undefined;
  let success = true;
  if (actor.target) {
    if (fieldCycle) {
      const result = fieldCycle.complete(building, actor.target);
      success = result.success; fieldWare = result.ware;
    } else success = actor.treeFellingStarted || consumeWorkTarget(context, actor.target, building, actor);
    context.reservations.delete(targetKey(actor.target));
  }
  if (building.typeId >= 10 && building.typeId <= 13) {
    const cell = mineOreCell(context.options.world, building);
    success = cell >= 0;
    if (success) {
      context.options.world.oreAmount[cell]!--; context.options.onOreChanged?.(cell);
      emitDepositMined(context, cell, rule.outputs[0], ownerOf(building));
    }
  }
  if (success && actor.target?.kind === "plant") countIslandAction(context, "plant");
  if (!success) for (const [ware, count] of Object.entries(actor.consumed ?? {})) addGood(building.input, ware, count);
  if (success && fieldCycle) { actor.ware = fieldWare ?? null; building.cycle++; }
  // The cart cycle was decided when its logs were taken, whatever the mode is now.
  if (success && actor.productionOutput === HANDCART_OUTPUT) finishHandcart(building);
  else if (success && building.typeId === 24) {
    actor.ware = actor.productionOutput ?? nextArmoryOutput(building) ?? "sword";
    completeArmoryOrder(building, actor.ware);
  } else if (success && !fieldCycle && rule.outputs.length) {
    actor.ware = materialMineOutput(context, building,
      actor.productionOutput ?? building.selectedOutput ?? mixedCycleOutput(building, rule.outputs));
    building.cycle++;
  }
  actor.productionOutput = undefined;
  actor.productionSeconds = undefined;
  const cycleOutput = actor.ware ?? undefined;
  if (success) context.options.onProductionCycle?.(building, actor.consumed ?? {}, cycleOutput);
  if (success && context.script) emitWareProduced(context, building, cycleOutput);
  // The receipt is closed: holding the spent inputs would double-count them in save/offline accounting.
  actor.consumed = undefined;
  if (success && rule.animal && context.options.onAnimalProduced) {
    if (context.options.onAnimalProduced(building) !== false) actor.ware = null;
  }
  if (continueFarmerSowing(context, actor, building, success)) return;
  actor.treeFellingStarted = undefined;
  actor.wellWork = undefined;
  building.working = false;
  actor.stockBuilding = building.uid; actor.stockContact = actor.ware ? stockContact(context,building,"output",actor.ware,countGoods(building.output)) : undefined;
  actor.wareScale=actor.stockContact?.scale3 ? {...actor.stockContact.scale3} : undefined;
  const point=actor.stockContact?.approach ?? building.access;
  const path=outputStockPath(context,actor,building,point,mustExitPlot(actor,building));
  if (path) setActorPath(actor,path,"outputWalk");
  else { actor.phase="returnBlocked";actor.action="idle";actor.timer=1; }
};
/** An editor-erased finite source cancels its job through the normal refund/return path. */
const recoverRemovedMarbleWork = (context: SettlementContext, actor: SettlementActor,
  building: SettlementBuilding) => {
  if (!isMaterialQuarry(building.typeId) || !actor.target || !["outbound", "work"].includes(actor.phase) ||
    hasMarbleTarget(context, actor.target)) return false;
  finishProduction(context, actor, building);
  return true;
};
/** Event-plan entry point: complete the current fisher phase and start the next one. */
export const advanceFishingWorker = (context: SettlementContext, actor: SettlementActor) => {
  const building = context.buildings.find(entry => entry.uid === actor.building);
  const next = advanceFishingPhase(actor.phase as FishingPhase, actor.timer, actor.timer);
  actor.phase = next.phase;
  actor.action = next.action;
  actor.timer = next.timer;
  if (next.done && building) finishProduction(context, actor, building);
  return next;
};
/** Event-plan entry point: complete a generic production work timer. */
export const finishWorkWorker = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.phase !== "work") return false;
  const building = context.buildings.find(entry => entry.uid === actor.building);
  if (!building) return false;
  finishProduction(context, actor, building);
  return true;
};
/** Shared completion callback for eventized worker phases. */
export const finishWorkerProduction = (
  context: SettlementContext, actor: SettlementActor, building: SettlementBuilding
) => finishProduction(context, actor, building);
/** Event-plan entry point: apply one scheduled builder hammer contact. */
export const applyBuilderContact = (context: SettlementContext, actor: SettlementActor) => {
  if (actor.phase !== "construct") return false;
  const building = context.buildings.find(entry => entry.uid === actor.building);
  if (!building || !constructionSupplied(building)) return false;
  const applied = applyConstructionContact(building);
  if (applied && building.construction === 1) {
    builderSides.delete(actor);
    finishConstruction(context, actor, building);
  }
  return applied;
};
/** Event-plan entry point: apply one scheduled builder hammer contact. */
export const updateWorker = (context: SettlementContext, actor: SettlementActor, dt: number) => {
  if (actor.phase === "retired") return;
  if (validateBuilderAssignment(context, actor, dt)) {
    builderSides.delete(actor);
    updateDemolitionReturn(context, actor, dt);
    return;
  }
  const building = context.buildings.find((entry) => entry.uid === actor.building)!;
  if (recoverRemovedMarbleWork(context, actor, building)) return;
  if (updateFoundationWorker(context, actor, building, dt, () => returnBuilder(context, actor, building))) return;
  if (actor.phase === "sowingBlocked") {
    actor.timer -= dt;
    if (actor.timer <= 0) continueFarmerSowing(context, actor, building, true);
    return;
  }
  if(updatePigBreeder(context,actor,building,dt,()=>beginInputFetch(context,actor,building)))return;
  if (updateForester(context, actor, building, dt)) return;
  if (updateWellWorker(context, actor, building, dt)) return;
  if (actor.phase === "drinkWorkBlocked") {
    actor.timer -= dt;
    if (actor.timer <= 0) approachDrinkWorkstation(context, actor, building);
    return;
  }
  if (actor.phase === "weaverWorkBlocked") {
    actor.timer -= dt;
    if (actor.timer <= 0) approachWeaverWorkstation(context, actor, building);
    return;
  }
  if (updateFisherBoatTrip(context, actor, building, dt, () => deposit(context, actor, building))) return;
  if (updateHunter(context, actor, building, dt, () => finishProduction(context, actor, building))) return;
  if (recoverResourceApproach(context, actor, dt)) return;
  if (actor.phase === "outputFullReturn") {
    if (moveActor(context, actor, dt)) {
      actor.visible = false; actor.phase = "deposit"; actor.action = "idle";
    }
    return;
  }
  if (actor.phase === "outputPutdown") {
    if (!advanceWareTransfer(actor,dt)) return;
    // A boat haul arrives as one basket of several fish (FISHER-BOAT, owner answer 1).
    for (let unit = 0; actor.ware && unit < (actor.wareUnits ?? 1); unit++) {
      addGood(building.output, actor.ware);
      countProducedWare(context, actor.ware);
    }
    releaseWorkerHandling(actor);
    beginWorkerRest(context,actor,building);return;
  }
  if (actor.phase === "inputPickup") {
    if (!advanceWareTransfer(actor,dt)) return;
    clearWareTransfer(actor);
    releaseWorkerHandling(actor);
    if(building.typeId===28){routePigInputToPen(context,actor,building);return;}
    const path=stockToDoorPath(context,actor,building);
    if(path && canEnterDoor(context,actor,building)) setActorPath(actor,path,"inputReturn");
    else {actor.phase="inputReturnBlocked";actor.action="idle";actor.timer=1;}
    return;
  }
  if (["inputFetchBlocked","inputReturnBlocked","workerRestWait"].includes(actor.phase)) {
    actor.timer-=dt;if(actor.timer>0)return;actor.timer=1;
    if(actor.phase==="inputFetchBlocked")beginInputFetch(context,actor,building);
    else if(actor.phase==="workerRestWait")beginWorkerRest(context,actor,building);
    else {const path=stockToDoorPath(context,actor,building);if(path && canEnterDoor(context,actor,building))setActorPath(actor,path,"inputReturn");}
    return;
  }
  if (["assigned", "enterAssigned", "enterRest", "outbound", "returnWork", "retire", "enterRetire", "builderWork", "outputWalk", "inputApproach", "inputReturn"].includes(actor.phase)) {
    if (actor.phase === "builderWork" && actor.timer > 1 && !actor.queueTarget) {
      const point = actor.path[actor.pathIndex];
      const blocker = point && context.actors.find(other => other !== actor && other.visible &&
        (other.queueTarget || (other.pathIndex < other.path.length && ["walk", "carry"].includes(other.action))) &&
        other.delivery?.destination !== building.uid && DMath.hypot(other.x - actor.x, other.z - actor.z) < .5);
      const shoulder = point && blocker && chooseYieldTarget(context, actor, blocker, point, true);
      if (shoulder) { actor.queueTarget = shoulder; actor.timer = 0; }
    }
    if (!moveActor(context, actor, dt)) return;
    if (actor.phase === "retire") {
      const home = context.buildings.find((entry) => entry.uid === actor.home)!;
      if (!canEnterDoor(context, actor, home)) return;
      setActorPath(actor, entrancePath(home), "enterRetire"); return;
    }
    if (actor.phase === "enterRetire") {
      actor.visible = false; retirePerson(context, actor);
      const home = context.buildings.find((entry) => entry.uid === actor.home);
      if (home) addIdleSettlers(context, home);
      if (home && actor.tool) addGood(home.inventory, actor.tool);
      if (home && actor.ware) addGood(home.inventory, actor.ware, actor.wareUnits ?? 1);
      actor.ware = null; actor.wareScale = undefined; actor.wareUnits = undefined; actor.catapultStoneCargo = undefined;
      actor.tool = undefined;
      return;
    }
    if (actor.phase === "returnWork" || actor.phase === "outputWalk") { deposit(context, actor, building); return; }
    if(actor.phase==="inputApproach") {
      const ware=actor.productionInputs![0]!;
      // A live nation switch can replace this input and invalidate the old stock contact.
      if (!actor.stockContact || actor.stockContact.ware !== ware) {
        beginInputFetch(context, actor, building);
        return;
      }
      if (!(building.input[ware] ?? 0)) {actor.phase="inputFetchBlocked";actor.action="idle";actor.timer=1;return;}
      addGood(building.input,ware,-1);addGood(actor.consumed!,ware);actor.ware=ware;
      startWareTransfer(actor,"pickup",ware,actor.stockContact!);
      beginWorkerHandling(context, actor, "pickup", ware);
      actor.phase="inputPickup";
      context.options.onWorkerPhase?.(actor);
      return;
    }
    if(actor.phase==="inputReturn") {
      actor.ware=null;actor.wareScale=undefined;actor.visible=!building.hasDoor;actor.productionInputs?.shift();beginInputFetch(context,actor,building);return;
    }
    if (actor.phase === "outbound") {
      if ((building.typeId === 17 || isMaterialWoodcutter(building.typeId)) && actor.target && context.options.getFelledTreePhase) {
        actor.treeFellingStarted = consumeWorkTarget(context, actor.target, building, actor);
        if (actor.treeFellingStarted) {
          actor.phase = "waitTreeFall";
          actor.action = "chop";
          actor.yaw = DMath.atan2(actor.target.x - actor.x, actor.target.z - actor.z);
          building.working = true;
          return;
        }
      }
      if (building.typeId === 18 && actor.target) {
        actor.yaw = DMath.atan2(actor.target.x - actor.x, actor.target.z - actor.z);
        actor.phase = "fishCast"; actor.action = "fish_cast"; actor.timer = FISHING_WORK_TIMING.cast;
        context.options.onWorkerPhase?.(actor);
        building.working = true; return;
      }
      const nation = buildingNation(context, building);
      actor.phase = "work"; actor.timer = actor.fieldWork === "sow"
        ? WHEAT_SOW_SECONDS : actor.productionSeconds ?? getBuildingProductionRule(building, nation)!.seconds;
      if (actor.target) actor.yaw = DMath.atan2(actor.target.x - actor.x, actor.target.z - actor.z);
      if (building.typeId === 61) actor.yaw = weaverWorkstation(building).yaw;
      if (isExpansionDrinkMaker(building, nation)) {
        actor.yaw = drinkWorkstation(building, nation)!.yaw;
        actor.visible = true;
      }
      actor.action = getProductionAction(building.typeId);
      context.options.onWorkerPhase?.(actor);
      building.working = true; return;
    }
    if (actor.phase === "assigned" && actor.job !== "Builder") {
      if (!canEnterDoor(context, actor, building)) return;
      setActorPath(actor, entrancePath(building), "enterAssigned"); return;
    }
    if (actor.phase === "enterRest") {
      actor.visible = !building.hasDoor; actor.phase = "rest"; actor.timer = WORKER_REST_SECONDS; actor.action = "idle"; return;
    }
    if (actor.phase === "builderWork") {
      actor.phase = "construct"; actor.action = "work"; actor.animationTime = 0; actor.visible = true;
      context.options.onWorkerPhase?.(actor);
    } else {
      if (actor.phase === "enterAssigned" && context.script) emitBuildingOccupied(context, building, actor);
      actor.visible = actor.job === "Builder" || !building.hasDoor; actor.phase = "inside"; actor.action = "idle";
      building.door = 1;
    }
  }
  if (actor.job === "Builder") {
    const side = Math.min(3, Math.floor(building.construction * 4));
    if (actor.phase !== "construct" || builderSides.get(actor)?.side !== side) {
      building.working = false;
      const positions = constructionWorkPositions(building);
      for (let offset = 0; offset < positions.length; offset++) {
        const base = positions[(side + offset) % positions.length]!;
        const materialContacts=Object.entries(building.required).filter(([,count])=>count>0).map(([ware])=>stockContact(context,building,"input",ware,0).approach);
        const edge=(side+offset)%positions.length;
        const point=[0,.9,-.9,1.8,-1.8].map(shift=>({x:base.x+(edge%2 ? shift : 0),z:base.z+(edge%2 ? 0 : shift)}))
          .find(candidate=>materialContacts.every(contact=>DMath.hypot(candidate.x-contact.x,candidate.z-contact.z)>.6));
        if(!point)continue;
        if (context.actors.some((other) => other !== actor && other.visible &&
          (other.queueTarget || other.pathIndex >= other.path.length || !["walk", "carry"].includes(other.action)) &&
          DMath.hypot(other.x - point.x, other.z - point.z) < 0.3)) continue;
        const local = context.options.findWorkerPath || isPublicTerrainSingleLeg(actor, point);
        const path = local ? groundPath(context, actor, point) : publicTerrainPath(context, actor, point);
        if (path) { builderSides.set(actor, { edge, side }); actor.visible = true; setActorPath(actor, path, "builderWork"); return; }
      }
      actor.action = "idle"; building.status = "Waiting for safe building access"; return;
    }
    // Re-applied every tick: yields, waits and reloads must not leave the hammer pointing sideways.
    actor.yaw = constructionFacing(builderSides.get(actor)!.edge);
    if (!constructionSupplied(building)) {
      building.status = "Waiting for construction supplies"; building.working = false;
      actor.action = "idle"; actor.animationTime = 0; return;
    }
    if (actor.action !== "work") {
      actor.action = "work"; actor.animationTime = 0;
      context.options.onWorkerPhase?.(actor);
      return;
    }
    building.working = true; building.status = "Constructing";
    if (tickSystemMasked(context.options.tickMask?.builderContacts) &&
      context.options.eventCoreOwns?.(actor, "builderContact")) return;
    const contacts = builderHammerContacts(Math.max(0, actor.animationTime - dt), actor.animationTime);
    for (let hit = 0; hit < contacts; hit++) {
      if (!applyConstructionContact(building)) break;
      if (building.construction === 1) { builderSides.delete(actor); finishConstruction(context, actor, building); break; }
    }
    return;
  }

  if (actor.phase === "builderReturnBlocked") {
    actor.timer -= dt;
    if (actor.timer <= 0) returnBuilder(context, actor, building);
    return;
  }
  if (actor.phase === "returnBlocked") {
    actor.action = "idle";
    actor.timer -= dt;
    if (actor.timer > 0) return;
    actor.timer = 1;
    // A loaded or repaired yard may have a different usable stance than the saved contact. Recompute
    // before declaring the route blocked so old saves recover without losing the carried batch.
    const refreshed = actor.ware && context.options.stockContact?.(building, "output", actor.ware,
      actor.stockContact?.slot ?? countGoods(building.output));
    if (refreshed) {
      actor.stockContact = refreshed;
      actor.wareScale = refreshed.scale3 ? { ...refreshed.scale3 } : undefined;
    }
    const point = actor.stockContact?.approach ?? building.access;
    const path = outputStockPath(context,actor,building,point,mustExitPlot(actor,building)) ??
      farStockReturnPath(context, actor, building, point);
    if (path) setActorPath(actor,path,"outputWalk");
    else building.status = "Waiting for a clear return route";
    return;
  }
  if (actor.phase === "waitTreeFall") {
    const phase = actor.target && context.options.getFelledTreePhase?.(actor.target.id);
    actor.action = phase === "chopping" ? "chop" : "idle";
    if (phase === "chopping" || phase === "falling" || phase === "standing") return;
    // The tree has landed. Only now attach the trunk and start the return journey.
    finishProduction(context, actor, building);
    return;
  }
  if (actor.phase === "retired") return;
  if (actor.phase === "deposit") { deposit(context, actor, building); return; }
  if (["fishCast", "fishWait", "fishReel"].includes(actor.phase)) {
    const next = advanceFishingPhase(actor.phase as FishingPhase, actor.timer, dt);
    actor.phase = next.phase;
    actor.action = next.action;
    actor.timer = next.timer;
    if (next.done) finishProduction(context, actor, building);
    return;
  }
  if (actor.phase === "work") {
    actor.timer -= dt;
    if (actor.timer <= 0) finishProduction(context, actor, building);
    return;
  }
  if (actor.phase === "rest" || actor.phase === "workSearchWait") {
    actor.timer -= dt; if (actor.timer > 0) return; actor.phase = "inside";
  }
  if (actor.phase === "inside") {
    if ([37, 60].includes(building.typeId) && actor.timer > 0) {
      actor.timer -= dt;
      if (actor.timer > 0) return;
    }
    if (startFisherBoatTrip(context, actor, building)) return;
    beginProduction(context, actor, building);
    if (context.options.onProductionWait && actor.phase === "inside") {
      if (building.status === "Waiting for inputs") context.options.onProductionWait(building, dt, "inputs");
      else if (building.status === "Output stock full") context.options.onProductionWait(building, dt, "output");
    }
  }
};

export const saveBuilderSides = (context: SettlementContext): [number, number, number][] =>
  context.actors.flatMap(actor => {
    const work = builderSides.get(actor);
    return work ? [[actor.uid, work.side, work.edge] as [number, number, number]] : [];
  });
export const restoreBuilderSides = (
  context: SettlementContext, entries: ([number, number] | [number, number, number])[]
) => {
  for (const [uid, side, edge] of entries) {
    const actor = context.actors.find(candidate => candidate.uid === uid);
    // Older saves lack the edge: the builder's first work position is that side's own edge.
    if (actor) builderSides.set(actor, { edge: edge ?? side, side });
  }
};
