import { base64ToBytes, bytesToBase64 } from "../../../../island-of-settlers-shared/src/save-map-delta";
import { isSafeCount } from "../../../../island-of-settlers-shared/src/validation/index";
import type { SettlementSaveV1 } from "./settlement-save-state";

/**
 * Dense per-cell grids of a game save (fog, permanent sight, building occupancy) stored compactly:
 * a 1024 x 1024 map would otherwise carry millions of JSON numbers (research 12, S04). Every
 * decoder is strict: a wrong length, bad base64, a stray bit or an out-of-range value throws.
 */

/** Two bits per cell (values 0..2), four cells per byte, base64. */
export interface PackedFog { length: number; packed: string }
/** One bit per cell, eight cells per byte (the lowest bit is the first cell), base64. */
export interface PackedBits { bits: string; length: number }
/** The non-zero cells of a grid: `[gap since the previous index + 1 (the first: index + 1), value]`. */
export interface SparseCells { cells: number[]; length: number }

const FOG_VALUE_MAX = 2;
const FOG_BITS = 2;
const FOG_CELLS_PER_BYTE = 4;
const BITS_PER_BYTE = 8;
/** Occupancy: 1 building, 2 entrance. */
const OCCUPANCY_VALUE_MAX = 2;
/** With ruins (BD2): 3 marks a ruin cell (`RUIN_CELL`); the save validator checks it lies on a saved ruin. */
export const RUIN_OCCUPANCY_VALUE_MAX = 3;

const invalid = (what: string) => new Error(`Invalid saved ${what}`);


export const packFog = (fog: ArrayLike<number>): PackedFog => {
  const bytes = new Uint8Array(Math.ceil(fog.length / FOG_CELLS_PER_BYTE));
  for (let cell = 0; cell < fog.length; cell += 1) {
    const value = fog[cell]!;
    if (!Number.isInteger(value) || value < 0 || value > FOG_VALUE_MAX) throw invalid("fog");
    bytes[cell >> 2] = bytes[cell >> 2]! | (value << ((cell & 3) * FOG_BITS));
  }
  return { length: fog.length, packed: bytesToBase64(bytes) };
};

/** The fog of a save as one value per cell; `length` is the grid's cell count. */
export const unpackFog = (saved: unknown, length: number): Uint8Array => {
  const { length: savedLength, packed } = (saved ?? {}) as Partial<PackedFog>;
  if (savedLength !== length || typeof packed !== "string") throw invalid("fog");
  const bytes = base64ToBytes(packed);
  if (bytes.length !== Math.ceil(length / FOG_CELLS_PER_BYTE)) throw invalid("fog");
  const fog = new Uint8Array(length);
  for (let cell = 0; cell < length; cell += 1) {
    const value = (bytes[cell >> 2]! >> ((cell & 3) * FOG_BITS)) & 3;
    if (value > FOG_VALUE_MAX) throw invalid("fog");
    fog[cell] = value;
  }
  return fog;
};

/** One bit per cell: set where `values[cell] === matching`. */
export const packBits = (values: ArrayLike<number>, matching: number): PackedBits => {
  const bytes = new Uint8Array(Math.ceil(values.length / BITS_PER_BYTE));
  for (let cell = 0; cell < values.length; cell += 1) {
    if (values[cell] === matching) bytes[cell >> 3] = bytes[cell >> 3]! | (1 << (cell & 7));
  }
  return { bits: bytesToBase64(bytes), length: values.length };
};

/** The cells whose bit is set, as ascending indices (never more than `length` cells). */
export const unpackBitCells = (saved: unknown, length: number): number[] => {
  const { bits, length: savedLength } = (saved ?? {}) as Partial<PackedBits>;
  if (savedLength !== length || typeof bits !== "string") throw invalid("bit set");
  const bytes = base64ToBytes(bits);
  if (bytes.length !== Math.ceil(length / BITS_PER_BYTE)) throw invalid("bit set");
  const cells: number[] = [];
  for (let cell = 0; cell < bytes.length * BITS_PER_BYTE; cell += 1) {
    if (!(bytes[cell >> 3]! & (1 << (cell & 7)))) continue;
    if (cell >= length) throw invalid("bit set");
    cells.push(cell);
  }
  return cells;
};

