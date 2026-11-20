import { DMath } from "../math/deterministic-math";
import { catapultAmmoChoice, catapultAmmoUnits } from "./catapult-ammo-kinds";
import { CATAPULT } from "./military-catapult";
import { getBuildingProductionRule, STORAGE_IDS } from "./production-rules";
import { reservedInputReturns } from "./sawmill-input-returns";
import { isOwnBuilding } from "./settlement-home";
import { productionInputStock } from "./settlement-sawmill-handcarts";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";
import { uniquePoolSources } from "./shared-storage-ware-sources";
import { contextStorageCapacity, storageRoom } from "./storage-capacity";
import { createStorageCollectShipping } from "./storage-collect-shipping";
import { chooseNextTransportJob } from "./transport-reuse-policy";

export type ShippingDemandStatus = "blocked" | "in-transit" | "outstanding";
export type ShippingDemandReason =
  | "batching" | "no-harbour" | "no-ship" | "no-source" | "not-accepted" | "reduced" | "route-lost"
  | "storage-full";

/** One destination/ware need with its physical coverage; a record never promises unavailable goods. */
export interface ShippingDemandRecord {
  collectPoolId?: number;
  id: number;
  destinationUid: number;
  /** The receiving harbour when sea transport is possible, else the building with the unmet need. */
  harbourUid?: number;
  ware: string;
  need: number;
  stock: number;
  incoming: number;
  fleet: number;
  covered: number;
  status: ShippingDemandStatus;
  reason?: ShippingDemandReason;
  createdTick: number;
  updatedTick: number;
  revision: number;
  orderId?: number;
  sourceUid?: number;
}
export interface ShippingDemandSnapshot extends ShippingDemandRecord { outstanding: number }
export interface ShippingDemandSave {
  timer?: number;
  dirty?: boolean;
  nextDemand: number;
  demands: ShippingDemandRecord[];
}
export interface ShippingDemandHooks {
  canReachHarbour: (sourceUid: number, destinationUid: number) => boolean;
  expeditionDemand: (uid: number) => Readonly<Goods>;
  /** Boxes already promised to this receiving harbour by orders or real ship manifests. */
  fleetPoolCoverage?: (poolId: number, ware: string) => number;
  fleetCoverage: (destinationUid: number, ware: string) => number;
  /** An idle own ship can physically reach this harbour's berth now. */
  hasIdleShipAt: (sourceUid: number) => boolean;
  queueTransport: (sourceUid: number, destinationUid: number, cargo: Goods, demand?: Goods) => number | null;
  transportDistance?: (sourceUid: number, destinationUid: number) => number;
  shipyardDemand: (uid: number) => Readonly<Goods>;
}
export interface DemandTarget {
  collectPoolId?: number;
  destinationUid: number;
  harbourUid?: number;
  ware: string;
  need: number;
  /** Goods already at the need building (site input, production input, returned wares). */
  local: number;
  /** Free stock in the receiving network, shared by every need in that network. */
  network: number;
  incoming: number;
  fleet: number;
  blocked?: ShippingDemandReason;
}
const MAX_BATCH_WAIT_SECONDS = 8;
const MIN_BATCH_UNITS = 4;
const RECONCILE_SECONDS = 1;
const BLOCKING_REASONS: ReadonlySet<ShippingDemandReason> = new Set([
  "no-harbour", "not-accepted", "route-lost", "storage-full"
]);

const own = (building: SettlementBuilding) => isOwnBuilding(building);
const isStorage = (building: SettlementBuilding) => building.construction === 1 &&
  STORAGE_IDS.has(building.typeId) && own(building);
const roadConnected = (context: SettlementContext, first: SettlementBuilding, second: SettlementBuilding) =>
  first.uid === second.uid || Boolean(context.options.roads.route(first.access, second.access));
