import { TRADE_WARE_VALUES } from "@shared/catalog/balance";

import { offlineEconomyInputAllocation } from "./offline-economy-allocation";
import type { EconomyGoods, OfflineEconomyEvent } from "./offline-economy-events";
import { add, createOfflineEconomyEventState, integer, own } from "./offline-economy-state";
import { previewOfflineTransport, reserveOfflineTransport } from "./offline-economy-work";

export interface DirectInputTrip {
  source: number; target: number; ware: string; units: number; arrived: boolean;
}
interface InputBufferOptions {
  completedCycles: EconomyGoods;
  directTrips: DirectInputTrip[];
  enqueue: (event: Omit<OfflineEconomyEvent, "sequence">) => void;
  horizonTicks: number;
  prepared: ReturnType<typeof createOfflineEconomyEventState>;
}

/** Private input reservations and their physical arrivals, shared by all workshop recipes. */
export const createOfflineInputBufferScheduler = ({
  completedCycles, directTrips, enqueue, horizonTicks, prepared
}: InputBufferOptions) => {
  const { inputDependencies, islandIndex, jobs, states } = prepared;
  const hasBuffers = jobs.some(job => job.definition.inputTargets !== undefined);
  // Scarce warehouse input is shared by delivery work, not monopolized by the lowest job id.
  // Animal feed also follows the downstream value chain: hides -> leather -> armor outranks meat.
  const allocatedDeliveryWork = new Map<number, number>();
  const consumers = new Map<string, number[]>();
  for (let index = 0; index < jobs.length; index++)
    for (const ware of Object.keys(jobs[index]!.definition.inputs))
      if (!ware.startsWith("~")) consumers.set(ware, [...consumers.get(ware) ?? [], index]);
  const valueCache = new Map<string, number>();
  const downstreamValue = (ware: string, seen = new Set<string>()): number => {
    const cached = valueCache.get(ware); if (cached !== undefined) return cached;
    if (seen.has(ware)) return TRADE_WARE_VALUES[ware] ?? 1;
    seen.add(ware);
    let value = TRADE_WARE_VALUES[ware] ?? 1;
    for (const index of consumers.get(ware) ?? []) {
      const definition = jobs[index]!.definition;
      for (const output of Object.keys(definition.outputs))
        if (!output.startsWith("~")) value = Math.max(value, downstreamValue(output, seen));
    }
    seen.delete(ware); valueCache.set(ware, value); return value;
  };
  const jobPriority = (index: number) => {
    const definition = jobs[index]!.definition;
    let value = 1;
    for (const ware of Object.keys(definition.outputs)) if (!ware.startsWith("~"))
      value = Math.max(value, downstreamValue(ware));
    return Math.max(1, value / 20);
  };
  const inputFillOrder = (candidates: Set<number>, keys: string[]) => {
    // Animal-feed competition follows the value of what it becomes. Material and crop inputs keep
    // carrier-work fairness so the same rule does not bias grain, water or construction wares.
    const priority = (index: number) => keys.some(ware => ware === "pig") ? jobPriority(index) :
      keys.some(ware => ware === "grain" || ware === "water") ? jobs[index]!.definition.priority ?? 1 : 1;
    return [...candidates].sort((a, b) =>
      (allocatedDeliveryWork.get(a) ?? 0) / priority(a) -
      (allocatedDeliveryWork.get(b) ?? 0) / priority(b) || a - b);
  };
  const suppliersFor = (index: number, ware: string) => {
    const job = jobs[index]!, definition = job.definition;
    const suppliers = definition.inputSuppliers?.[ware];
    return suppliers === undefined
      ? [{ source: job.island, deliveryTicks: own(definition.inputDeliveryTicks ?? {}, ware), workTicks: 0 }]
      : suppliers.map(supplier => ({ ...supplier, source: islandIndex.get(supplier.accountId)! }));
  };
  const fillBuffers = (island: number, keys: string[], tick: number) => {
    if (!hasBuffers || tick >= horizonTicks) return;
    const candidates = new Set<number>();
    for (const ware of keys) for (const index of inputDependencies[island]!.get(ware) ?? [])
      if (jobs[index]!.definition.inputTargets !== undefined) candidates.add(index);
    for (const index of inputFillOrder(candidates, keys)) {
      const job = jobs[index]!, definition = job.definition;
      const nextCycle = own(completedCycles, definition.uid) + (job.paid ? 1 : 0);
      const nextStart = Math.max(tick, definition.firstTick ?? 0, job.paid?.finishTick ?? 0);
      if (job.stopped || nextStart >= horizonTicks ||
        nextStart + definition.cycleTicks > (definition.endTick ?? Infinity) ||
        (definition.outputSequence !== undefined && nextCycle >= definition.outputSequence.length)) continue;
      const foods = definition.alternativeFoods ?? [];
      const foodChanged = foods.some(ware => keys.includes(ware));
      const buffered = (ware: string) => own(job.buffer, ware) + own(job.deliveredStock, ware) +
        own(job.directStock, ware) + own(job.ownedStock, ware);
      const incoming = (ware: string) => own(job.pendingInputs, ware) + own(job.externalIncoming, ware) + own(job.directIncoming, ware);
      const foodRequest = foods.length ? offlineEconomyInputAllocation({ targets: job.foodTargets,
        buffered: Object.fromEntries(foods.map(ware => [ware, buffered(ware)])),
        incoming: Object.fromEntries(foods.map(ware => [ware, incoming(ware)])),
        available: Object.fromEntries(foods.map(ware => [ware, suppliersFor(index, ware)
          .reduce((sum, supplier) => sum + own(states[supplier.source]!.stock, ware), 0)])),
        alternativeFoods: foods, dispatchCapacity: definition.foodUnits ?? 1 }) : undefined;
      for (const [ware, target] of Object.entries(definition.inputTargets!)) {
        if ((!keys.includes(ware) && !(foodChanged && foods.includes(ware))) ||
          (foods.includes(ware) && foodRequest?.ware !== ware)) continue;
        const requested = Math.min(Math.max(0, target - buffered(ware) - incoming(ware)),
          foods.includes(ware) ? foodRequest!.units : Infinity);
        let missing = requested, allocatedWork = 0;
        const suppliers = suppliersFor(index, ware);
        while (missing > 0) {
          const supplier = suppliers.find(entry => own(states[entry.source]!.stock, ware) > 0);
          if (!supplier) break;
          const source = states[supplier.source]!, fleet = states[job.workIsland]!;
          const amount = Math.min(missing, own(source.stock, ware), definition.inputSuppliers ? 1 : Infinity);
          const carrierCost = Math.max(1, supplier.workTicks || supplier.deliveryTicks);
          // Longer lanes consume disproportionately more fleet headroom through queueing and
          // return-trip pressure; use the square of measured work for the fair-share charge.
          allocatedWork += amount * carrierCost * carrierCost;
          const planned = previewOfflineTransport(fleet, tick, supplier.workTicks);
          const ready = supplier.workTicks > 0 ? planned.ready : tick;
          const arrival = Math.max(tick + supplier.deliveryTicks, ready);
          integer(arrival, "input arrival tick");
          if (arrival > tick && arrival + definition.cycleTicks > (definition.endTick ?? Infinity)) break;
          if (supplier.workTicks > 0) reserveOfflineTransport(fleet, planned);
          add(source.stock, ware, -amount);
          if (supplier.source !== job.island) {
            add(source.sent, ware, amount);
            // Keep source yard slots occupied until arrival, so a cancelled late pickup can
            // return to its original output shelf without exceeding the shared yard capacity.
            add(source.reserved, ware, amount);
            add(job.directIncoming, ware, amount);
            const direct = directTrips.length;
            directTrips.push({ source: supplier.source, target: index, ware, units: amount, arrived: false });
            enqueue({ tick: arrival, finish: false, job: index, island: job.island, 
              delivery: { ware, units: amount, direct } });
          } else {
            if (arrival > tick) {
              add(job.pendingInputs, ware, amount);
              enqueue({ tick: arrival, finish: false, job: index, island: job.island, 
                delivery: { ware, units: amount } });
            } else add(job.buffer, ware, amount);
            add(source.reserved, ware, amount);
          }
          missing -= amount;
        }
        if (missing < requested)
          allocatedDeliveryWork.set(index, (allocatedDeliveryWork.get(index) ?? 0) + allocatedWork);
      }
    }
  };
  return fillBuffers;
};