/** A bit set whose bytes are already the packed layout (eight cells per byte, the lowest bit first). */
export const packBitSet = (bytes: Uint8Array, length: number): PackedBits =>
  ({ bits: bytesToBase64(bytes), length });

/** The bytes of a saved bit set of `length` cells; throws on a wrong length, bad base64 or a stray bit. */
export const unpackBitSet = (saved: unknown, length: number): Uint8Array => {
  const { bits, length: savedLength } = (saved ?? {}) as Partial<PackedBits>;
  if (savedLength !== length || typeof bits !== "string") throw invalid("bit set");
  const bytes = base64ToBytes(bits);
  if (bytes.length !== Math.ceil(length / BITS_PER_BYTE)) throw invalid("bit set");
  const spare = bytes.length * BITS_PER_BYTE - length;
  if (spare && bytes[bytes.length - 1]! >> (BITS_PER_BYTE - spare)) throw invalid("bit set");
  return bytes;
};

export const packSparseCells = (grid: ArrayLike<number>): SparseCells => {
  const cells: number[] = [];
  let previous = -1;
  for (let cell = 0; cell < grid.length; cell += 1) {
    const value = grid[cell]!;
    if (value === 0) continue;
    cells.push(cell - previous, value);
    previous = cell;
  }
  return { cells, length: grid.length };
};

/** Whether `saved` is a well formed sparse grid of `length` cells with values 1..`maxValue`. */
export const isSparseCells = (saved: unknown, length: number, maxValue = OCCUPANCY_VALUE_MAX) => {
  const { cells, length: savedLength } = (saved ?? {}) as Partial<SparseCells>;
  if (savedLength !== length || !Array.isArray(cells) || cells.length % 2 !== 0) return false;
  let index = -1;
  for (let pair = 0; pair < cells.length; pair += 2) {
    const gap = cells[pair], value = cells[pair + 1];
    if (!isSafeCount(gap) || gap < 1 || !isSafeCount(value) || value < 1 || value > maxValue) return false;
    index += gap;
    if (index >= length) return false;
  }
  return true;
};

export const unpackSparseCells = (saved: unknown, length: number, maxValue = OCCUPANCY_VALUE_MAX) => {
  if (!isSparseCells(saved, length, maxValue)) throw invalid("occupancy");
  const { cells } = saved as SparseCells;
  const grid = new Uint8Array(length);
  let index = -1;
  for (let pair = 0; pair < cells.length; pair += 2) {
    index += cells[pair]!;
    grid[index] = cells[pair + 1]!;
  }
  return grid;
};

interface WorkingOccupancy { grid: Uint8Array; source: SparseCells }
const workingOccupancy = new WeakMap<object, WorkingOccupancy>();

/**
 * The building occupancy of a saved settlement as one value per cell, decoded once per save
 * (offline readers ask for it repeatedly). The grid is the working copy: a writer changes it and
 * then calls `flushSavedOccupancy`, readers see the writers' changes.
 */
export const savedOccupancy = (settlement: Pick<SettlementSaveV1, "occupied" | "world">) => {
  const cached = workingOccupancy.get(settlement);
  if (cached?.source === settlement.occupied) return cached.grid;
  const { cellsX, cellsZ } = settlement.world;
  const grid = unpackSparseCells(settlement.occupied, cellsX * cellsZ);
  workingOccupancy.set(settlement, { grid, source: settlement.occupied });
  return grid;
};

/** Writes the working occupancy back into the settlement's saved (sparse) form. */
export const flushSavedOccupancy = (settlement: Pick<SettlementSaveV1, "occupied" | "world">) => {
  const working = workingOccupancy.get(settlement);
  if (!working) return;
  settlement.occupied = packSparseCells(working.grid);
  working.source = settlement.occupied;
};