/** Usable stock excludes boxes reserved for a ship and any material an unfinished site still requires. */
const usableStock = (building: SettlementBuilding, ware: string) => {
  if (!isStorage(building)) return 0;
  const promised = building.storagePoolId === undefined ? building.shipReserve?.[ware] ?? 0 : 0;
  const siteNeed = building.construction < 1 ? Math.max(0, (building.required[ware] ?? 0) -
    (building.input[ware] ?? 0) - (building.incoming[ware] ?? 0) -
    (building.constructionConsumed?.[ware] ?? 0)) : 0;
  return Math.max(0, (building.inventory[ware] ?? 0) - promised - siteNeed);
};
const networkStorages = (context: SettlementContext, anchor: SettlementBuilding) =>
  context.buildings.filter(storage => isStorage(storage) && roadConnected(context, anchor, storage));
const networkStock = (context: SettlementContext, anchor: SettlementBuilding, ware: string) =>
  uniquePoolSources(networkStorages(context, anchor)).reduce((sum, storage) => sum + usableStock(storage, ware), 0);
const receivingHarbour = (context: SettlementContext, anchor: SettlementBuilding) => {
  if (anchor.typeId === 39 && anchor.construction === 1 && own(anchor)) return anchor;
  const harbours = context.buildings.filter(building => building.typeId === 39 && building.construction === 1 &&
    own(building) && roadConnected(context, anchor, building));
  harbours.sort((first, second) => {
    const firstRoute = context.options.roads.route(anchor.access, first.access);
    const secondRoute = context.options.roads.route(anchor.access, second.access);
    return (firstRoute?.cost ?? Infinity) - (secondRoute?.cost ?? Infinity) || first.uid - second.uid;
  });
  return harbours[0];
};
const target = (context: SettlementContext, building: SettlementBuilding, ware: string, need: number,
  local: number, network: number, incoming = 0): DemandTarget => {
  const harbour = receivingHarbour(context, building);
  return {
    destinationUid: harbour?.uid ?? building.uid, harbourUid: harbour?.uid, ware, need,
    local, network, incoming, fleet: 0, blocked: harbour ? undefined : "no-harbour"
  };
};
const constructionTargets = (context: SettlementContext, building: SettlementBuilding) => {
  if (building.construction >= 1 || building.foundedByExpedition) return [];
  const targets: DemandTarget[] = [];
  for (const [ware, required] of Object.entries(building.required)) {
    if (required <= 0) continue;
    const local = (building.input[ware] ?? 0) + (building.constructionConsumed?.[ware] ?? 0);
    targets.push(target(context, building, ware, required, local,
      networkStock(context, building, ware), building.incoming[ware] ?? 0));
  }
  const tool = (building.foundationProgress ?? 1) < 1 ? "shovel" : "hammer";
  if (building.worker === undefined && context.settlers > 0)
    targets.push(target(context, building, tool, 1, 0, networkStock(context, building, tool),
      building.incoming[tool] ?? 0));
  return targets;
};
const productionTargets = (context: SettlementContext, building: SettlementBuilding) => {
  if (building.construction !== 1) return [];
  const rule = getBuildingProductionRule(building, context.playerNation);
  if (!rule || rule.service) return [];
  const targets: DemandTarget[] = [];
  if (rule.alternativeFood) {
    // Several foods satisfy one shared buffer: one group target, never one full request per food.
    const available = rule.inputs.some(ware => (building.input[ware] ?? 0) + (building.incoming[ware] ?? 0) +
      reservedInputReturns(context, building, ware) + networkStock(context, building, ware) > 0);
    if (!available) {
      const ware = rule.inputs[0];
      if (ware) targets.push(target(context, building, ware, productionInputStock(building, ware), 0, 0));
    }
  } else {
    for (const ware of rule.inputs) {
      const local = (building.input[ware] ?? 0) + reservedInputReturns(context, building, ware);
      targets.push(target(context, building, ware, productionInputStock(building, ware), local,
        networkStock(context, building, ware), building.incoming[ware] ?? 0));
    }
  }
  if (rule.tool && building.worker === undefined && context.settlers > 0)
    targets.push(target(context, building, rule.tool, 1, 0, networkStock(context, building, rule.tool),
      building.incoming[rule.tool] ?? 0));
  return targets;
};
/** Demand already net of local stock/incoming at the harbour; only the fleet covers it. */
const netTarget = (context: SettlementContext, building: SettlementBuilding, ware: string, need: number) =>
  target(context, building, ware, need, 0, 0);
