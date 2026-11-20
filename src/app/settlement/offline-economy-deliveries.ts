import { getBuildingStockContact } from "../../render-common/buildings/building-stock-anchors";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import type { WorkerNation } from "../../render-common/workers/worker-nation";
import { CARRIER_WALK_SPEED, PRODUCTION_OUTPUT_CAPACITY } from "../../shared/balance/economy";
import { DMath } from "../../shared/math/deterministic-math";
import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { releaseDeliveryClaim } from "../../shared/settlement/settlement-carrier-claims";
import { releaseNextDelivery } from "../../shared/settlement/settlement-land-transport-claims";
import type { Goods, SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "../../shared/settlement/settlement-types";
import { markWorkerMovement, releaseWorkerHandling } from "../../shared/settlement/settlement-worker-movement-plan";
import { routeLength } from "../../shared/settlement/ship-cargo-handling";
import type { WorldData } from "../../shared/world/world-data";
import type { OfflineEconomyEventsResult, OfflineEconomyIsland, OfflineEconomyJob } from "./offline-economy-events";
import { OFFLINE_ECONOMY_TICKS_PER_SECOND as TPS } from "./offline-economy-rates";
import { settleOfflineStorageTraffic } from "./offline-economy-storage-traffic";

type Ledger = OfflineEconomyEventsResult["islands"][number];
type Buffer = OfflineEconomyEventsResult["buffers"][number] & { deliveredStock?: Goods };
interface Claim {
  actor: SettlementActor; source: SettlementBuilding; destination: SettlementBuilding; home: SettlementBuilding;
  ware: string; pickup: boolean; snapshot: string; uid: string; bufferUid?: string;
}
const own = (goods: Readonly<Goods>, ware: string) => Object.hasOwn(goods, ware) ? goods[ware]! : 0;
const distance = (from: SettlementPoint, to: SettlementPoint) => DMath.hypot(to.x - from.x, to.z - from.z);
const PICKUP = new Set(["pickup", "enterPickup", "pickupStockWalk", "carrierPickupBlocked"]);
const LOADED = new Set(["pickupTransfer", "exitLoaded", "deliver", "enterDelivery", "deliveryStockWalk",
  "deliveryTransfer", "carrierLoadedParking", "carrierLoadedBlocked", "carrierDeliveryBlocked"]);
const snapshot = (actor: SettlementActor) => JSON.stringify(actor);
const inputKey = (building: number, ware: string) => JSON.stringify([building, ware]);

/** Includes unsupported owners: their reserved source output and incoming slots must survive. */
const heldOutput = (actors: readonly SettlementActor[], source: number, ware: string) => actors.reduce((sum, actor) => {
  const delivery = actor.delivery, trip = actor.handcart?.trip;
  if (delivery?.source === source && delivery.ware === ware && delivery.reserved && !delivery.sourceInput) sum++;
  if (trip?.source === source && trip.ware === ware) sum += trip.planned - trip.loaded - trip.prepaid;
  return sum;
}, 0);
const incomingClaims = (actors: readonly SettlementActor[], destination: number, ware: string) => actors.reduce((sum, actor) => {
  if (actor.delivery?.destination === destination && actor.delivery.ware === ware) sum += actor.wareUnits ?? 1;
  const trip = actor.handcart?.trip;
  if (trip?.destination === destination && trip.ware === ware) sum += trip.planned - trip.delivered;
  return sum;
}, 0);
const stockLeg = (building: SettlementBuilding, ware: string, kind: "input" | "output",
  nation: WorkerNation | undefined) => {
  let longest = 0;
  for (let slot = 0; slot < PRODUCTION_OUTPUT_CAPACITY; slot++) {
    const contact = getBuildingStockContact(building.typeId, kind, ware, slot, building.x, building.z,
      building.rotation, building.y, kind === "input" ? building.input : building.output,
      kind === "input" ? building.output : building.input, stockStyleFor(nation, building));
    if (contact) longest = Math.max(longest, distance(building.access,
      { x: contact.approach[0], z: contact.approach[2] }));
  }
  return longest;
};

/**
 * Continue already-owned cartless receipts once. Cargo reaches only its promised workshop's
 * private input buffer at dropoff. Completion still includes the courier's return/entry, allowing
 * native inside continuation without a frozen cargo, lease, handling plan or doorway reservation.
 */
export const prepareOfflineEconomyDeliveries = (
  save: GameSaveV1, islandId: string, seconds: number, world: WorldData,
  productionJobs: readonly OfflineEconomyJob[], storageUids: readonly number[],
  outputAccounts: ReadonlyMap<number, string> = new Map()
): { islands: OfflineEconomyIsland[]; jobs: OfflineEconomyJob[];
  apply: (completedCycles: Record<string, number>, ledger: Ledger, buffers: readonly Buffer[]) => void; notes: string[] } => {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(Math.floor(seconds * TPS)))
    throw new Error("Invalid offline delivery horizon");
  const state = save.settlement, islands: OfflineEconomyIsland[] = [], jobs: OfflineEconomyJob[] = [], notes: string[] = [];
  const claims: Claim[] = [], allowed = new Set(storageUids), roads = createRoadNetwork(world);
  if (!roads.replaceSegments(state.roads)) throw new Error("Invalid offline delivery roads");
  const normalSpeed = CARRIER_WALK_SPEED * (1 + talentModifiers(save.player?.talents).carrierSpeed);
  for (const actor of state.actors) {
    const delivery = actor.delivery;
    if (!delivery || actor.job !== "Carrier" || actor.handcart || actor.mounted ||
      actor.navalOrder !== undefined ||
      actor.demolitionReturning || actor.navigationReturnCargo || delivery.upgrade ||
      delivery.sourceInput || (actor.wareUnits ?? 1) !== 1 ||
      Object.values(actor.consumed ?? {}).some(units => units > 0)) continue;
    if (!PICKUP.has(actor.phase) && !LOADED.has(actor.phase)) continue;
    const pickup = actor.ware === null || actor.ware === undefined;
    if (pickup !== PICKUP.has(actor.phase) || (!pickup && (actor.ware !== delivery.ware || delivery.reserved)) ||
      (delivery.leaseDeadlineTick !== undefined && delivery.leaseDeadlineTick <= (state.gameTick ?? 0))) {
      notes.push(`Carrier ${actor.uid}: ambiguous/expired receipt retained for native continuation.`); continue;
    }
    const source = state.buildings.find(building => building.uid === delivery.source);
    const destination = state.buildings.find(building => building.uid === delivery.destination);
    const home = state.buildings.find(building => building.uid === actor.home && allowed.has(building.uid));
    const recipe = productionJobs.find(job => job.uid === `building:${delivery.destination}` &&
      (own(job.inputs, delivery.ware) > 0 || job.alternativeFoods?.includes(delivery.ware)));
    const storageDestination = destination && allowed.has(destination.uid) && STORAGE_IDS.has(destination.typeId);
    if (!source || !destination || !home || (!recipe && !storageDestination) ||
      source.construction !== 1 || destination.construction !== 1 ||
      home.construction !== 1 || source.militaryFaction || destination.militaryFaction || home.militaryFaction ||
      !STORAGE_IDS.has(home.typeId)) continue;
    const ware = delivery.ware, storageSource = STORAGE_IDS.has(source.typeId);
    const reserved = heldOutput(state.actors, source.uid, ware), incoming = incomingClaims(state.actors, destination.uid, ware);
    if ((pickup && (storageSource ? !!delivery.reserved : !delivery.reserved)) ||
      !Number.isSafeInteger(reserved) || reserved < 0 || (!storageSource && reserved > own(source.output, ware)) ||
      !Number.isSafeInteger(incoming) || incoming < 1 || incoming > own(destination.incoming, ware)) {
      notes.push(`Carrier ${actor.uid}: source/incoming ownership is unresolved; receipt retained.`); continue;
    }
    const outward = roads.routeMetrics(source.access, destination.access).route;
    const homeward = roads.routeMetrics(destination.access, home.access).route;
    if (!outward || !homeward) { notes.push(`Carrier ${actor.uid}: road route unavailable; receipt retained.`); continue; }
    const speed = Math.min(normalSpeed, actor.locomotionSpeed && actor.locomotionSpeed > 0 ? actor.locomotionSpeed : normalSpeed);
    const remaining = routeLength([actor, ...actor.path.slice(actor.pathIndex)]);
    const endpoint = actor.path.at(-1) ?? actor;
    let travel = remaining + distance(endpoint, pickup ? source.access : destination.access);
    if (pickup) travel += outward.cost + 2 * stockLeg(source, ware, "output", state.playerNation);
    else if (["pickupTransfer", "carrierLoadedParking", "carrierLoadedBlocked"].includes(actor.phase))
      travel = Math.max(travel, distance(actor, source.access) + outward.cost);
    else if (["deliver", "exitLoaded"].includes(actor.phase) && distance(endpoint, destination.access) > 1.5)
      travel = Math.max(travel, outward.cost);
    const localDelivery = storageDestination ? distance(destination.access, destination.workerApproach) +
      distance(destination.workerApproach, destination.doorThreshold) : 2 * stockLeg(destination, ware, "input", state.playerNation);
    const homeDoor = distance(home.access, home.workerApproach) + distance(home.workerApproach, home.doorThreshold);
    const handling = actor.wareTransfer ? 1 - actor.wareTransfer.progress : 1;
    const arrival = (travel + localDelivery) / speed + handling + Number(pickup);
    const delay = arrival + (homeward.cost + homeDoor) / speed;
    const cycleTicks = Math.max(1, Math.ceil(delay * TPS));
    if (!Number.isSafeInteger(cycleTicks)) continue;
    const uid = `delivery:${JSON.stringify([islandId, actor.uid])}`, escrowId = `~${uid}`;
    const bufferUid = recipe && !storageDestination ? `${islandId}:${recipe.uid}` : undefined;
    const arrivalTicks = Math.max(1, Math.ceil(arrival * TPS));
    const cargo = { [ware]: 1 }, outputAccount = outputAccounts.get(source.uid);
    islands.push({ islandId: escrowId, stock: cargo });
    jobs.push({ uid, islandId: escrowId, destinationIslandId: islandId, destinationBufferUid: bufferUid,
      kind: "transfer", cycleTicks, endTick: Math.floor(seconds * TPS), inputs: cargo, outputs: cargo,
      ...(bufferUid && arrivalTicks < cycleTicks ? { destinationArrivalTicks: arrivalTicks } : {}),
      ...(pickup && delivery.reserved && outputAccount ?
        { capacityReleases: [{ islandId: outputAccount, units: 1 }] } : {}) });
    claims.push({ actor, source, destination, home, ware, pickup, snapshot: snapshot(actor), uid, bufferUid });
    notes.push(`Carrier ${actor.uid}: its owned ${ware} reaches ${destination.uid} after ${Math.ceil(arrival)}s; ` +
      `its full return completes after ${Math.ceil(delay)}s. Private inputs never enter free warehouse stock; ` +
      "the whole receipt must fit the cutoff before early dropoff is enabled.");
  }
  let applied = false;
  return { islands, jobs, notes, apply: (completedCycles, ledger, buffers) => {
    if (applied) throw new Error("Offline deliveries already applied");
    if (ledger.islandId !== islandId) throw new Error("Offline delivery destination ledger mismatch");
    const completed = claims.filter(claim => {
      const cycles = own(completedCycles, claim.uid);
      if (cycles !== 0 && cycles !== 1) throw new Error("Offline delivery completed more than once");
      return cycles === 1;
    });
    const credits: Goods = {}, remaining = new Map<string, { destination: SettlementBuilding; ware: string; units: number }>();
    const debits = new Map<string, { source: SettlementBuilding; ware: string; units: number }>();
    for (const claim of completed) {
      if (!state.actors.includes(claim.actor) || snapshot(claim.actor) !== claim.snapshot ||
        !state.buildings.includes(claim.source) || !state.buildings.includes(claim.destination) || !state.buildings.includes(claim.home))
        throw new Error("Offline delivery ownership changed before commit");
      credits[claim.ware] = own(credits, claim.ware) + 1;
      const key = inputKey(claim.destination.uid, claim.ware), item = remaining.get(key) ??
        { destination: claim.destination, ware: claim.ware, units: 0 };
      item.units++; remaining.set(key, item);
      if (claim.pickup && claim.actor.delivery!.reserved) {
        const sourceKey = inputKey(claim.source.uid, claim.ware), debit = debits.get(sourceKey) ??
          { source: claim.source, ware: claim.ware, units: 0 };
        debit.units++; debits.set(sourceKey, debit);
      }
    }
    for (const { source, units, ware } of debits.values())
      if (own(source.output, ware) < units || heldOutput(state.actors, source.uid, ware) > own(source.output, ware))
        throw new Error("Offline delivery source output changed before commit");
    for (const [ware, units] of Object.entries(credits))
      if (own(ledger.received, ware) < units) throw new Error("Offline delivery missing private destination credit");
    const leftovers = new Map<string, number>();
    for (const buffer of buffers) if (buffer.islandId === islandId && buffer.deliveredStock) {
      const destination = completed.find(claim => claim.bufferUid === buffer.uid)?.destination;
      if (!destination) {
        if (Object.values(buffer.deliveredStock).some(units => units > 0))
          throw new Error("Offline delivery private buffer owner unavailable");
        continue;
      }
      for (const [ware, units] of Object.entries(buffer.deliveredStock)) {
        const key = inputKey(destination.uid, ware), available = remaining.get(key)?.units ?? 0;
        if (!Number.isSafeInteger(units) || units < 0 || units > available || leftovers.has(key))
          throw new Error("Offline delivery private buffer balance invalid");
        leftovers.set(key, units);
      }
    }
    for (const { destination, units, ware } of remaining.values())
      if (own(destination.incoming, ware) < units || incomingClaims(state.actors, destination.uid, ware) > own(destination.incoming, ware))
        throw new Error("Offline delivery incoming claim changed before commit");
    applied = true;
    for (const { source, units, ware } of debits.values()) source.output[ware] = own(source.output, ware) - units;
    const context = { buildings: state.buildings } as SettlementContext;
    for (const claim of completed) {
      const actor = claim.actor;
      // Native claim release sees already-gripped cargo, so dispatch-prepaid storage is never refunded.
      actor.ware = claim.ware; actor.delivery!.reserved = false;
      releaseNextDelivery(context, actor);
      releaseDeliveryClaim(context, actor);
      actor.ware = null; actor.wareUnits = undefined; actor.wareScale = undefined;
      actor.navigationReturnCargo = undefined; actor.navigationRecovery = undefined;
      actor.stockBuilding = undefined; actor.stockContact = undefined;
      actor.storageArrivalBuilding = undefined; actor.storageArrivalOrder = undefined;
      actor.queueTarget = undefined; actor.queueKind = undefined; actor.queueWait = 0;
      releaseWorkerHandling(actor); actor.workerHandlingPlan = undefined;
      markWorkerMovement(actor, "arrived", claim.home.doorThreshold);
      actor.path = []; actor.pathIndex = 0; actor.timer = 0;
      actor.x = claim.home.doorThreshold.x; actor.z = claim.home.doorThreshold.z; actor.y = claim.home.y;
      actor.phase = "inside"; actor.visible = false; actor.action = "idle";
      settleOfflineStorageTraffic(state, actor);
      claim.destination.door = 1;
    }
    if (state.corridorReservations) {
      const owners = new Set(completed.map(claim => claim.actor.uid));
      state.corridorReservations = state.corridorReservations.filter(([uid]) => !owners.has(uid));
    }
    for (const [key, units] of leftovers) {
      const item = remaining.get(key)!;
      item.destination.input[item.ware] = own(item.destination.input, item.ware) + units;
    }
    for (const [ware, units] of Object.entries(credits)) ledger.received[ware] = own(ledger.received, ware) - units;
  } };
};
