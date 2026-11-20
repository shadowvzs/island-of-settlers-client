export interface ClothHalfspace { coefficients: number[]; target: number }

/** Bounded convex optimization over a product of source trust polytopes. Exact support
 * directions and a monotone line derivative replace unrelated weight-grid trials. Failure to
 * converge is reported as a residual, never as a general impossibility certificate. */
export const solveConnectedClothHalfspaces = (corners: readonly number[][][], start: readonly number[],
  rows: readonly ClothHalfspace[], limit = 5000) => {
  const dot = (a: readonly number[], b: readonly number[]) => a.reduce((sum, value, at) => sum + value * b[at]!, 0);
  const normalized = rows.map(row => {
    const a = [...row.coefficients]; let target = row.target;
    corners.forEach((group, index) => {
      const size = group[0]!.length, offset = index * size;
      const mean = a.slice(offset, offset + size).reduce((sum, value) => sum + value, 0) / size;
      for (let slot = 0; slot < size; slot++) a[offset + slot]! -= mean;
      target -= mean;
    });
    const scale = Math.max(1e-8, Math.hypot(...a));
    return { coefficients: a.map(value => value / scale), target: target / scale };
  });
  let weights = [...start], iterations = 0;
  for (; iterations < limit; iterations++) {
    if (rows.every(row => row.target - dot(row.coefficients, weights) <= 1e-7)) break;
    const gradient = weights.map(() => 0);
    for (const row of normalized) {
      const residual = Math.max(0, row.target - dot(row.coefficients, weights));
      row.coefficients.forEach((value, at) => { gradient[at]! -= 2 * residual * value; });
    }
    let offset = 0;
    const support = corners.flatMap(group => {
      const local = gradient.slice(offset, offset + group[0]!.length); offset += local.length;
      return group.reduce((best, corner) => dot(corner, local) < dot(best, local) ? corner : best);
    });
    const direction = support.map((value, at) => value - weights[at]!);
    const derivative = (fraction: number) => normalized.reduce((sum, row) => {
      const slope = dot(row.coefficients, direction);
      return sum - 2 * Math.max(0, row.target - dot(row.coefficients, weights) - fraction * slope) * slope;
    }, 0);
    if (derivative(0) >= -1e-18) break;
    let low = 0, high = 1;
    if (derivative(1) < 0) low = 1;
    else for (let step = 0; step < 32; step++) {
      const middle = (low + high) / 2;
      if (derivative(middle) < 0) low = middle; else high = middle;
    }
    const fraction = (low + high) / 2;
    weights = weights.map((value, at) => value + fraction * direction[at]!);
  }
  return { weights, iterations,
    dualWeights: normalized.map(row => Math.max(0, row.target - dot(row.coefficients, weights)))
      .map((value, at) => {
        const original = rows[at]!, projected = [...original.coefficients];
        corners.forEach((group, index) => {
          const offset = index * group[0]!.length, size = group[0]!.length;
          const mean = projected.slice(offset, offset + size).reduce((sum, value) => sum + value, 0) / size;
          for (let slot = 0; slot < size; slot++) projected[offset + slot]! -= mean;
        });
        return value / Math.max(1e-8, Math.hypot(...projected));
      }),
    maximumViolation: Math.max(0, ...rows.map(row => row.target - dot(row.coefficients, weights))),
    feasible: rows.every(row => row.target - dot(row.coefficients, weights) <= 1e-7) };
};
