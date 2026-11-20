import { CARRIER_WALK_SPEED, HANDCART_LOGISTICS } from "../../shared/balance/economy";
import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { storeHandcart } from "../../shared/settlement/settlement-handcart-ledger";
import { releaseNextDelivery } from "../../shared/settlement/settlement-land-transport-claims";
import type { Goods, SettlementActor, SettlementBuilding, SettlementContext, SettlementPoint } from "../../shared/settlement/settlement-types";
import { markWorkerMovement, releaseWorkerHandling } from "../../shared/settlement/settlement-worker-movement-plan";
import { routeLength } from "../../shared/settlement/ship-cargo-handling";
import type { WorldData } from "../../shared/world/world-data";
import type { OfflineEconomyEventsResult, OfflineEconomyIsland, OfflineEconomyJob } from "./offline-economy-events";
import { OFFLINE_ECONOMY_TICKS_PER_SECOND as TPS } from "./offline-economy-rates";
import { settleOfflineStorageTraffic } from "./offline-economy-storage-traffic";
import { DMath } from "../../shared/math/deterministic-math";

type Ledger = OfflineEconomyEventsResult["islands"][number];
type Buffer = OfflineEconomyEventsResult["buffers"][number] & { deliveredStock?: Goods };
interface CartClaim {
  actor: SettlementActor; source: SettlementBuilding; destination: SettlementBuilding;
  home: SettlementBuilding; ware: string; units: number; sourceHeld: number;
  bufferUid?: string; snapshot: string; uid: string;
}
const own = (goods: Readonly<Goods>, ware: string) => Object.hasOwn(goods, ware) ? goods[ware]! : 0;
const distance = (from: SettlementPoint, to: SettlementPoint) => DMath.hypot(to.x - from.x, to.z - from.z);
const incomingClaims = (actors: readonly SettlementActor[], destination: number, ware: string) =>
  actors.reduce((sum, actor) => {
    const trip = actor.handcart?.trip;
    if (trip?.destination === destination && trip.ware === ware) sum += trip.planned - trip.delivered;
    return sum;
  }, 0);
const snapshot = (actor: SettlementActor) => JSON.stringify(actor);
const supportedPhase = (phase: string) =>
  ["cartToSource", "cartLoading", "cartToDestination", "cartUnloading"].includes(phase);

/**
 * Continue an already-owned native handcart receipt through pickup, delivery and return. The
 * cargo is escrowed so the source shelf can be released at the physical pickup, while the whole
 * round trip must still fit the horizon before any ownership changes. Production sources debit
 * only the units still in their yard; units already on the bed are already outside that stock.
 */
