import { HUNTER_FISHER_TYPES, type TalentModifiers } from "@shared/catalog/balance";

import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { getBuildingStockContact } from "../../render-common/buildings/building-stock-anchors";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { getRomanBuildingWorldSizing } from "../../render-common/buildings/building-world-sizing";
import type { WorkerNation } from "../../render-common/workers/worker-nation";
import {
  CARRIER_WALK_SPEED, FLAX_FIELD_LIMIT, FLAX_GROWTH_SECONDS, HANDCART_LOGISTICS,
  PRODUCTION_OUTPUT_CAPACITY, WARE_TRANSFER_SECONDS, WHEAT_BATCH_SIZE, WHEAT_GROWTH_SECONDS,
  WORKER_REST_SECONDS, WORKER_WALK_SPEED
} from "../../shared/balance/economy";
import { DMath } from "../../shared/math/deterministic-math";
import { NEUTRAL_TALENT_MODIFIERS, talentModifiers } from "../../shared/progression/talents";
import { completeArmoryOrder, nextArmoryOutput } from "../../shared/settlement/armory-orders";
import { FISHER_BOAT_CATCH } from "../../shared/settlement/constants";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { mixedCycleOutput } from "../../shared/settlement/mixed-output";
import { nationDrinkChain, PLANTATIONS } from "../../shared/settlement/nation-drinks";
import { getBuildingProductionRule, STORAGE_IDS } from "../../shared/settlement/production-rules";
import { effectiveProductionSeconds } from "../../shared/settlement/production-timing";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { snapRoadPoint } from "../../shared/settlement/road-types";
import { savedOccupancy } from "../../shared/settlement/save-cell-codecs";
import { fieldWorkStandOff } from "../../shared/settlement/settlement-field-cycles";
import { isBoatFishing } from "../../shared/settlement/settlement-fisher-boat-mode";
import { isHomeType } from "../../shared/settlement/settlement-home";
import { ownerOf, PLAYER_FACTION } from "../../shared/settlement/settlement-ownership";
import { groundPath } from "../../shared/settlement/settlement-paths";
import { isMineType } from "../../shared/settlement/settlement-placement";
import { productionInputStock } from "../../shared/settlement/settlement-sawmill-handcarts";
import { SHIPYARD_BOAT_WORK_SECONDS } from "../../shared/settlement/settlement-shipyard-boats";
import type { Goods, ProductionRule, SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "../../shared/settlement/settlement-types";
import { wellBucketPickupContact, wellWorkstation } from "../../shared/settlement/settlement-well-work";
import { resourceWorkRadius } from "../../shared/settlement/settlement-work-ranges";
import { doorToStockPath } from "../../shared/settlement/settlement-worker-stock-paths";
import { workshopCycleFactor } from "../../shared/settlement/workshop-upgrades";
import type { WorldData } from "../../shared/world/world-data";
import { offlineBoatFishingTrip } from "./offline-boat-fishing";
import type { OfflineEconomyJob } from "./offline-economy-events";

export const OFFLINE_ECONOMY_TICKS_PER_SECOND = 1000;
export interface OfflineEconomyBuildingRate {
  uid: number;
  jobUid: string;
  cycleSeconds: number;
  workSeconds: number;
  workerTravelSeconds: number;
  carrierSeconds: number;
  reason?: string;
  observedWaitSeconds?: { inputs: number; output: number };
}
export interface OfflineEconomyRates {
  /** The home storage's connected road component; detached stores never fund these jobs. */
  storageUids: number[];
  jobs: OfflineEconomyJob[];
  buildings: OfflineEconomyBuildingRate[];
  unsupported: { uid: number; reason: string }[];
  routes: {
    calls: number; hits: number; misses: number; entries: number;
    carrierCapacity: number; equivalentCarriers: number; globalThrottle: number;
    /** Static free-flow route costs and maximum-radius worker trips are approximations. */
    assumption: string;
  };
}

const buildingTalentBonus = (typeId: number, talents: TalentModifiers, colony: boolean) =>
  talents.productionSpeed + (colony ? talents.colonyProductionSpeed : 0) +
  (HUNTER_FISHER_TYPES.includes(typeId) ? talents.hunterFisherSpeed : 0);
/** Production-speed talent share including the colony bonus and occupation-specific speed. */
export const offlineProductionTalentBonus = buildingTalentBonus;

/** Reusable crop plots by farm type; both use the same sow/harvest event model. */
const CROP_RECIPES: Readonly<Record<number, { kind: "flax" | "grain"; limit: number; growth: number }>> = {
  37: { growth: WHEAT_GROWTH_SECONDS, kind: "grain", limit: WHEAT_BATCH_SIZE },
  60: { growth: FLAX_GROWTH_SECONDS, kind: "flax", limit: FLAX_FIELD_LIMIT }
};
const cropRecipe = (typeId: number) => CROP_RECIPES[typeId];

const unsupportedReason = (building: SettlementBuilding, rule: ProductionRule | undefined, owner: number) => {
  if (building.construction < 1) return "under construction";
  if (ownerOf(building) !== owner) return "not player owned";
  if (building.productionPaused) return "production paused";
  if (!rule) return "no production recipe";
  if (rule.service) return "service consumption omitted";
  if (!rule.outputs.length) return "no ware output";
  if (building.typeId === 33 && building.handcartMode) return "handcart orders require detailed simulation";
  if (building.worker === undefined) return "unstaffed";
  if (building.selectedOutput && !rule.outputs.includes(building.selectedOutput)) return "invalid selected output";
  return undefined;
};

/** Authored pickup, shelf and crank positions; axis-aligned legs allow a local detour around stock. */
const wellTravelSeconds = (building: SettlementBuilding, nation: WorkerNation) => {
  const station = wellWorkstation(building, nation).point, pickup = wellBucketPickupContact(building, nation).approach;
  const distance = (from: { x: number; z: number }, to: { x: number; z: number }) =>
    Math.abs(from.x - to.x) + Math.abs(from.z - to.z);
  let longest = 0;
  for (let slot = 0; slot < PRODUCTION_OUTPUT_CAPACITY; slot++) {
    const contact = getBuildingStockContact(35, "output", "water", slot, building.x, building.z,
      building.rotation, building.y, building.output, building.input, stockStyleFor(nation, building));
    const shelf = contact ? { x: contact.approach[0], z: contact.approach[2] } : building.access;
    longest = Math.max(longest, distance(station, pickup) + distance(pickup, shelf) + distance(shelf, station));
  }
  return longest / WORKER_WALK_SPEED;
};

const distance = (from: { x: number; z: number }, to: { x: number; z: number }) =>
  DMath.hypot(to.x - from.x, to.z - from.z);
const pathLength = (from: SettlementPoint, path: readonly SettlementPoint[]) => {
  let length = 0, previous = from;
  for (const point of path) { length += distance(previous, point); previous = point; }
  return length;
};
const doorLeg = (building: SettlementBuilding) => distance(building.doorThreshold, building.workerApproach);
const stockPoint = (building: SettlementBuilding, kind: "input" | "output", ware: string, slot = 0,
  nation: WorkerNation = "roman") => {
  const contact = getBuildingStockContact(building.typeId, kind, ware, slot, building.x, building.z,
    building.rotation, building.y, kind === "input" ? building.input : building.output,
    kind === "input" ? building.output : building.input, stockStyleFor(nation, building));
  return contact ? { x: contact.approach[0], z: contact.approach[2] } : building.access;
};
/** Static door-lane route; stock errands start/end indoors, never at the public road sign. */
const stockTrip = (building: SettlementBuilding, kind: "input" | "output", ware: string,
  nation: WorkerNation = "roman") => {
  let longest = 0;
  const slots = kind === "output" ? PRODUCTION_OUTPUT_CAPACITY : productionInputStock(building, ware);
  for (let slot = 0; slot < slots; slot++) longest = Math.max(longest,
    doorLeg(building) + distance(building.workerApproach, stockPoint(building, kind, ware, slot, nation)));
  return longest * 2;
};
/** Round-trip seconds between the worker's door lane and a stock contact (walking only). */
export const offlineStockTripSeconds = (building: SettlementBuilding, kind: "input" | "output", ware: string,
  nation: WorkerNation = "roman") => stockTrip(building, kind, ware, nation) / WORKER_WALK_SPEED;
/** One-way door-threshold to worker-approach walking seconds. */
export const offlineDoorLegSeconds = (building: SettlementBuilding) => doorLeg(building) / WORKER_WALK_SPEED;

/** A shipwright carrying an already-completed boat cannot start a second one on the same walk. */
const boatResumeDelay = (actor: SettlementActor | undefined, building: SettlementBuilding,
  home: SettlementBuilding, roadLength: number) => {
  if (!actor || actor.boatWork === undefined) return 0;
  let previous = { x: actor.x, z: actor.z }, remaining = 0;
  for (const point of actor.path.slice(actor.pathIndex)) {
    remaining += distance(previous, point); previous = point;
  }
  const workshopEntry = distance(building.access, building.workerApproach) + doorLeg(building);
  const homeEntry = distance(home.access, home.workerApproach) + doorLeg(home);
  if (actor.phase === "assigned" && actor.boatWork === -1)
    return (remaining + workshopEntry) / WORKER_WALK_SPEED + 2 * WARE_TRANSFER_SECONDS;
  if (actor.ware !== "boat" || actor.boatWork !== 1 || !["home", "enterHome"].includes(actor.phase)) return 0;
  const entryAndExit = homeEntry * (actor.phase === "home" ? 2 : 1);
  return (remaining + entryAndExit + roadLength + workshopEntry) / WORKER_WALK_SPEED +
    2 * WARE_TRANSFER_SECONDS;
};

/** Saved crop/pile positions replace a maximum search radius once their worker owns real plots. */
export const offlineFieldTripSeconds = (save: GameSaveV1, world: WorldData, building: SettlementBuilding,
  standOff: number, suppliedPlots?: readonly { id: number; x: number; z: number }[]) => {
  const plots = suppliedPlots ?? save.settlement.fields.filter(field => field.owner === building.uid);
  if (!plots.length) return undefined;
  const origin = building.workerApproach, occupied = savedOccupancy(save.settlement);
  const first = Math.floor(origin.z) * world.cellsX + Math.floor(origin.x);
  const costs = new Map<number, number>([[first, 0]]), pending = [first];
  for (let index = 0; index < pending.length; index++) {
    const cell = pending[index]!, x = cell % world.cellsX, z = Math.floor(cell / world.cellsX);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx!, nz = z + dz!, next = nz * world.cellsX + nx;
      if (nx < 0 || nz < 0 || nx >= world.cellsX || nz >= world.cellsZ || costs.has(next) ||
        !world.walkCost[next] || occupied[next] === 1 ||
        DMath.hypot(nx + .5 - origin.x, nz + .5 - origin.z) > 16) continue;
      costs.set(next, costs.get(cell)! + 1); pending.push(next);
    }
  }
  const lengths = plots.flatMap(plot => {
    const dx = plot.x - origin.x, dz = plot.z - origin.z, length = DMath.hypot(dx, dz) || 1;
    const target = { x: plot.x - dx / length * standOff, z: plot.z - dz / length * standOff };
    const cost = costs.get(Math.floor(target.z) * world.cellsX + Math.floor(target.x));
    return cost === undefined ? [] : [Math.max(distance(origin, target), cost)];
  });
  return lengths.length ? 2 * (doorLeg(building) + lengths.reduce((sum, length) => sum + length, 0) / lengths.length) : undefined;
};

