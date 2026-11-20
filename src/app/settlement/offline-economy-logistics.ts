import { getBuildingStockContact } from "../../render-common/buildings/building-stock-anchors";
import { stockStyleFor } from "../../render-common/buildings/building-stock-layout";
import { CARRIER_WALK_SPEED, PRODUCTION_OUTPUT_CAPACITY } from "../../shared/balance/economy";
import { DMath } from "../../shared/math/deterministic-math";
import { talentModifiers } from "../../shared/progression/talents";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { STORAGE_IDS } from "../../shared/settlement/production-rules";
import { createRoadNetwork } from "../../shared/settlement/road-network";
import { savedOccupancy } from "../../shared/settlement/save-cell-codecs";
import { isBoatFishing } from "../../shared/settlement/settlement-fisher-boat-mode";
import { groundPath } from "../../shared/settlement/settlement-paths";
import { productionInputStock } from "../../shared/settlement/settlement-sawmill-handcarts";
import type { Goods, SettlementBuilding, SettlementContext, SettlementPoint } from "../../shared/settlement/settlement-types";
import type { WorldData } from "../../shared/world/world-data";
import { offlineBoatFisheryShelf } from "./offline-boat-fishing";
import type { OfflineEconomyEventsResult, OfflineEconomyIsland, OfflineEconomyJob } from "./offline-economy-events";
import { OFFLINE_ECONOMY_TICKS_PER_SECOND as TPS } from "./offline-economy-rates";

interface OutputAccount {
  building: SettlementBuilding; job: OfflineEconomyJob; id: string; initial: Goods; held: Goods;
  snapshot: string; ownership: string; capacity: number; wares: Set<string>;
}
const own = (goods: Readonly<Goods>, ware: string) => Object.hasOwn(goods, ware) ? goods[ware]! : 0;
const distance = (from: SettlementPoint, to: SettlementPoint) => DMath.hypot(to.x - from.x, to.z - from.z);
const total = (goods: Readonly<Goods>) => Object.values(goods).reduce((sum, amount) => sum + amount, 0);
const valid = (goods: Readonly<Goods>) => Object.values(goods).every(amount => Number.isSafeInteger(amount) && amount >= 0);
const physical = (goods: Readonly<Goods>) => Object.fromEntries(Object.entries(goods).filter(([ware]) => !ware.startsWith("~")));

