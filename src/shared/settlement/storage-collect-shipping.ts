import { addGood,getBuildingProductionRule } from "./production-rules";
import { reservedInputReturns } from "./sawmill-input-returns";
import { isOwnBuilding } from "./settlement-home";
import { availableTransportGood } from "./settlement-land-transport-claims";
import { productionInputStock } from "./settlement-sawmill-handcarts";
import type { DemandTarget, ShippingDemandHooks } from "./settlement-shipping-demand";
import type { Goods, SettlementBuilding, SettlementContext } from "./settlement-types";
import { isSharedStorageWare, storagePoolAt, storageSnapshot } from "./shared-storage";
import { collectingHarbour } from "./shared-storage-collect";
import { workshopUpgradeDemand } from "./workshop-upgrades";

const poolAt = (context: SettlementContext, building: SettlementBuilding) => {
  if (building.storagePoolId !== undefined) return building.storagePoolId;
  for (const point of [building.workerApproach, building.access, building]) {
    if (!point) continue;
    const pool = storagePoolAt(context, point);
    if (pool) return pool.id;
  }
};

/** Derived Collect jobs use the ordinary fleet; stock, private custody and receiving room stay authoritative. */
export const createStorageCollectShipping = (
  context: SettlementContext, ordinary: readonly DemandTarget[], hooks: ShippingDemandHooks
) => {
  const pools = context.storagePools?.pools ?? [];
  if (!pools.length) return { targets: [] as DemandTarget[],
    surplus: (_source: SettlementBuilding, _ware: string) => 0,
    coverage: (_pool: number, _ware: string) => 0 };
  const ports = context.buildings.filter(building => building.typeId === 39 && building.construction === 1 &&
    isOwnBuilding(building) && building.storagePoolId !== undefined);
  const portPools = new Set(ports.map(port => port.storagePoolId!));
  const coverage = (poolId: number, ware: string) => hooks.fleetPoolCoverage?.(poolId, ware) ??
    ports.filter(port => port.storagePoolId === poolId).reduce((sum, port) =>
      sum + hooks.fleetCoverage(port.uid, ware), 0);
  if (portPools.size < 2 || !pools.some(pool => pool.collect?.length)) return {
    targets: [] as DemandTarget[], coverage, surplus: (_source: SettlementBuilding, _ware: string) => 0
  };
  const protectedStock = new Map<number, Goods>();
  const reserve = (poolId: number | undefined, ware: string, amount: number) => {
    if (poolId === undefined || amount <= 0) return;
    const goods = protectedStock.get(poolId) ?? {};
    addGood(goods, ware, amount); protectedStock.set(poolId, goods);
  };
  for (const target of ordinary) {
    const building = context.buildings.find(entry => entry.uid === target.destinationUid);
    if (building) reserve(poolAt(context, building), target.ware,
      Math.max(0, target.need - target.local - target.incoming));
  }
  // Alternative foods share one buffer. Preserve it once using canonical food order, not once per ware.
  const foods = new Map<number, { need: number; source: SettlementBuilding; wares: string[] }>();
  for (const building of context.buildings) {
    if (building.construction !== 1 || building.militaryFaction) continue;
    const rule = getBuildingProductionRule(building, context.playerNation);
    if (!rule?.alternativeFood || !rule.inputs.length) continue;
    const poolId = poolAt(context, building), source = ports.find(port => port.storagePoolId === poolId);
    if (poolId === undefined || !source) continue;
    const local = rule.inputs.reduce((sum, ware) => sum + (building.input[ware] ?? 0) +
      (building.incoming[ware] ?? 0) + reservedInputReturns(context, building, ware), 0);
    const need = Math.max(0, productionInputStock(building, rule.inputs[0]!) - local);
    const group = foods.get(poolId) ?? { need: 0, source, wares: rule.inputs };
    group.need += need; foods.set(poolId, group);
  }
  for (const [poolId, group] of foods) {
    const backed = group.wares.reduce((sum, ware) => sum + Math.min(protectedStock.get(poolId)?.[ware] ?? 0,
      Math.max(0, availableTransportGood(context, group.source, ware))), 0);
    let left = Math.max(0, group.need - backed);
    for (const ware of group.wares) {
      const free = Math.max(0, availableTransportGood(context, group.source, ware) -
        (protectedStock.get(poolId)?.[ware] ?? 0));
      const amount = Math.min(left, free);
      reserve(poolId, ware, amount); left -= amount;
    }
  }
  for (const building of context.buildings) {
    if (building.militaryFaction) continue;
    const poolId = poolAt(context, building);
    for (const [ware, amount] of Object.entries(workshopUpgradeDemand(building))) reserve(poolId, ware, amount);
    for (const [ware, amount] of Object.entries(context.tavern?.demand(building.uid) ?? {})) reserve(poolId, ware, amount);
  }
  const surplus = (source: SettlementBuilding, ware: string) => {
    const pool = pools.find(entry => entry.id === source.storagePoolId && entry.owner === 0);
    if (!pool || pool.collect?.includes(ware) || !portPools.has(pool.id)) return 0;
    const needed = Math.max(0, (protectedStock.get(pool.id)?.[ware] ?? 0) - coverage(pool.id, ware));
    return Math.max(0, availableTransportGood(context, source, ware) - needed);
  };
  const targets: DemandTarget[] = [];
  if (portPools.size > 1) for (const pool of pools) {
    if (pool.owner !== 0 || !pool.collect?.length) continue;
    const harbour = collectingHarbour(context, pool);
    if (!harbour) continue;
    pool.collectHarbourUid = harbour.uid;
    const snapshot = storageSnapshot(context, harbour);
    if (!snapshot) continue;
    for (const ware of pool.collect) {
      if (!isSharedStorageWare(ware)) continue;
      const seen = new Set<number>();
      const wanted = ports.reduce((sum, source) => {
        const id = source.storagePoolId!;
        if (id === pool.id || seen.has(id)) return sum;
        seen.add(id); return sum + surplus(source, ware);
      }, 0);
      const incoming = snapshot.incoming[ware] ?? 0, fleet = coverage(pool.id, ware);
      if (wanted + incoming + fleet <= 0) continue;
      targets.push({ collectPoolId: pool.id, destinationUid: harbour.uid, harbourUid: harbour.uid,
        ware, need: wanted + incoming + fleet, local: 0, network: 0, incoming, fleet });
    }
  }
  return { coverage, surplus, targets };
};
