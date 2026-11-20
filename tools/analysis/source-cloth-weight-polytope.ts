/** Vertices of four normalized, nonnegative skin weights inside their original L1 trust region.
 * Eliminate w3; all constraint normals are small integers, avoiding near-singular geometry fits. */
export const sourceClothWeightVertices = (source: readonly number[], radius: number) => {
  if (source.length !== 4 || radius < 0) throw new Error("Four source weights and a nonnegative radius are required");
  const total = source.reduce((sum, weight) => sum + weight, 0), seed = source.map(weight => weight / total);
  const constraints = [
    { a: [-1, 0, 0], b: 0 }, { a: [0, -1, 0], b: 0 }, { a: [0, 0, -1], b: 0 }, { a: [1, 1, 1], b: 1 },
  ];
  for (let mask = 0; mask < 16; mask++) {
    const sign = [0, 1, 2, 3].map(slot => mask & (1 << slot) ? 1 : -1);
    const a = [0, 1, 2].map(slot => sign[slot]! - sign[3]!);
    if (a.every(value => value === 0)) continue;
    constraints.push({ a, b: radius + sign.reduce((sum, value, slot) => sum + value * seed[slot]!, 0) - sign[3]! });
  }
  const determinant = (a: number[], b: number[], c: number[]) =>
    a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) - a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!)
      + a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!);
  const vertices = new Map<string, number[]>();
  for (let i = 0; i < constraints.length; i++) for (let j = i + 1; j < constraints.length; j++)
    for (let k = j + 1; k < constraints.length; k++) {
      const rows = [constraints[i]!, constraints[j]!, constraints[k]!];
      const matrix = rows.map(row => row.a), det = determinant(matrix[0]!, matrix[1]!, matrix[2]!);
      if (det === 0) continue;
      const values = [0, 1, 2].map(column => {
        const replaced = matrix.map((row, index) => row.map((value, at) => at === column ? rows[index]!.b : value));
        return determinant(replaced[0]!, replaced[1]!, replaced[2]!) / det;
      });
      if (!constraints.every(row => row.a.reduce((sum, value, column) => sum + value * values[column]!, 0) <= row.b + 1e-12))
        continue;
      const weights = [...values, 1 - values.reduce((sum, value) => sum + value, 0)];
      vertices.set(weights.map(value => Math.round(value * 1e10)).join(","), weights);
    }
  return [...vertices.values()];
};
