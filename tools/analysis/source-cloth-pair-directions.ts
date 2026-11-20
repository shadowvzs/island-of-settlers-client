/** Exact max-min advance of two bounded, homogeneous skin-transfer directions. A positive
 * optimum touches the unit square boundary; inspect its line intersections, never random steps. */
export const bestPairedClothAdvance = (first: readonly number[], second: readonly number[]) => {
  if (!first.length || first.length !== second.length || ![...first, ...second].every(Number.isFinite))
    throw new Error("Matching finite cloth support rows are required");
  let best = { first: 0, second: 0, advance: 0 };
  const inspect = (a: number, b: number) => {
    if (a < 0 || a > 1 || b < 0 || b > 1) return;
    const advance = Math.min(...first.map((value, row) => value * a + second[row]! * b));
    if (advance > best.advance) best = { first: a, second: b, advance };
  };
  inspect(1, 0); inspect(0, 1); inspect(1, 1);
  for (let a = 0; a < first.length; a++) for (let b = a + 1; b < first.length; b++) {
    const firstSlope = first[a]! - first[b]!, secondSlope = second[a]! - second[b]!;
    if (Math.abs(firstSlope) > 1e-15) inspect((second[b]! - second[a]!) / firstSlope, 1);
    if (Math.abs(secondSlope) > 1e-15) inspect(1, (first[b]! - first[a]!) / secondSlope);
  }
  return best;
};
