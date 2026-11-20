import assert from "node:assert/strict";

/** Exact original normalized-Uint16 storage for four owned cloth weights.
 * Integer sum65535 makes the actual loader normalization idempotent; no channel conversion.
 */
export const integerClothSimplex = (values: readonly number[]) => {
  assert.equal(values.length, 4, "Owned cloth skin must retain exactly four weight slots");
  assert(values.every(value => Number.isFinite(value) && value >= 0), "Cloth weights must be finite and nonnegative");
  const total = values.reduce((sum, value) => sum + value, 0);
  assert(Math.abs(total - 1) < .0001, "Cloth fitting input must already lie on the normalized four-weight simplex");
  const scaled = values.map(value => value / total * 65535);
  const integers = scaled.map(Math.floor);
  const remainder = 65535 - integers.reduce((sum, value) => sum + value, 0);
  const order = scaled.map((value, slot) => ({ fraction: value - integers[slot]!, slot }))
    .sort((a, b) => b.fraction - a.fraction || a.slot - b.slot);
  // Re-encoding an exact integer profile can place all four scaled values one ulp below
  // their integers, so floating arithmetic may leave four units rather than three.
  assert(remainder >= 0 && remainder <= 4);
  for (let at = 0; at < remainder; at++) integers[order[at]!.slot]!++;
  assert.equal(integers.reduce((sum, value) => sum + value, 0), 65535);
  return { integers, weights: integers.map(value => value / 65535) };
};
