import { DMath } from "../math/deterministic-math";

export type ShipTrigonometry = Pick<typeof DMath, "sin" | "cos">;
const NEGATIVE_ZERO = Symbol("negative zero");
const MAX_ENTRIES = 4096;

/** Per-search exact arithmetic reuse. No angle reduction, quantization or persistent cache warmth. */
export const createShipTrigMemo = (): ShipTrigonometry => {
  const memoize = (calculate: (angle: number) => number) => {
    const values = new Map<number | typeof NEGATIVE_ZERO, number>();
    return (angle: number) => {
      const key = Object.is(angle, -0) ? NEGATIVE_ZERO : angle;
      const known = values.get(key);
      if (known !== undefined) return known;
      const result = calculate(angle);
      // Eviction changes work only; a repeated exact argument always calls the same DMath operation.
      if (values.size >= MAX_ENTRIES) values.clear();
      values.set(key, result);
      return result;
    };
  };
  return { cos: memoize(DMath.cos), sin: memoize(DMath.sin) };
};
