import { COLONY_ORE_PER_MINE_HOUR } from "../balance/colonies";

export interface ColonyNativeEconomy {
  version: 1;
  /** Disjoint native time coverage not yet settled by the ordinary abstract shipment cursor. */
  coverage: [number, number][];
  /** Fractional abstract ore budget; unfunded whole units never carry into another shipment. */
  oreRemainder: number;
}
const clock = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value >= 0;
export const validColonyNativeEconomy = (value: unknown): value is ColonyNativeEconomy | undefined => {
  if (value === undefined) return true;
  const state = value as ColonyNativeEconomy;
  return Boolean(state) && state.version === 1 && clock(state.oreRemainder) && state.oreRemainder < 1 &&
    Array.isArray(state.coverage) && state.coverage.length <= 64 && state.coverage.every((span, index) =>
      Array.isArray(span) && span.length === 2 && clock(span[0]) && clock(span[1]) && span[1] > span[0] &&
      (!index || state.coverage[index - 1]![1] < span[0]));
};

/** Pure canonical union, also used by the server to validate each native chunk's custody receipt. */
export const addColonyNativeCoverage = (previous: ColonyNativeEconomy | undefined, from: number, to: number): ColonyNativeEconomy => {
  if (!validColonyNativeEconomy(previous) || !clock(from) || !clock(to) || to < from)
    throw new Error("Invalid native colony economy coverage");
  const coverage: [number, number][] = [];
  const spans = [...previous?.coverage ?? [], ...(to > from ? [[from, to] as [number, number]] : [])].sort((a, b) => a[0] - b[0]);
  for (const span of spans) {
    const last = coverage.at(-1);
    if (last && span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
    else coverage.push([...span]);
  }
  if (coverage.length > 64) throw new Error("The colony needs its outstanding shipment coverage settled");
  return { version: 1, coverage, oreRemainder: previous?.oreRemainder ?? 0 };
};

/** Settle precisely the uncovered share of due slots; native production is never abstracted again. */
export const settleColonyNativeOre = (state: ColonyNativeEconomy, due: number, interval: number,
  hours: number, mines: number, food: number) => {
  if (!validColonyNativeEconomy(state) || !clock(due) || interval <= 0 || !Number.isSafeInteger(hours) || hours < 1)
    throw new Error("Invalid native colony shipment settlement");
  const from = due - interval, to = due + (hours - 1) * interval;
  const covered = state.coverage.reduce((sum, span) => sum + Math.max(0, Math.min(to, span[1]) - Math.max(from, span[0])), 0);
  const uncovered = Math.max(0, hours * interval - covered);
  const budget = state.oreRemainder + mines * COLONY_ORE_PER_MINE_HOUR * uncovered / interval;
  const whole = Math.floor(budget + 1e-9), ore = Math.min(whole, food);
  const coverage = state.coverage.filter(span => span[1] > to).map(span => [Math.max(to, span[0]), span[1]] as [number, number]);
  return { ore, food: ore, nativeEconomy: { version: 1 as const, coverage, oreRemainder: Math.max(0, budget - whole) } };
};
