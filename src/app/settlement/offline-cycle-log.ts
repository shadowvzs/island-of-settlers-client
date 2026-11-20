import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { getBuildingProductionRule } from "../../shared/settlement/production-rules";
import type { Goods, SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { Counts } from "./offline-ledger-flow";

/** One building's finished cycles while a measurement runs. */
export interface CycleRecord {
  inputs: Counts;
  outputs: Counts;
  /** Measurement-relative game seconds of each finished cycle. */
  times: number[];
}

/** A worker that waits for inputs or output space: its chain could run faster when that clears. */
const WAITING_FOR_FLOW = new Set(["Waiting for inputs", "Waiting for planks", "Output stock full"]);
/** Feeding pens spend their feed during the cycle, so their receipts are empty when it finishes. */
const FED_ANIMAL_TYPES = new Set([28, 38]);

const add = (total: Counts, goods: Readonly<Goods>) => {
  for (const [ware, count] of Object.entries(goods)) if (count) total[ware] = (total[ware] ?? 0) + count;
};

const ruleInputs = (building: SettlementBuilding, nation: WorkerNation) => {
  const inputs: Counts = {};
  for (const ware of getBuildingProductionRule(building, nation)?.inputs ?? []) inputs[ware] = (inputs[ware] ?? 0) + 1;
  return inputs;
};

const cycleInputs = (building: SettlementBuilding, consumed: Readonly<Goods>, nation: WorkerNation) =>
  FED_ANIMAL_TYPES.has(building.typeId) && !Object.values(consumed).some(count => count > 0)
    ? ruleInputs(building, nation) : consumed;

/**
 * Finished production cycles (time, paid inputs, product) and settler births while an offline
 * replay measures the island in real ticks: the steady chain rates come from these events.
 */
export const createOfflineCycleLog = (nation: WorkerNation) => {
  let records = new Map<number, CycleRecord>(), waiting = new Map<number, number>(), births: number[] = [], clock = 0;
  return {
    births: () => births,
    /** A finished cycle of `building` at the current measurement clock. */
    cycle: (building: SettlementBuilding, consumed: Readonly<Goods>, output: string | undefined) => {
      let record = records.get(building.uid);
      if (!record) records.set(building.uid, record = { inputs: {}, outputs: {}, times: [] });
      add(record.inputs, cycleInputs(building, consumed, nation));
      if (output) add(record.outputs, { [output]: 1 });
      record.times.push(clock);
    },
    /** Settlers born since the last tick. */
    born: (count: number) => { for (let index = 0; index < count; index++) births.push(clock); },
    /** After a real tick: adds its time to every building whose worker waits for inputs. */
    observe: (buildings: readonly SettlementBuilding[], seconds: number) => {
      for (const building of buildings)
        if (WAITING_FOR_FLOW.has(building.status))
          waiting.set(building.uid, (waiting.get(building.uid) ?? 0) + seconds);
    },
    records: () => records,
    /** Starts a new measurement at clock 0. */
    reset: () => { records = new Map(); waiting = new Map(); births = []; clock = 0; },
    /** Seconds a building's worker waited for inputs during the measurement. */
    waited: (uid: number) => waiting.get(uid) ?? 0,
    setClock: (seconds: number) => { clock = seconds; }
  };
};

/**
 * Events per second over a measured span. Regular events use the gaps between the first and last
 * one, which removes the phase error at the span's ends; a sparse series uses the span. A series
 * that stopped long before the end (a start-up burst from buffered inputs) is no steady rate.
 */
export const eventRate = (times: readonly number[], span: number) => {
  const count = times.length;
  if (!count || span <= 0) return 0;
  const first = times[0]!, last = times[count - 1]!, gap = count > 1 ? (last - first) / (count - 1) : span;
  if (span - last > Math.max(3 * gap, span / 2)) return 0;
  if (count < 3 || gap <= 0 || first > 2 * gap || span - last > 2 * gap) return count / span;
  return 1 / gap;
};