/** Metadata and writeback for finite producer yards and actual source-to-consumer courier routes. */
export const prepareOfflineEconomyLogistics = (
  save: GameSaveV1, islandId: string, seconds: number, world: WorldData,
  productionJobs: OfflineEconomyJob[], storageUids: readonly number[]
): { islands: OfflineEconomyIsland[]; jobs: OfflineEconomyJob[]; coveredOutputUids: number[];
  outputAccounts: ReadonlyMap<number, string>;
  notes: string[]; apply: (result: OfflineEconomyEventsResult) => void } => {
  if (!Number.isFinite(seconds) || seconds < 0 || !Number.isSafeInteger(Math.floor(seconds * TPS)))
    throw new Error("Invalid offline logistics horizon");
  const state = save.settlement, allowed = new Set(storageUids), accounts: OutputAccount[] = [];
  const islands: OfflineEconomyIsland[] = [], jobs: OfflineEconomyJob[] = [], notes: string[] = [];
  const roads = createRoadNetwork(world);
  if (!roads.replaceSegments(state.roads)) throw new Error("Invalid offline logistics roads");
  const storages = state.buildings.filter(building => allowed.has(building.uid) && building.construction === 1 &&
    !building.militaryFaction && STORAGE_IDS.has(building.typeId));
  const speed = CARRIER_WALK_SPEED * (1 + talentModifiers(save.player?.talents).carrierSpeed);
  const routeMemo = new Map<string, ReturnType<typeof roads.routeMetrics>>();
  const route = (from: SettlementBuilding, to: SettlementBuilding) => {
    const key = `${from.uid}:${to.uid}`;
    let metrics = routeMemo.get(key);
    if (!metrics) { metrics = roads.routeMetrics(from.access, to.access); routeMemo.set(key, metrics); }
    return metrics.route;
  };
  const navigation = { options: { world, roads }, buildings: state.buildings, actors: [],
    playerNation: state.playerNation,
    occupied: savedOccupancy(state).slice(), reservations: new Set(state.reservations)
  } as unknown as SettlementContext;
  const localMemo = new Map<string, number>();
  const door = (building: SettlementBuilding) => distance(building.access, building.workerApproach) +
    distance(building.workerApproach, building.doorThreshold);
  const stockLeg = (building: SettlementBuilding, ware: string, kind: "input" | "output") => {
    const key = `${building.uid}:${kind}:${ware}`, cached = localMemo.get(key);
    if (cached !== undefined) return cached;
    let point = building.access, longest = 0;
    const slots = kind === "input" ? productionInputStock(building, ware) : PRODUCTION_OUTPUT_CAPACITY;
    for (let slot = 0; slot < slots; slot++) {
      const contact = getBuildingStockContact(building.typeId, kind, ware, slot, building.x, building.z,
        building.rotation, building.y, kind === "input" ? building.input : building.output,
        kind === "input" ? building.output : building.input, stockStyleFor(state.playerNation, building));
      const candidate = contact ? { x: contact.approach[0], z: contact.approach[2] } : building.access;
      const length = distance(building.access, candidate);
      if (length > longest) { longest = length; point = candidate; }
    }
    const path = groundPath(navigation, building.access, point, building.uid);
    if (path) {
      let previous = building.access, length = 0;
      for (const next of path) { length += distance(previous, next); previous = next; }
      longest = Math.max(longest, length);
    } else notes.push(`Building ${building.uid} ${kind} ${ware}: authored yard leg retained where static navigation is unresolved.`);
    localMemo.set(key, longest); return longest;
  };
  const ownership = (building: SettlementBuilding) => {
    const held: Goods = {}, owners: unknown[] = [];
    let valid = true;
    for (const actor of state.actors) {
      const delivery = actor.delivery, trip = actor.handcart?.trip;
      if (delivery?.source === building.uid && delivery.reserved && !delivery.sourceInput) {
        held[delivery.ware] = own(held, delivery.ware) + 1;
        owners.push(["delivery", actor.uid, delivery.ware, delivery.reserved]);
      }
      if (trip?.source === building.uid) {
        const left = trip.planned - trip.loaded - trip.prepaid;
        if (![trip.planned, trip.loaded, trip.prepaid, left].every(amount => Number.isSafeInteger(amount) && amount >= 0)) valid = false;
        held[trip.ware] = own(held, trip.ware) + left;
        owners.push(["cart", actor.uid, trip.ware, trip.planned, trip.loaded, trip.prepaid]);
      }
    }
    return { held, valid, snapshot: JSON.stringify(owners) };
  };
  const included = new Set<string>();
  for (const job of productionJobs) {
    const building = state.buildings.find(building => job.uid === `building:${building.uid}`);
    if (!building || job.kind === "transfer" || building.typeId === 36 || STORAGE_IDS.has(building.typeId)) continue;
    const allOutputs = [job.outputs, ...job.outputSequence ?? []];
    const boatFishery = isBoatFishing(building);
    const grouped = !boatFishery && allOutputs.some(output => total(physical(output)) > 1);
    if (grouped) {
      notes.push(`Building ${building.uid}: grouped output retains aggregate transport; yard phases are not invented.`);
      continue;
    }
    const reserved = ownership(building), initial: Goods = {};
    if (!valid(building.output) || !reserved.valid || Object.entries(reserved.held)
      .some(([ware, amount]) => amount > own(building.output, ware))) {
      notes.push(`Building ${building.uid}: ambiguous output ownership retained.`); continue;
    }
    for (const [ware, amount] of Object.entries(building.output)) initial[ware] = amount - own(reserved.held, ware);
    const wares = new Set([...Object.keys(initial), ...allOutputs.flatMap(output => Object.keys(physical(output)))]);
    const worker = state.actors.find(actor => actor.uid === building.worker);
    const paid = worker && ((worker.ware !== null && worker.ware !== undefined && wares.has(worker.ware)) ||
      (worker.productionSeconds !== undefined && ![5, 27, 28, 37, 38, 60].includes(building.typeId) &&
        (worker.productionOutput ? wares.has(worker.productionOutput) : wares.size === 1))) ? 1 : 0;
    const shelf = offlineBoatFisheryShelf(building, worker, total(reserved.held)) ??
      PRODUCTION_OUTPUT_CAPACITY - total(reserved.held) - paid;
    const capacity = Math.max(total(initial), shelf);
    const id = `~producer:${JSON.stringify([islandId, building.uid])}`;
    accounts.push({ building, job, id, initial, held: reserved.held, snapshot: JSON.stringify(building.output),
      ownership: reserved.snapshot, capacity, wares });
    islands.push({ islandId: id, ownerIslandId: islandId, totalCapacity: capacity,
      maxCapacity: capacity + total(reserved.held), stock: { ...initial } });
    job.outputAccountId = id; included.add(job.uid);
  }
  const closestStorage = (building: SettlementBuilding, ware?: string) => storages
    .filter(storage => ware === undefined || storage.accepts[ware] !== false)
    .flatMap(storage => { const path = route(storage, building); return path ? [{ storage, path }] : []; })
    .sort((a, b) => a.path.length - b.path.length || a.path.cost - b.path.cost || a.storage.uid - b.storage.uid)[0];
  const liveCrews = state.actors.filter(actor => actor.job === "Carrier" && actor.phase !== "retired" &&
    !actor.handcart && !actor.mounted && storages.some(storage => storage.uid === actor.home || storage.uid === actor.building));
  // Carrier labor is shared across completed depots in the same road-connected pool. Only saved
  // carriers and idle settlers may join; carts, other workers and their tools remain local.
  const fleetSize = new Map<number, number>();
  const connectedFleet = (source: SettlementBuilding) => {
    const cached = fleetSize.get(source.uid);
    if (cached !== undefined) return cached;
    let size = 0;
    for (const actor of liveCrews) {
      const origin = storages.find(storage => storage.uid === actor.home) ??
        storages.find(storage => storage.uid === actor.building);
      if (origin && (origin.uid === source.uid || route(origin, source))) size++;
    }
    for (const storage of storages)
      if (storage.uid === source.uid || route(storage, source)) size += storage.idleSettlers ?? 0;
    fleetSize.set(source.uid, size);
    return size;
  };
  const crewOrigin = (source: SettlementBuilding) => {
    const existing = (inside: boolean) => liveCrews.filter(actor => (actor.phase === "inside") === inside)
      .map(actor => storages.find(storage => storage.uid === actor.home))
      .flatMap(storage => { const path = storage && route(storage, source); return storage && path ? [{ storage, path }] : []; })[0];
    const ready = existing(true);
    if (ready) return ready;
    const staffed = storages.filter(storage => (storage.idleSettlers ?? 0) > 0)
      .flatMap(storage => { const path = route(storage, source); return path ? [{ storage, path }] : []; })
      .sort((a, b) => a.path.length - b.path.length || a.path.cost - b.path.cost || a.storage.uid - b.storage.uid)[0];
    return staffed ?? existing(false);
  };
  for (const account of accounts) for (const ware of account.wares) {
    const chosen = closestStorage(account.building, ware), depot = crewOrigin(account.building);
    if (!chosen || !depot) continue;
    // A storage receiver adopts the returning courier. Its initial departure still needs a real
    // saved crew home (or an actual idle settler), never an empty nearby warehouse.
    const courierSeconds = (door(depot.storage) + depot.path.cost + 2 * stockLeg(account.building, ware, "output") +
      chosen.path.cost + door(chosen.storage)) / speed + 2;
    const ticks = Math.max(1, Math.ceil(courierSeconds * TPS));
    const pickupSeconds = (door(depot.storage) + depot.path.cost +
      stockLeg(account.building, ware, "output")) / speed + 1;
    const pickupTicks = Math.min(ticks - 1, Math.max(1, Math.ceil(pickupSeconds * TPS)));
    // Loaded couriers no longer occupy the yard. Other real crews may collect the next shelf
    // while earlier cargo is still travelling; all trips still pay the shared fleet work.
    const physicalSlots = account.capacity + total(account.held);
    const concurrentTrips = Math.min(connectedFleet(account.building), Math.ceil(physicalSlots * ticks / pickupTicks));
    for (let crew = 0; crew < concurrentTrips; crew++)
      jobs.push({ uid: `export:${JSON.stringify([islandId, account.building.uid, ware, crew])}`,
        islandId: account.id, destinationIslandId: islandId, kind: "transfer", workOwnerIslandId: islandId,
        cycleTicks: ticks, sourceReleaseTicks: pickupTicks, workTicks: ticks,
        workOverlapsCycle: true, endTick: Math.floor(seconds * TPS),
        inputs: { [ware]: 1 }, outputs: { [ware]: 1 } });
  }
  const consumers = new Map<string, SettlementBuilding>();
  for (const job of productionJobs) {
    const building = state.buildings.find(building => job.uid === `building:${building.uid}`);
    if (!building || (!included.has(job.uid) && building.typeId !== 36)) continue;
    consumers.set(`${islandId}:${job.uid}`, building);
    job.inputSuppliers = {};
    for (const ware of Object.keys(job.inputTargets ?? {})) {
      const suppliers: { accountId: string; routeCost: number; deliveryTicks: number; workTicks: number; uid: number }[] = [];
      const candidates = storages.flatMap(storage => {
        const path = route(storage, building); return path ? [{ storage, path }] : [];
      }).sort((a, b) => a.path.cost - b.path.cost || a.storage.uid - b.storage.uid);
      const stocked = candidates.find(candidate => own(candidate.storage.inventory, ware) > 0) ?? candidates[0];
      const receiverLeg = stockLeg(building, ware, "input");
      if (stocked) {
        const oneWay = (stocked.path.cost + door(stocked.storage) + receiverLeg) / speed;
        suppliers.push({ accountId: islandId, uid: stocked.storage.uid, routeCost: stocked.path.cost,
          deliveryTicks: Math.ceil((oneWay + 2) * TPS), workTicks: Math.ceil((2 * oneWay + 2) * TPS) });
      }
      for (const account of accounts) {
        if (account.building.uid === building.uid || !account.wares.has(ware) ||
          (account.building.typeId === 17 && closestStorage(account.building, ware))) continue;
        const path = route(account.building, building), depot = crewOrigin(account.building);
        const homeward = depot && route(building, depot.storage);
        if (!path || !depot || !homeward) continue;
        const sourceLeg = stockLeg(account.building, ware, "output");
        const outbound = (door(depot.storage) + depot.path.cost + 2 * sourceLeg + path.cost + receiverLeg) / speed + 2;
        const roundTrip = outbound + (receiverLeg + homeward.cost + door(depot.storage)) / speed;
        suppliers.push({ accountId: account.id, uid: account.building.uid, routeCost: path.cost,
          deliveryTicks: Math.ceil(outbound * TPS), workTicks: Math.ceil(roundTrip * TPS) });
      }
      suppliers.sort((a, b) => a.routeCost - b.routeCost || a.uid - b.uid);
      job.inputSuppliers[ware] = suppliers.map(({ accountId, deliveryTicks, routeCost, workTicks }) =>
        ({ accountId, deliveryTicks, routeCost, workTicks }));
    }
  }
  if (accounts.length) notes.push("Single-output yards retain finite ownership and shared six-unit space; native claims and paid output stay outside. " +
    "Suppliers use cached source routes, real yard/door legs and one shared carrier work owner. Warehouse origins remain pooled/static; " +
    "exports may overlap up to actual crew/yard capacity; origins follow ready crews, staffed depots, then saved future-returning crews. " +
    "Carrier labor is shared only across depots with a real road route; carts and other workers stay local. " +
    "Crew relocation after delivery remains approximate. Plain woodcutters export before supplying workshops; grouped output and physical boats retain their native boundary.");
  let applied = false;
  return { islands, jobs, outputAccounts: new Map(accounts.map(account => [account.building.uid, account.id])),
    coveredOutputUids: accounts.map(account => account.building.uid), notes, apply: result => {
    if (applied) throw new Error("Offline logistics already applied");
    const owner = result.islands.find(island => island.islandId === islandId);
    if (!owner) throw new Error("Offline logistics owner ledger unavailable");
    const final = new Map<string, Goods>(), exports: Goods = {}, received: Goods = {};
    for (const account of accounts) {
      const latest = ownership(account.building), ledger = result.islands.find(island => island.islandId === account.id);
      if (!state.buildings.includes(account.building) || JSON.stringify(account.building.output) !== account.snapshot ||
        !latest.valid || latest.snapshot !== account.ownership || !ledger || !valid(ledger.stock) || !valid(ledger.received) ||
        !valid(ledger.sent) || ledger.totalCapacity === undefined || ledger.totalCapacity < account.capacity ||
        ledger.totalCapacity > account.capacity + total(account.held) || total(ledger.stock) > ledger.totalCapacity)
        throw new Error("Offline logistics output ownership changed before commit");
      const wares = new Set([...Object.keys(account.initial), ...Object.keys(ledger.received), ...Object.keys(ledger.sent), ...Object.keys(ledger.stock)]);
      for (const ware of wares) {
        if (!account.wares.has(ware) || own(account.initial, ware) + own(ledger.received, ware) - own(ledger.sent, ware) !== own(ledger.stock, ware))
          throw new Error("Offline logistics producer balance invalid");
        received[ware] = own(received, ware) + own(ledger.received, ware);
      }
      final.set(account.id, { ...ledger.stock });
    }
    for (const [ware, units] of Object.entries(received))
      if (units > own(owner.produced, ware)) throw new Error("Offline logistics producer awards missing");
    for (const job of jobs) {
      const cycles = own(result.completedCycles, job.uid);
      if (!Number.isSafeInteger(cycles) || cycles < 0) throw new Error("Offline logistics invalid export completion");
      for (const [ware, units] of Object.entries(job.outputs)) exports[ware] = own(exports, ware) + cycles * units;
    }
    for (const [ware, units] of Object.entries(exports))
      if (!Number.isSafeInteger(units) || units > own(owner.received, ware)) throw new Error("Offline logistics export credit missing");
    const inputs: { building: SettlementBuilding; goods: Goods }[] = [];
    for (const buffer of result.buffers) if (buffer.islandId === islandId && buffer.directStock) {
      const building = consumers.get(buffer.uid), definition = productionJobs.find(job => `${islandId}:${job.uid}` === buffer.uid);
      if (!building || !definition || !valid(buffer.directStock) || Object.entries(buffer.directStock)
        .some(([ware, units]) => units > own(definition.inputTargets ?? {}, ware)))
        throw new Error("Offline logistics private input balance invalid");
      inputs.push({ building, goods: buffer.directStock });
    }
    applied = true;
    for (const account of accounts) {
      const output: Goods = { ...account.held };
      for (const [ware, units] of Object.entries(final.get(account.id)!)) output[ware] = own(output, ware) + units;
      account.building.output = output;
    }
    for (const { building, goods } of inputs) for (const [ware, units] of Object.entries(goods))
      building.input[ware] = own(building.input, ware) + units;
    for (const [ware, units] of Object.entries(exports)) owner.received[ware] = own(owner.received, ware) - units;
  } };
};