const inputTargets = (building: SettlementBuilding, rule: ProductionRule, inputs: Goods): Goods => {
  const targets: Goods = {};
  for (const [ware, units] of Object.entries(inputs)) if (!ware.startsWith("~"))
    // A grouped charcoal pile needs six sequential real deliveries before its modeled atomic start.
    targets[ware] = Math.max(units, productionInputStock(building, ware));
  if (rule.alternativeFood) for (const ware of rule.inputs) targets[ware] = productionInputStock(building, ware);
  return targets;
};

/** A computer economy's estimate (EAI5b): its owner and nation; neutral talents, no colony bonus (EAI1c C1). */
export interface OfflineEconomyOwner {
  nation: WorkerNation;
  owner: number;
}

/**
 * Static conservative cycle estimate, independent of the horizon. Route metrics are memoized by
 * snapped endpoints and navigation revisions. Inputs and outputs remain whole units; synthetic
 * finite-source keys are populated by the save adapter. No source availability is invented here.
 * This estimates throughput; it does not establish accuracy bounds against live traffic. Without
 * `computer` it estimates the player's economy; with it, that computer economy's own buildings,
 * storages and carriers (per-owner pools, enemy economy AI plan §5.3).
 */
export const estimateOfflineEconomyRates = (
  save: GameSaveV1, world: WorldData, computer?: OfflineEconomyOwner
): OfflineEconomyRates => {
  const settlement = save.settlement, owner = computer?.owner ?? PLAYER_FACTION;
  const talents = computer ? NEUTRAL_TALENT_MODIFIERS : talentModifiers(save.player?.talents);
  const nation = computer?.nation ?? settlement.playerNation ?? "roman";
  const buildings: OfflineEconomyBuildingRate[] = [], jobs: OfflineEconomyJob[] = [];
  const unsupported: OfflineEconomyRates["unsupported"] = [];
  const storages = settlement.buildings.filter(building => building.construction === 1 &&
    ownerOf(building) === owner && STORAGE_IDS.has(building.typeId));
  const roads = createRoadNetwork(world);
  if (!roads.replaceSegments(settlement.roads)) throw new Error("Offline economy: invalid roads");
  const anchor = storages.find(isHomeType) ?? storages[0];
  const connectedStorages = anchor ? storages.filter(storage => storage.uid === anchor.uid ||
    roads.routeMetrics(anchor.access, storage.access).route) : [];
  // Carrier labor is shared across the completed deposits on the same connected road component.
  // Workers, carts, boats and people remain owned where they are.
  const connectedIds = new Set(connectedStorages.map(storage => storage.uid));
  const carriers = settlement.actors.filter(actor => actor.job === "Carrier" &&
    (connectedIds.has(actor.home) || connectedIds.has(actor.building)));
  // Average actual manifests rather than allocating the best cart to every carrier.
  const carrierCapacity = carriers.length ? carriers.reduce((sum, actor) => sum + Math.max(1,
    actor.workerMovementPlan?.manifest?.capacity ?? actor.handcart?.trip?.capacity ?? 1), 0) / carriers.length : 1;
  const connectedIdleSettlers = connectedStorages.reduce((sum, storage) => sum + (storage.idleSettlers ?? 0), 0);
  // The saved settler total counts the player's storages only (EAI1c c6).
  const idleSettlers = computer ? connectedIdleSettlers : Math.min(settlement.settlers, connectedIdleSettlers);
  const equivalentCarriers = carriers.length + (carriers.length === 0 && idleSettlers > 0 ? 1 : 0);
  const speed = CARRIER_WALK_SPEED * (1 + talents.carrierSpeed) *
    (carriers.some(actor => actor.handcart?.state === "hitched") ? HANDCART_LOGISTICS.speedFactor : 1);
  const routeMemo = new Map<string, ReturnType<typeof roads.routeMetrics>>();
  let calls = 0, hits = 0, misses = 0;
  const route = (from: { x: number; z: number }, to: { x: number; z: number }) => {
    calls++;
    const start = snapRoadPoint(from), end = snapRoadPoint(to);
    const key = `${roads.revision}:${world.terrainRevision ?? 0}:${world.buildRevision ?? 0}:` +
      `${start.x},${start.z}>${end.x},${end.z}`;
    const cached = routeMemo.get(key);
    if (cached) { hits++; return cached; }
    misses++;
    const metrics = roads.routeMetrics(start, end);
    routeMemo.set(key, metrics);
    return metrics;
  };
  // Navigation reads world, occupancy and courtyard ownership; it does not need a running
  // simulation, moving actors, or regenerated resources. Reuse one context for its route caches.
  const navigation = { options: { world, roads }, buildings: settlement.buildings, actors: [],
    playerNation: computer ? nation : settlement.playerNation,
    occupied: savedOccupancy(settlement).slice(), reservations: new Set(settlement.reservations)
  } as unknown as SettlementContext;
  const colony = !computer &&
    settlement.buildings.some(building => building.typeId === 39 && !building.militaryFaction);
  const shipyardModes = new Map<number, string>(settlement.naval?.modes ?? []);
  for (const building of settlement.buildings) {
    if (STORAGE_IDS.has(building.typeId) || (computer && ownerOf(building) !== owner)) continue;
    if (building.typeId === 36 && shipyardModes.get(building.uid) === "ships") {
      // A sea hull is a fleet construction receipt, not the generic boat ware. Native/event
      // simulation owns it until a durable offline ship-site ledger exists; never invent a boat.
      unsupported.push({ uid: building.uid,
        reason: "sea-ship construction requires native simulation; site and materials retained" });
      continue;
    }
    const rule = getBuildingProductionRule(building, nation);
    const reason = unsupportedReason(building, rule, owner);
    if (reason || !rule) { unsupported.push({ uid: building.uid, reason: reason ?? "no production recipe" }); continue; }
    const boatTrip = isBoatFishing(building) ? offlineBoatFishingTrip(navigation, building) : undefined;
    if (isBoatFishing(building) && !boatTrip) {
      unsupported.push({ uid: building.uid, reason: "boat fishing site, shore walk or rowing route unavailable" });
      continue;
    }
    if (building.typeId === 27 && !settlement.fields.some(field =>
      field.owner === building.uid && field.kind === "charcoal")) {
      // A charburner cannot burn logs without a saved charcoal pile. The saved worker may be
      // waiting for a reachable site; inventing the first pile would create free coal.
      unsupported.push({ uid: building.uid, reason: "no reachable charcoal field site" });
      continue;
    }
    const outputs: Goods = {};
    const selected = building.typeId !== 24 && building.selectedOutput ? [building.selectedOutput] : rule.outputs;
    const sequenced = building.typeId === 24 || building.typeId === 21 || selected.length > 1;
    for (const ware of selected) outputs[ware] = sequenced ? 0 : 1;
    // A boat trip lands its whole catch in one basket; the net needs no finite fishing site.
    if (boatTrip) outputs.fish = FISHER_BOAT_CATCH;
    let batch = 1;
    const inputs: Goods = {};
    const notes: string[] = [];
    if (sequenced) notes.push("deterministic single-cycle output sequence");
    const bonus = buildingTalentBonus(building.typeId, talents, colony);
    const factor = workshopCycleFactor(building, bonus);
    let workSeconds = Math.max(...selected.map(ware =>
      effectiveProductionSeconds(rule.seconds, building.typeId, ware) / factor));
    let visits = batch, sourceWait = 0;
    let persistentCrop = false, ownedFieldGeometry = false;
    const crop = cropRecipe(building.typeId);
    const ownedFields = crop === undefined
      ? 0 : save.settlement.fields.filter(field => field.owner === building.uid && field.kind === crop.kind).length;
    const ownedFieldBatch = Math.min(crop?.limit ?? 1, Math.max(1, ownedFields));
    if (building.typeId === 27) {
      // The live pile takes 12 building visits (6 logs), 6 uncovering visits and 6 coal visits.
      batch = 6; outputs.coal = 6; inputs.logs = 6; visits = 24;
      workSeconds = effectiveProductionSeconds(rule.seconds * visits, building.typeId, "coal") / factor;
      sourceWait = 60;
      notes.push("charcoal full pile serialized including burning; saved partial pile not credited");
    } else {
      if (!rule.alternativeFood) for (const ware of rule.inputs) inputs[ware] = (inputs[ware] ?? 0) + batch;
      if (isMineType(building.typeId)) inputs[`~ore:${building.uid}`] = batch;
      else if (rule.outdoor === "tree") inputs[`~tree:${building.typeId}`] = batch;
      else if (!boatTrip && ["fish", "stone", "wildlife"].includes(rule.outdoor ?? ""))
        inputs[`~source:${building.uid}`] = batch;
      if (rule.outdoor === "field") {
        const plantation = PLANTATIONS[nationDrinkChain(nation).plantation];
        const growth = building.typeId === 5 ? plantation.regrowSeconds ?? plantation.growSeconds : crop!.growth;
        if (crop !== undefined && ownedFields > 0) {
          // One harvest trip per crop unit; the worker sows a neighbouring reusable plot in the same trip.
          visits = 1;
          workSeconds *= 2;
          sourceWait = growth / ownedFields / (1 + talents.fieldGrowthSpeed);
          notes.push(`saved owned ${crop.kind} plots (${ownedFields}); one harvest visit with growth and sowing amortized over the batch`);
        } else {
          const plantationLimit = building.typeId === 5 ? plantation.limit : 0;
          const plots = crop?.limit ?? (plantationLimit || 6);
          sourceWait = growth / Math.max(1, plots) / (1 + talents.fieldGrowthSpeed);
          persistentCrop = building.typeId === 5 && plantation.regrowSeconds !== undefined;
          if (!persistentCrop) { visits *= 2; workSeconds *= 2; }
          notes.push(crop?.kind === "flax"
            ? "flax sow, pull and drying visits with amortized growth; saved crop phase approximated"
            : "field sow and harvest visits with amortized growth; saved crop phase approximated");
        }
      }
      if (building.typeId === 28 || rule.animal)
        notes.push("animal feeding cycle approximation; saved animal growth phase not credited");
    }
    const outputWares = Object.keys(outputs);
    const reachable = connectedStorages.map(storage => ({ storage, metrics: route(building.access, storage.access) }))
      .filter(entry => entry.metrics.route && outputWares.every(ware => entry.storage.accepts[ware] !== false))
      .sort((a, b) => a.metrics.route!.cost - b.metrics.route!.cost || a.storage.uid - b.storage.uid);
    if (!reachable.length) {
      unsupported.push({ uid: building.uid, reason: "no completed road-connected storage accepts every output" }); continue;
    }
    if (!equivalentCarriers) {
      unsupported.push({ uid: building.uid, reason: "no saved carrier or available settler" }); continue;
    }
    let boatWorkerTripSeconds = 0, firstTick = 0;
    if (building.typeId === 36) {
      const worker = settlement.actors.find(actor => actor.uid === building.worker);
      const home = storages.find(isHomeType);
      const homeRoute = home && route(building.access, home.access).route;
      if (!home || !homeRoute || home.accepts.boat === false) {
        unsupported.push({ uid: building.uid, reason: "boat worker has no accepting road-connected home storage" });
        continue;
      }
      // actorGroundSpeed gives shipwrights the fixed worker pace; locomotionSpeed is a cached animation value.
      const workerSpeed = WORKER_WALK_SPEED;
      const { recipe, scale } = getRomanBuildingWorldSizing(getBuildingDefinition(36));
      const offset = recipe.modelOriginOffset ?? [0, 0, 0], angle = building.rotation * Math.PI / 2;
      const local = { x: (1.21 + offset[0]!) * scale, z: (-.12 + offset[2]!) * scale };
      const station = { x: building.x + local.x * DMath.cos(angle) + local.z * DMath.sin(angle),
        z: building.z - local.x * DMath.sin(angle) + local.z * DMath.cos(angle) };
      const input = stockPoint(building, "input", "planks", 0, nation);
      let localDistance = 2 * doorLeg(building) + distance(building.workerApproach, input) +
        distance(input, station) + distance(station, building.access) +
        distance(building.access, building.workerApproach) +
        2 * (distance(home.access, home.workerApproach) + doorLeg(home));
      const pickupPath = doorToStockPath(navigation, building, input);
      const workshopPath = groundPath(navigation, input, station, building.uid);
      const leavePath = groundPath(navigation, station, building.access, building.uid);
      if (pickupPath && workshopPath && leavePath) {
        localDistance = pathLength(building.doorThreshold, pickupPath) + pathLength(input, workshopPath) +
          pathLength(station, leavePath) + distance(building.access, building.workerApproach) + doorLeg(building) +
          2 * (distance(home.access, home.workerApproach) + doorLeg(home));
        notes.push("boat input and workstation legs use native courtyard/prop-aware ground paths");
      } else notes.push("boat local navigation unresolved; direct authored-leg approximation retained");
      boatWorkerTripSeconds = (2 * homeRoute.length + localDistance) / workerSpeed;
      firstTick = Math.ceil(boatResumeDelay(worker, building, home, homeRoute.length) * OFFLINE_ECONOMY_TICKS_PER_SECOND);
      if (firstTick) notes.push("new boat work waits for the saved shipwright's delivery and return");
      workSeconds = SHIPYARD_BOAT_WORK_SECONDS;
      notes.push("shipwright carries each boat home and walks back; worker road trip cannot overlap another boat cycle");
    }
    const inputUnits = Object.entries(inputs).filter(([ware]) => !ware.startsWith("~"))
      .reduce((sum, [, amount]) => sum + amount, 0) + (rule.alternativeFood ? batch : 0);
    const outputUnits = sequenced ? 1 : Object.values(outputs).reduce((sum, amount) => sum + amount, 0);
    const carrierOutputUnits = building.typeId === 36 ? 0 : outputUnits;
    const trips = Math.ceil(inputUnits / carrierCapacity) + Math.ceil(carrierOutputUnits / carrierCapacity);
    const carrierSeconds = 2 * reachable[0]!.metrics.route!.cost / speed * trips +
      HANDCART_LOGISTICS.itemSeconds * 2 * (inputUnits + carrierOutputUnits);
    let workerTravelSeconds = rule.outdoor ? 2 * resourceWorkRadius(rule.outdoor) / WORKER_WALK_SPEED * visits : 0;
    if (boatTrip) {
      workSeconds = effectiveProductionSeconds(boatTrip.inPlaceSeconds, building.typeId, "fish") / factor;
      workerTravelSeconds = boatTrip.travelSeconds;
      notes.push(`boat trip: saved launch slot, mean rowing route over the saved nets, ${FISHER_BOAT_CATCH} fish per trip`);
    }
    if (building.typeId === 5) workerTravelSeconds = 2 * PLANTATIONS[nationDrinkChain(nation).plantation].radius / WORKER_WALK_SPEED * visits;
    if (building.typeId === 27) workerTravelSeconds = 2 * 8 / WORKER_WALK_SPEED * visits;
    workerTravelSeconds += boatWorkerTripSeconds;
    if (building.typeId === 35) workerTravelSeconds = wellTravelSeconds(building, nation);
    if (![27, 28, 35, 36, 38].includes(building.typeId)) {
      if (!isMineType(building.typeId)) for (const [ware, units] of Object.entries(inputs))
        if (!ware.startsWith("~")) workerTravelSeconds += stockTrip(building, "input", ware, nation) / WORKER_WALK_SPEED * units;
      workerTravelSeconds += Math.max(...selected.map(ware => stockTrip(building, "output", ware, nation))) / WORKER_WALK_SPEED;
    }
    if ([5, 27, 37, 60].includes(building.typeId)) {
      // Charcoal keeps its historical plot-centre offline estimate; the outside-clamp work contact
      // must not change catch-up throughput just because the worker no longer stands in the pile.
      let standOff = 0;
      if (building.typeId === 5) standOff = fieldWorkStandOff(nationDrinkChain(nation).plantation);
      else if (building.typeId === 37) standOff = fieldWorkStandOff("grain");
      else if (building.typeId === 60) standOff = fieldWorkStandOff("flax");
      const trip = offlineFieldTripSeconds(save, world, building, standOff);
      if (trip !== undefined) {
        ownedFieldGeometry = true;
        const outputTrip = building.typeId === 27 ? 0
          : Math.max(...selected.map(ware => stockTrip(building, "output", ware, nation))) / WORKER_WALK_SPEED;
        workerTravelSeconds = trip / WORKER_WALK_SPEED * visits + outputTrip;
        if (crop !== undefined && ownedFields > 0)
          sourceWait += trip / WORKER_WALK_SPEED / ownedFieldBatch;
        notes.push("saved owned crop/pile geometry; bounded terrain detours from worker approach");
      }
    }
    // Well pickup and putdown each use settlement-stock-transfers' one-second animation. These
    // phases walk/handle at normal speed; only work and rest use the production timing scale.
    let handlingUnits = WARE_TRANSFER_SECONDS * (inputUnits + outputUnits);
    if (building.typeId === 35) handlingUnits = 2 * WARE_TRANSFER_SECONDS;
    if (building.typeId === 36) handlingUnits = WARE_TRANSFER_SECONDS;
    if (isMineType(building.typeId)) handlingUnits = WARE_TRANSFER_SECONDS * outputUnits;
    if (boatTrip) handlingUnits = WARE_TRANSFER_SECONDS;
    // Stock hand-offs and rest are in-place worker phases: the same level/talent cycle rate and
    // material time scale advance them as the work timer.
    const handling = effectiveProductionSeconds(handlingUnits, building.typeId, selected[0]) / factor;
    const restSeconds = effectiveProductionSeconds(WORKER_REST_SECONDS * visits,
      building.typeId, selected[0]) / factor;
    const serviceSeconds = workSeconds + workerTravelSeconds + restSeconds + handling;
    // Independent field sites grow concurrently while the worker visits the other sites. With
    // owned crop plots the harvest service time already exceeds one plot's amortized growth
    // interval, so adding both would count the same clock twice.
    const concurrentFieldGrowth = building.typeId === 5 || (crop !== undefined && ownedFields > 0);
    const cycleSeconds = Math.max(concurrentFieldGrowth
      ? Math.max(serviceSeconds, sourceWait) : serviceSeconds + sourceWait, 1);
    if (persistentCrop) notes.push("persistent plantation harvests regrow without a repeated planting visit");
    const inputDeliveryTicks = Object.fromEntries(Object.keys(inputTargets(building, rule, inputs)).map(ware => {
      // An empty nearby depot cannot shorten the first delivery from a stocked warehouse.
      // This is still a static origin estimate: later producer-to-workshop deliveries need
      // explicit source ownership rather than pretending every depot always holds every ware.
      const stocked = connectedStorages.filter(storage => (storage.inventory[ware] ?? 0) > 0)
        .map(storage => ({ storage, metrics: route(storage.access, building.access) }))
        .filter(entry => entry.metrics.route)
        .sort((a, b) => a.metrics.route!.cost - b.metrics.route!.cost || a.storage.uid - b.storage.uid);
      // An empty nearer warehouse is not a source. When no connected depot holds the ware, use
      // the island's home/anchor estimate rather than silently switching to a closer empty one.
      const source = stocked[0] ?? reachable.find(entry => entry.storage.uid === anchor?.uid) ?? reachable[0]!;
      const storage = source.storage;
      const sourceLeg = distance(storage.doorThreshold, storage.workerApproach) + distance(storage.workerApproach, storage.access);
      const destinationLeg = distance(building.access, stockPoint(building, "input", ware, 0, nation));
      return [ware, Math.ceil((source.metrics.route!.cost / speed + (sourceLeg + destinationLeg) / speed +
        2 * WARE_TRANSFER_SECONDS) * OFFLINE_ECONOMY_TICKS_PER_SECOND)];
    }));
    if (building.typeId === 35) notes.push("authored windlass/pickup/shelf local trip; carrier work budgeted separately");
    if (rule.outdoor && !ownedFieldGeometry && !boatTrip) notes.push("maximum resource-radius round trip per visit");
    const jobUid = `building:${building.uid}`;
    let outputSequence: Goods[] | undefined;
    if (sequenced) {
      const simulated = structuredClone(building);
      // The preserved actor owns its paid order until normal completion. Exclude that order from
      // new work without crediting a second copy of the receipt still held by the saved worker.
      if (building.typeId === 24) {
        const paid = settlement.actors.find(actor => actor.building === building.uid &&
          actor.productionSeconds !== undefined && actor.productionOutput !== undefined);
        if (paid?.productionOutput && selected.includes(paid.productionOutput)) {
          completeArmoryOrder(simulated, paid.productionOutput);
        }
      }
      outputSequence = [];
      // Without explicit orders the live Armory is input-limited over a long absence. The event
      // model has no such saturation, so bound its automatic peacetime kit to two per weapon;
      // explicit orders keep their exact sequence.
      const automaticArmory = simulated.typeId === 24 && simulated.productionOrders === undefined;
      const automaticSlaughterhouse = simulated.typeId === 21 && simulated.productionOrders === undefined;
      const count = automaticArmory ? 8 :
        Math.min(automaticSlaughterhouse ? 12 : 20_000, Math.ceil(86_400 / cycleSeconds));
      for (let index = 0; index < count; index++) {
        const ware = simulated.typeId === 24 ? nextArmoryOutput(simulated) : mixedCycleOutput(simulated, selected);
        if (ware === undefined) break;
        outputSequence.push({ [ware]: 1 });
        if (simulated.typeId === 24) completeArmoryOrder(simulated, ware);
        else simulated.cycle++;
      }
    }
    const targets = inputTargets(building, rule, inputs);
    jobs.push({ uid: jobUid, islandId: "home", cycleTicks: Math.ceil(cycleSeconds * OFFLINE_ECONOMY_TICKS_PER_SECOND),
      // Staple bread/beer outrank animal feed when grain and water are shared; the live
      // economy gives the pig farm only the remainder.
      priority: building.typeId === 28 || building.typeId === 23 ? .8 : 1,
      inputs, outputs, ...(outputSequence === undefined ? {} : { outputSequence }),
      ...(firstTick ? { firstTick } : {}),
      ...(building.typeId === 61 ? { privateRefundBuilding: building.uid } : {}),
      inputTargets: targets, inputDeliveryTicks,
      ...(rule.alternativeFood ? { alternativeFoods: [...rule.inputs], foodUnits: batch } : {}) });
    buildings.push({ uid: building.uid, jobUid, cycleSeconds, workSeconds, workerTravelSeconds, carrierSeconds,
      ...(notes.length ? { reason: notes.join("; ") } : {}) });
  }
  const demand = buildings.reduce((sum, building) => sum + building.carrierSeconds / building.cycleSeconds, 0);
  const globalThrottle = Math.max(1, demand / Math.max(1, equivalentCarriers));
  // The adapter charges carrier work to runnable jobs. Applying this hypothetical full-demand
  // throttle to every recipe here would penalize even chains whose inputs have already run out.
  return { storageUids: connectedStorages.map(storage => storage.uid), jobs, buildings, unsupported, routes: { calls, hits, misses, entries: routeMemo.size,
    carrierCapacity, equivalentCarriers, globalThrottle,
    assumption: "cached free-flow carrier work budget; worker cycles overlap deliveries; maximum-radius outdoor trips; no contention calibration" } };
};
