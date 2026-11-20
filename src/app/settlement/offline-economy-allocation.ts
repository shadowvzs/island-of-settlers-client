/** The live scheduler's input-demand policy, independent of transport and production rates. */
export interface OfflineEconomyInputDemand {
  /** In recipe input order. Targets come from productionInputStock, not predicted consumption. */
  targets: Readonly<Record<string, number>>;
  buffered: Readonly<Record<string, number>>;
  incoming?: Readonly<Record<string, number>>;
  available: Readonly<Record<string, number>>;
  alternativeFoods?: readonly string[];
  reservedReturns?: Readonly<Record<string, number>>;
  /** Ordinary cartless dispatch is one unit. Set larger only for a real eligible cart manifest. */
  dispatchCapacity?: number;
}
export interface OfflineEconomyInputAllocation {
  ware: string;
  units: number;
}

/**
 * One successful delivery dispatch, mirroring settlement-logistics.ts scheduleDeliveryPhase:
 * preserve recipe order; an alternative-food consumer with any food buffered or incoming asks
 * for nothing. Missing stock is target - buffered + reserved returns - incoming. A normal
 * cartless courier dispatches one unit even if the target is two. The caller preserves building
 * order and source route selection, and accounts for actual delivery arrival separately.
 * No age-based fairness or output-specific production quota is imposed here.
 */
export const offlineEconomyInputAllocation = (
  demand: OfflineEconomyInputDemand
): OfflineEconomyInputAllocation | undefined => {
  const capacity = demand.dispatchCapacity ?? 1;
  if (!Number.isSafeInteger(capacity) || capacity < 1) throw new Error("Invalid input dispatch capacity");
  const foods = demand.alternativeFoods ?? [];
  if (foods.some(ware => (demand.buffered[ware] ?? 0) + (demand.incoming?.[ware] ?? 0) > 0)) return undefined;
  for (const [ware, target] of Object.entries(demand.targets)) {
    const missing = target - (demand.buffered[ware] ?? 0) + (demand.reservedReturns?.[ware] ?? 0) -
      (demand.incoming?.[ware] ?? 0);
    const units = Math.min(capacity, missing, demand.available[ware] ?? 0);
    if (units <= 0) continue;
    if (!Number.isSafeInteger(units)) throw new Error("Invalid input allocation units");
    return { ware, units };
  }
  return undefined;
};