export const prepareOfflineEconomyHandcartReceipts = (
  save: GameSaveV1, islandId: string, seconds: number, world: WorldData,
  productionJobs: readonly OfflineEconomyJob[], storageUids: readonly number[],
  outputAccounts: ReadonlyMap<number, string> = new Map()
): { islands: OfflineEconomyIsland[]; jobs: OfflineEconomyJob[];
  apply: (completedCycles: Record<string, number>, ledger: Ledger, buffers: readonly Buffer[]) => void;
  notes: string[] } => {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(Math.floor(seconds * TPS)))
    throw new Error("Invalid offline handcart horizon");
  const state = save.settlement, islands: OfflineEconomyIsland[] = [], jobs: OfflineEconomyJob[] = [];
  const claims: CartClaim[] = [], notes: string[] = [], allowed = new Set(storageUids);
  const roads = createRoadNetwork(world);
  if (!roads.replaceSegments(state.roads)) throw new Error("Invalid offline handcart roads");
  const speed = CARRIER_WALK_SPEED * (1 + talentModifiers(save.player?.talents).carrierSpeed) *
    HANDCART_LOGISTICS.speedFactor;
  const horizon = Math.floor(seconds * TPS);
  for (const actor of state.actors) {
    const cart = actor.handcart, trip = cart?.trip;
    if (!cart || !trip || actor.job !== "Carrier" || actor.mounted ||
      actor.demolitionReturning || actor.navigationReturnCargo || !supportedPhase(actor.phase)) continue;
    const units = trip.planned - trip.delivered;
    const loaded = trip.loaded - trip.delivered;
    const sourceHeld = trip.planned - trip.loaded - trip.prepaid;
    if (![trip.planned, trip.loaded, trip.prepaid, trip.delivered, units, loaded, sourceHeld].every(amount =>
      Number.isSafeInteger(amount) && amount >= 0) || units <= 0 || cart.cargo !== loaded) {
      notes.push(`Carrier ${actor.uid}: ambiguous handcart cargo retained for native continuation.`); continue;
    }
    const source = state.buildings.find(building => building.uid === trip.source);
    const destination = trip.destination === undefined ? undefined :
      state.buildings.find(building => building.uid === trip.destination);
    const home = state.buildings.find(building => building.uid === cart.owner && allowed.has(building.uid));
    if (!source || !destination || !home || source.construction !== 1 || destination.construction !== 1 ||
      home.construction !== 1 || source.militaryFaction || destination.militaryFaction || home.militaryFaction ||
      !STORAGE_IDS.has(home.typeId)) {
      notes.push(`Carrier ${actor.uid}: handcart source/destination/home is unavailable; receipt retained.`); continue;
    }
    const ware = trip.ware, storageSource = STORAGE_IDS.has(source.typeId);
    const storageDestination = STORAGE_IDS.has(destination.typeId) && allowed.has(destination.uid);
    const recipe = productionJobs.find(job => job.uid === `building:${destination.uid}` &&
      (own(job.inputs, ware) > 0 || job.alternativeFoods?.includes(ware)));
    if ((!storageSource && trip.prepaid !== 0) || (storageSource && trip.prepaid !== trip.planned - trip.loaded) ||
      sourceHeld > own(source.output, ware) || (!storageDestination && !recipe)) {
      notes.push(`Carrier ${actor.uid}: handcart ownership is unresolved; receipt retained.`); continue;
    }
    if ((actor.phase === "cartToDestination" || actor.phase === "cartUnloading") && sourceHeld !== 0) {
      notes.push(`Carrier ${actor.uid}: loaded handcart still owns source output; receipt retained.`); continue;
    }
    const incoming = incomingClaims(state.actors, destination.uid, ware);
    if (incoming < units || incoming > own(destination.incoming, ware)) {
      notes.push(`Carrier ${actor.uid}: handcart incoming promise is unresolved; receipt retained.`); continue;
    }
    const outward = roads.routeMetrics(source.access, destination.access).route;
    const homeward = roads.routeMetrics(destination.access, home.access).route;
    if (!outward || !homeward) {
      notes.push(`Carrier ${actor.uid}: handcart stone route is unavailable; receipt retained.`); continue;
    }
    const remaining = routeLength([actor, ...actor.path.slice(actor.pathIndex)]);
    const endpoint = actor.path.at(-1) ?? actor;
    let pickupSeconds = 0, outboundSeconds = 0;
    if (actor.phase === "cartToSource" || actor.phase === "cartLoading") {
      pickupSeconds = (remaining + distance(endpoint, source.access)) / speed +
        (storageSource ? 0 : sourceHeld * HANDCART_LOGISTICS.itemSeconds);
      outboundSeconds = outward.cost / speed +
        (storageDestination ? 0 : units * HANDCART_LOGISTICS.itemSeconds);
    } else if (actor.phase === "cartToDestination") {
      outboundSeconds = (remaining + distance(endpoint, destination.access)) / speed +
        (storageDestination ? 0 : units * HANDCART_LOGISTICS.itemSeconds);
    } else if (storageDestination) outboundSeconds = 0;
    else outboundSeconds = cart.cargo * HANDCART_LOGISTICS.itemSeconds;
    const homeDoor = distance(home.access, home.workerApproach) + distance(home.workerApproach, home.doorThreshold);
    const arrivalSeconds = pickupSeconds + outboundSeconds;
    const cycleSeconds = arrivalSeconds + homeward.cost / speed + homeDoor / speed;
    const pickupTicks = Math.max(1, Math.ceil(pickupSeconds * TPS));
    const arrivalTicks = Math.max(pickupTicks + 1, Math.ceil(arrivalSeconds * TPS));
    const cycleTicks = Math.max(arrivalTicks + 1, Math.ceil(cycleSeconds * TPS));
    if (![pickupTicks, arrivalTicks, cycleTicks].every(value => Number.isSafeInteger(value)) ||
      cycleTicks > horizon) {
      notes.push(`Carrier ${actor.uid}: full handcart receipt does not fit the cutoff; retained.`); continue;
    }
    const uid = `handcart:${JSON.stringify([islandId, actor.uid])}`, escrowId = `~${uid}`;
    const cargo = { [ware]: units }, bufferUid = recipe && !storageDestination ? `${islandId}:${recipe.uid}` : undefined;
    const outputAccount = outputAccounts.get(source.uid);
    const release = outputAccount && sourceHeld > 0
      ? [{ islandId: outputAccount, units: sourceHeld, at: "pickup" as const }] : undefined;
    islands.push({ islandId: escrowId, stock: cargo });
    jobs.push({ uid, islandId: escrowId, destinationIslandId: islandId, kind: "transfer",
      cycleTicks, sourceReleaseTicks: pickupTicks, endTick: horizon, inputs: cargo, outputs: cargo,
      ...(bufferUid && arrivalTicks < cycleTicks ? { destinationArrivalTicks: arrivalTicks } : {}),
      ...(bufferUid ? { destinationBufferUid: bufferUid } : {}),
      ...(release ? { capacityReleases: release } : {}) });
    claims.push({ actor, source, destination, home, ware, units, sourceHeld,
      bufferUid, snapshot: snapshot(actor), uid });
    notes.push(`Carrier ${actor.uid}: its owned ${ware} cart reaches ${destination.uid} after ` +
      `${Math.ceil(arrivalSeconds)}s and returns after ${Math.ceil(cycleSeconds)}s; ` +
      `${sourceHeld} still-held yard units release their shelf at pickup.`);
  }
  let applied = false;
  return { islands, jobs, notes, apply: (completedCycles, ledger, buffers) => {
    if (applied) throw new Error("Offline handcart receipts already applied");
    if (ledger.islandId !== islandId) throw new Error("Offline handcart destination ledger mismatch");
    const completed = claims.filter(claim => {
      const cycles = own(completedCycles, claim.uid);
      if (cycles !== 0 && cycles !== 1) throw new Error("Offline handcart completed more than once");
      return cycles === 1;
    });
    const credits: Goods = {}, remissions = new Map<number, Goods>();
    for (const claim of completed) {
      if (!state.actors.includes(claim.actor) || snapshot(claim.actor) !== claim.snapshot ||
        !state.buildings.includes(claim.source) || !state.buildings.includes(claim.destination) ||
        !state.buildings.includes(claim.home))
        throw new Error("Offline handcart ownership changed before commit");
      const incoming = incomingClaims(state.actors, claim.destination.uid, claim.ware);
      if (incoming < claim.units || own(claim.destination.incoming, claim.ware) < claim.units)
        throw new Error("Offline handcart incoming promise changed before commit");
      if (claim.sourceHeld > own(claim.source.output, claim.ware))
        throw new Error("Offline handcart source output changed before commit");
      credits[claim.ware] = own(credits, claim.ware) + claim.units;
      if (!claim.bufferUid) continue;
      const goods = remissions.get(claim.destination.uid) ?? {};
      goods[claim.ware] = own(goods, claim.ware) + claim.units;
      remissions.set(claim.destination.uid, goods);
    }
    for (const [ware, units] of Object.entries(credits))
      if (own(ledger.received, ware) < units) throw new Error("Offline handcart missing destination credit");
    const leftovers = new Map<number, Goods>();
    for (const buffer of buffers) if (buffer.islandId === islandId && buffer.deliveredStock) {
      const claim = completed.find(claim => claim.bufferUid === buffer.uid);
      if (!claim) continue;
      const destination = claim.destination, goods = leftovers.get(destination.uid) ?? {};
      for (const [ware, units] of Object.entries(buffer.deliveredStock)) {
        if (!Number.isSafeInteger(units) || units < 0 || units > own(remissions.get(destination.uid) ?? {}, ware) ||
          own(goods, ware) > 0) throw new Error("Offline handcart private buffer balance invalid");
        goods[ware] = units;
      }
      leftovers.set(destination.uid, goods);
    }
    applied = true;
    const context = { actors: state.actors, buildings: state.buildings } as SettlementContext;
    for (const claim of completed) {
      claim.source.output[claim.ware] = own(claim.source.output, claim.ware) - claim.sourceHeld;
      claim.destination.incoming[claim.ware] = own(claim.destination.incoming, claim.ware) - claim.units;
      const actor = claim.actor;
      releaseNextDelivery(context, actor);
      storeHandcart(context, actor, claim.home);
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
    for (const [uid, goods] of leftovers) {
      const destination = state.buildings.find(building => building.uid === uid)!;
      for (const [ware, units] of Object.entries(goods))
        destination.input[ware] = own(destination.input, ware) + units;
    }
    for (const [ware, units] of Object.entries(credits)) ledger.received[ware] = own(ledger.received, ware) - units;
  } };
};
