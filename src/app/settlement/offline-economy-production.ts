import type { Goods } from "../../shared/settlement/settlement-types";
import type { OfflineEconomyJob } from "./offline-economy-events";

/** Completed cycles only; unfinished work and synthetic source tokens are not physical output. */
export const completedEconomyJobOutput = (job: OfflineEconomyJob, cycles: number): Goods => {
  if (!Number.isSafeInteger(cycles) || cycles < 0) throw new Error("Invalid completed production count");
  if (job.outputSequence && cycles > job.outputSequence.length) throw new Error("Output sequence exceeded");
  const output: Goods = {};
  const add = (goods: Goods, multiplier: number) => {
    for (const [ware, units] of Object.entries(goods))
      if (!ware.startsWith("~") && units > 0) output[ware] = (output[ware] ?? 0) + units * multiplier;
  };
  if (job.outputSequence) for (const goods of job.outputSequence.slice(0, cycles)) add(goods, 1);
  else add(job.outputs, cycles);
  return output;
};
