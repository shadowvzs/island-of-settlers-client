/**
 * A computer faction's discovered cells (enemy economy AI plan §3.2, no omniscience): one bit per map cell (the lowest
 * bit of byte `cell >> 3` is the first), set once the faction's vision ever covered the cell and never cleared. The
 * vision layer stamps it while it stamps the faction's sight disks (`faction-vision.ts`), so a reload that restamps
 * the restored positions sets no new bit: the bits saved already hold every cell seen at save time.
 */
export type DiscoveryBits = Uint8Array;

export const createDiscoveryBits = (cells: number): DiscoveryBits => new Uint8Array(Math.ceil(cells / 8));

export const isCellDiscovered = (bits: Readonly<DiscoveryBits>, cell: number) =>
  ((bits[cell >> 3] ?? 0) & (1 << (cell & 7))) !== 0;

const markCell = (bits: DiscoveryBits, cell: number) => {
  bits[cell >> 3] = bits[cell >> 3]! | (1 << (cell & 7));
};

/** Sets the cells `first..last` (one row of a sight disk). */
export const markDiscoveredRow = (bits: DiscoveryBits, first: number, last: number) => {
  for (let cell = first; cell <= last; cell++) markCell(bits, cell);
};

/** Sets every cell the faction's vision counters see now (a faction that starts tracking mid-game). */
export const markSeenCells = (bits: DiscoveryBits, layer: Readonly<Uint16Array> | undefined) => {
  if (!layer) return;
  for (let cell = 0; cell < layer.length; cell++) if (layer[cell]) markCell(bits, cell);
};

/** A territory source: a building's centre and the radius of the land it claims. */
interface ClaimedArea {
  radius: number;
  x: number;
  z: number;
}

/**
 * Sets the faction's own land (plan §3.2: own state is fully known): the cells inside each source's box that the
 * territory marks owned (`owned`, one byte per cell).
 */
export const markOwnedLand = (
  bits: DiscoveryBits, owned: Readonly<Uint8Array>, cellsX: number, sources: readonly Readonly<ClaimedArea>[]
) => {
  const cellsZ = owned.length / cellsX;
  for (const { radius, x, z } of sources) {
    const left = Math.max(0, Math.floor(x - radius)), right = Math.min(cellsX - 1, Math.ceil(x + radius));
    const top = Math.max(0, Math.floor(z - radius)), bottom = Math.min(cellsZ - 1, Math.ceil(z + radius));
    for (let row = top; row <= bottom; row++)
      for (let cell = row * cellsX + left; cell <= row * cellsX + right; cell++) if (owned[cell]) markCell(bits, cell);
  }
};