/** Local needs, aggregated at each destination's reachable receiving harbour. */
export const collectShippingDemandTargets = (context: SettlementContext,
  hooks: Pick<ShippingDemandHooks, "expeditionDemand" | "shipyardDemand">) => {
  const targets = new Map<string, DemandTarget>();
  const add = (entry: DemandTarget | undefined) => {
    if (!entry || entry.need <= 0) return;
    const key = `${entry.destinationUid}|${entry.ware}`;
    const current = targets.get(key);
    if (!current) { targets.set(key, entry); return; }
    current.need += entry.need;
    current.local += entry.local;
    current.network = Math.max(current.network, entry.network);
    current.incoming += entry.incoming;
    current.blocked ??= entry.blocked;
  };
  for (const building of context.buildings) {
    for (const entry of constructionTargets(context, building)) add(entry);
    for (const entry of productionTargets(context, building)) add(entry);
    if (building.typeId === 16 && building.construction === 1 && own(building)) {
      const ammo = catapultAmmoChoice(building);
      add(target(context, building, ammo, CATAPULT.capacity, catapultAmmoUnits(building.input),
        networkStock(context, building, ammo), catapultAmmoUnits(building.incoming)));
    }
  }
  for (const building of context.buildings) {
    if (!isStorage(building)) continue;
    for (const [ware, need] of Object.entries(hooks.expeditionDemand(building.uid)))
      add(netTarget(context, building, ware, need));
    for (const [ware, need] of Object.entries(hooks.shipyardDemand(building.uid)))
      add(netTarget(context, building, ware, need));
  }
  return [...targets.values()].filter(entry => entry.need > 0);
};
const targetKey = (entry: Pick<ShippingDemandRecord, "destinationUid" | "ware">) =>
  `${entry.destinationUid}|${entry.ware}`;
const outstandingOf = (entry: Pick<ShippingDemandRecord, "need" | "covered">) =>
  Math.max(0, entry.need - entry.covered);
