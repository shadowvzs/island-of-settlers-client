import type { WorldData } from "../../world-data";

interface OreTransform {
  cx: number;
  cz: number;
  offsetX: number;
  offsetZ: number;
  scale: number;
}

/** Integer water filling preserves the exact ledger total, including saturated cells. */
const distribute = (total: number, weighted: Map<number, number>) => {
  if (total > weighted.size * 255)
    throw new Error(
      "This smaller ore footprint cannot hold its existing quantity. Use a larger size."
    );
  const result = new Map([...weighted.keys()].sort((a, b) => a - b).map((cell) => [cell, 0]));
  let remaining = total;
  while (remaining > 0) {
    const eligible = [...result.keys()].filter((cell) => result.get(cell)! < 255);
    const weightTotal = eligible.reduce((sum, cell) => sum + (weighted.get(cell) || 1), 0);
    const fractions: { cell: number; fraction: number }[] = [];
    const budget = remaining;
    for (const cell of eligible) {
      const exact = (budget * (weighted.get(cell) || 1)) / weightTotal;
      const allocated = Math.min(255 - result.get(cell)!, Math.floor(exact));
      result.set(cell, result.get(cell)! + allocated);
      remaining -= allocated;
      fractions.push({ cell, fraction: exact - Math.floor(exact) });
    }
    fractions.sort((a, b) => b.fraction - a.fraction || a.cell - b.cell);
    for (const { cell } of fractions) {
      if (!remaining) break;
      if (result.get(cell)! >= 255) continue;
      result.set(cell, result.get(cell)! + 1);
      remaining--;
    }
  }
  return result;
};

/** Inverse rasterization retains connected occupied areas; forward anchors retain thin/subcell arms.
 * Overlapping different zone IDs are refused instead of silently merging finite resources. */
export const transformOreCells = (
  world: WorldData,
  sourceCells: readonly number[],
  transform: OreTransform
) => {
  const groups = new Map<number, number[]>();
  for (const cell of sourceCells) {
    const id = world.mineZone[cell]!;
    const list = groups.get(id) ?? [];
    list.push(cell);
    groups.set(id, list);
  }
  const planned = new Map<number, { id: number; amount: number }>();
  const centers = new Map<number, { cellCount: number; centreX: number; centreZ: number }>();
  const sourceSet = new Set(sourceCells);
  for (const [id, cells] of groups) {
    const weights = new Map<number, number>();
    const put = (x: number, z: number, weight: number) => {
      if (x < 1 || z < 1 || x >= world.cellsX - 1 || z >= world.cellsZ - 1)
        throw new Error("The complete ore zone must remain inside the map.");
      weights.set(z * world.cellsX + x, Math.max(weights.get(z * world.cellsX + x) ?? 0, weight));
    };
    const positions = cells.map((cell) => ({
      x:
        transform.cx +
        ((cell % world.cellsX) + 0.5 - transform.cx) * transform.scale +
        transform.offsetX,
      z:
        transform.cz +
        (Math.floor(cell / world.cellsX) + 0.5 - transform.cz) * transform.scale +
        transform.offsetZ,
      amount: world.oreAmount[cell]!
    }));
    const lattice =
      transform.scale === 1 &&
      Number.isInteger(transform.offsetX) &&
      Number.isInteger(transform.offsetZ);
    for (const point of positions) put(Math.floor(point.x), Math.floor(point.z), point.amount);
    if (!lattice) {
      const left = Math.floor(Math.min(...positions.map((point) => point.x)) - transform.scale / 2);
      const right = Math.ceil(Math.max(...positions.map((point) => point.x)) + transform.scale / 2);
      const top = Math.floor(Math.min(...positions.map((point) => point.z)) - transform.scale / 2);
      const bottom = Math.ceil(
        Math.max(...positions.map((point) => point.z)) + transform.scale / 2
      );
      for (let z = top; z <= bottom; z++)
        for (let x = left; x <= right; x++) {
          const sx = Math.floor(
            transform.cx + (x + 0.5 - transform.cx - transform.offsetX) / transform.scale
          );
          const sz = Math.floor(
            transform.cz + (z + 0.5 - transform.cz - transform.offsetZ) / transform.scale
          );
          if (sx < 0 || sz < 0 || sx >= world.cellsX || sz >= world.cellsZ) continue;
          const source = sz * world.cellsX + sx;
          if (world.mineZone[source] === id) put(x, z, world.oreAmount[source]!);
        }
    }
    const total = cells.reduce((sum, cell) => sum + world.oreAmount[cell]!, 0);
    const amounts = lattice ? weights : distribute(total, weights);
    let sumX = 0,
      sumZ = 0;
    for (const [cell, amount] of amounts) {
      if (planned.has(cell) || (world.mineZone[cell] && !sourceSet.has(cell)))
        throw new Error(
          "The resized ore footprint overlaps a different finite deposit. Use more space or a larger size."
        );
      planned.set(cell, { id, amount });
      sumX += (cell % world.cellsX) + 0.5;
      sumZ += Math.floor(cell / world.cellsX) + 0.5;
    }
    centers.set(id, {
      cellCount: amounts.size,
      centreX: sumX / amounts.size,
      centreZ: sumZ / amounts.size
    });
  }
  return { centers, planned };
};