const statusFor = (entry: ShippingDemandRecord): ShippingDemandStatus => {
  if (entry.covered < entry.need && entry.reason && BLOCKING_REASONS.has(entry.reason)) return "blocked";
  if (entry.covered >= entry.need) return "in-transit";
  return entry.fleet > 0 ? "in-transit" : "outstanding";
};
/** Exact saved demand state; `revision` changes only when the underlying need changes. */
export const createShippingDemand = (context: SettlementContext, hooks: ShippingDemandHooks) => {
  const active = new Map<string, ShippingDemandRecord>();
  let nextDemand = 1, timer = 0, dirty = true;
  const nowTick = () => context.clock?.tick() ?? 0;
  let collect: ReturnType<typeof createStorageCollectShipping> | undefined;
  const capacity = (uid: number) => contextStorageCapacity(context, harbourOf(uid));
  const ageSeconds = (entry: ShippingDemandRecord) => Math.max(0, nowTick() - entry.createdTick) * 0.05;
  const harbourOf = (uid: number) => context.buildings.find(building => building.uid === uid &&
    building.typeId === 39 && building.construction === 1 && own(building));
  const fleetCoverage = (destinationUid: number, ware: string) =>
    Math.max(0, hooks.fleetCoverage(destinationUid, ware));
  /** Sources must not share a road with the receiving harbour: that is a local carrier job. */
  const sourceCandidates = (destinationUid: number, ware: string, collecting = false) => {
    const destination = harbourOf(destinationUid);
    if (!destination) return [];
    return context.buildings
      .filter(building => building.typeId === 39 && building.construction === 1 && own(building) &&
        building.uid !== destinationUid &&
        (building.storagePoolId === undefined || building.storagePoolId !== destination.storagePoolId) &&
        (collecting || !roadConnected(context, building, destination)) &&
        (collecting ? collect?.surplus(building, ware) ?? 0 : usableStock(building, ware)) > 0)
      .map(building => ({ building, distance: hooks.transportDistance?.(building.uid, destinationUid) ??
        DMath.hypot(building.x - destination.x, building.z - destination.z) }))
      .sort((first, second) => first.distance - second.distance || first.building.uid - second.building.uid);
  };
  const targetCoverage = (entry: Pick<ShippingDemandRecord,
    "collectPoolId" | "destinationUid" | "harbourUid" | "ware">) => {
    if (entry.collectPoolId !== undefined) return collect?.coverage(entry.collectPoolId, entry.ware) ?? 0;
    if (entry.harbourUid === undefined) return 0;
    const poolId = harbourOf(entry.harbourUid)?.storagePoolId;
    if (poolId !== undefined) return collect?.coverage(poolId, entry.ware) ?? 0;
    return fleetCoverage(entry.destinationUid, entry.ware);
  };
  const updateRecord = (entry: ShippingDemandRecord, target: DemandTarget) => {
    const fleet = targetCoverage(target);
    entry.collectPoolId = target.collectPoolId;
    const stock = target.local + target.network;
    const covered = Math.min(target.need, stock + target.incoming + fleet);
    if (entry.need !== target.need) entry.revision++;
    entry.destinationUid = target.destinationUid;
    entry.harbourUid = target.harbourUid;
    entry.need = target.need;
    entry.stock = Math.min(target.need, stock);
    entry.incoming = Math.min(target.need - entry.stock, target.incoming);
    entry.fleet = Math.max(0, covered - entry.stock - entry.incoming);
    entry.covered = covered;
    entry.updatedTick = nowTick();
    entry.reason = target.blocked;
    entry.status = statusFor(entry);
  };
  const mergeTargets = (targets: DemandTarget[]) => {
    const seen = new Set<string>();
    for (const target of targets) {
      const key = targetKey(target);
      seen.add(key);
      const existing = active.get(key);
      // A new record takes its id only when it stays: a need already covered never consumes one, so the
      // id sequence does not depend on how often demand is re-evaluated (quiet skip parity).
      const entry = existing ?? { id: 0, destinationUid: target.destinationUid, harbourUid: target.harbourUid,
        ware: target.ware, need: target.need, stock: 0, incoming: 0, fleet: 0, covered: 0,
        status: "outstanding", createdTick: nowTick(), updatedTick: nowTick(), revision: 0 };
      const destination = context.buildings.find(building => building.uid === target.destinationUid);
      if (target.collectPoolId === undefined && target.harbourUid !== undefined && destination?.accepts[target.ware] === false)
        target.blocked = "not-accepted";
      updateRecord(entry, target);
      if (entry.covered >= entry.need && entry.fleet === 0) {
        active.delete(key);
        continue;
      }
      if (existing) continue;
      entry.id = nextDemand++;
      active.set(key, entry);
    }
    for (const [key, entry] of active) {
      if (seen.has(key)) continue;
      const fleet = targetCoverage(entry);
      if (fleet > 0) {
        if (entry.collectPoolId !== undefined) {
          entry.need = fleet; entry.stock = 0; entry.incoming = 0;
        }
        entry.fleet = fleet;
        entry.covered = Math.min(entry.need, entry.stock + entry.incoming + fleet);
        entry.status = "in-transit";
        entry.reason = "reduced";
        entry.updatedTick = nowTick();
        continue;
      }
      if (fleet === 0) active.delete(key);
    }
  };
  const mark = (entry: ShippingDemandRecord, reason: ShippingDemandReason) => {
    entry.reason = reason;
    entry.status = statusFor(entry);
    entry.updatedTick = nowTick();
  };
  const dispatch = () => {
    const byDestination = new Map<number, ShippingDemandRecord[]>();
    for (const entry of active.values()) {
      if (entry.harbourUid === undefined || entry.reason === "not-accepted" || outstandingOf(entry) <= 0) continue;
      const list = byDestination.get(entry.destinationUid) ?? [];
      list.push(entry);
      byDestination.set(entry.destinationUid, list);
    }
    const planned: Array<{ order: number; remainingNeed: number; routeDistance: number;
      value: { sourceUid: number; destinationUid: number; cargo: Goods; demand: Goods;
        entries: ShippingDemandRecord[] } }> = [];
    for (const [destinationUid, entries] of byDestination) {
      const groups = new Map<number, { cargo: Goods; demand: Goods; entries: ShippingDemandRecord[] }>();
      for (const entry of entries.sort((first, second) => first.createdTick - second.createdTick ||
        first.ware.localeCompare(second.ware))) {
        const candidates = sourceCandidates(destinationUid, entry.ware, entry.collectPoolId !== undefined);
        if (!candidates.length) { mark(entry, "no-source"); continue; }
        const reachable = candidates.filter(candidate =>
          hooks.canReachHarbour(candidate.building.uid, destinationUid));
        if (!reachable.length) { mark(entry, "route-lost"); continue; }
        const receiver = harbourOf(destinationUid);
        const poolId = receiver?.storagePoolId;
        const promised = poolId !== undefined ? collect?.coverage(poolId, entry.ware) ?? 0 :
          fleetCoverage(destinationUid, entry.ware);
        const room = Math.max(0, storageRoom(capacity(destinationUid), entry.ware) - promised);
        if (room <= 0) { mark(entry, "storage-full"); continue; }
        const source = reachable[0]!;
        const group = groups.get(source.building.uid) ?? { cargo: {}, demand: {}, entries: [] };
        const freeShipRoom = 40 - Object.values(group.cargo).reduce((sum, count) => sum + count, 0);
        const amount = Math.min(outstandingOf(entry), (entry.collectPoolId !== undefined ? collect?.surplus(source.building, entry.ware) ?? 0 :
          usableStock(source.building, entry.ware)), room, freeShipRoom);
        if (amount <= 0) { mark(entry, "no-source"); continue; }
        group.demand[entry.ware] = outstandingOf(entry);
        group.cargo[entry.ware] = (group.cargo[entry.ware] ?? 0) + amount;
        group.entries.push(entry);
        groups.set(source.building.uid, group);
      }
      for (const [sourceUid, group] of groups) {
        planned.push({ order: Math.min(...group.entries.map(entry => entry.id)),
          remainingNeed: Object.values(group.demand).reduce((sum, count) => sum + count, 0),
          routeDistance: hooks.transportDistance?.(sourceUid, destinationUid) ?? 0,
          value: { ...group, sourceUid, destinationUid } });
      }
    }
    while (planned.length) {
      const group = chooseNextTransportJob(planned);
      if (!group) break;
      planned.splice(planned.findIndex(entry => entry.value === group), 1);
      const { destinationUid, sourceUid } = group;
      const source = harbourOf(sourceUid), receiver = harbourOf(destinationUid);
      if (!source || !receiver) continue;
      for (const [ware, count] of Object.entries(group.cargo)) {
        const entry = group.entries.find(record => record.ware === ware)!;
        const promised = targetCoverage(entry);
        const room = Math.max(0, storageRoom(capacity(destinationUid), ware) - promised);
        const free = entry.collectPoolId !== undefined ? collect?.surplus(source, ware) ?? 0 : usableStock(source, ware);
        const wanted = entry.collectPoolId !== undefined ? free :
          Math.max(0, entry.need - entry.stock - entry.incoming - promised);
        const amount = Math.min(count, free, room, wanted);
        if (amount > 0) group.cargo[ware] = amount;
        else {
          delete group.cargo[ware];
          entry.reason = room <= 0 ? "storage-full" : "reduced";
          entry.fleet = Math.min(Math.max(0, entry.need - entry.stock - entry.incoming), promised);
          entry.covered = entry.stock + entry.incoming + entry.fleet;
          entry.status = statusFor(entry);
        }
      }
      group.entries = group.entries.filter(entry => (group.cargo[entry.ware] ?? 0) > 0);
      if (!group.entries.length) continue;
      const total = Object.values(group.cargo).reduce((sum, count) => sum + count, 0);
      const largestAge = Math.max(...group.entries.map(ageSeconds));
      if (Object.keys(group.cargo).length > 1 && total < MIN_BATCH_UNITS &&
        largestAge < MAX_BATCH_WAIT_SECONDS) {
        for (const entry of group.entries) mark(entry, "batching");
        continue;
      }
      if (!hooks.hasIdleShipAt(sourceUid)) {
        for (const entry of group.entries) mark(entry, "no-ship");
        continue;
      }
      const orderId = hooks.queueTransport(sourceUid, destinationUid, group.cargo, group.demand);
      if (orderId === null) {
        for (const entry of group.entries) mark(entry, "route-lost");
        continue;
      }
      for (const entry of group.entries) {
        entry.orderId = orderId; entry.sourceUid = sourceUid; entry.reason = undefined;
      }
      // The next preplanned batch sees these reservations immediately, even through another pool harbour.
      for (const entry of active.values()) {
        const poolId = harbourOf(entry.destinationUid)?.storagePoolId ?? entry.collectPoolId;
        const sameReceiver = receiver.storagePoolId === undefined ? entry.destinationUid === destinationUid :
          poolId === receiver.storagePoolId;
        if (!sameReceiver || !((group.cargo[entry.ware] ?? 0) > 0)) continue;
        entry.fleet = Math.min(Math.max(0, entry.need - entry.stock - entry.incoming), targetCoverage(entry));
        entry.covered = entry.stock + entry.incoming + entry.fleet;
        entry.status = statusFor(entry); entry.updatedTick = nowTick();
      }
    }
  };
  const reconcile = () => {
    dirty = false;
    const ordinary = collectShippingDemandTargets(context, hooks);
    collect = createStorageCollectShipping(context, ordinary, hooks);
    const merged = new Map(ordinary.map(target => [targetKey(target), target]));
    for (const target of collect.targets) {
      const previous = merged.get(targetKey(target));
      if (previous) target.need = Math.max(target.need,
        Math.max(0, previous.need - previous.local - previous.network - previous.incoming) + target.incoming);
      merged.set(targetKey(target), target);
    }
    mergeTargets([...merged.values()]);
    dispatch();
  };
  return {
    notify: () => { dirty = true; },
    reconcile,
    update: (dt: number) => {
      if (!Number.isFinite(dt) || dt <= 0) return;
      timer -= dt;
      if (!dirty && timer > 0) return;
      timer = RECONCILE_SECONDS;
      reconcile();
    },
    demands: (): ShippingDemandSnapshot[] => [...active.values()]
      .map(entry => ({ ...entry, outstanding: outstandingOf(entry) }))
      .sort((first, second) => first.destinationUid - second.destinationUid ||
        first.ware.localeCompare(second.ware)),
    saveState: (): ShippingDemandSave => ({ nextDemand, timer, dirty,
      demands: [...active.values()].map(entry => ({ ...entry })) }),
    restore: (saved?: ShippingDemandSave) => {
      active.clear(); dirty = saved?.dirty ?? true; timer = saved?.timer ?? 0;
      nextDemand = saved?.nextDemand ?? 1;
      for (const entry of saved?.demands ?? []) active.set(targetKey(entry), { ...entry });
    }
  };
};
