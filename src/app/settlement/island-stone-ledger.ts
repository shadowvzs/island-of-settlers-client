/** Island quarry amounts that survive a save: worked boulders, formations and mountain seams. */
export interface IslandStoneLedgerState {
  /** Formation chunks: [id, centre x, centre z, remaining]; ids stay stable across reloads. */
  formations: [number, number, number, number][];
  /** The next formation id handed out (negative, counting down). */
  nextId: number;
  /** Quarry boulder props: [prop id, remaining]. */
  props: [number, number][];
  /** Mountain seams: [seam id, remaining]. */
  seams: [number, number][];
}

/** Formation ids live above the mountain seam ids (-1_000_000 and below). */
export const FORMATION_ID_FLOOR = -1_000_000;

const amount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;
const formationId = (value: unknown) =>
  Number.isSafeInteger(value) && (value as number) < 0 && (value as number) > FORMATION_ID_FLOOR;
const tuples = (value: unknown, length: number, valid: (entry: unknown[]) => boolean) =>
  Array.isArray(value) &&
  value.every(entry => Array.isArray(entry) && entry.length === length && valid(entry));

const validFormation = ([id, x, z, remaining]: unknown[]) =>
  formationId(id) && Number.isFinite(x) && Number.isFinite(z) && amount(remaining);
const validProp = (propCount: number) => ([id, remaining]: unknown[]) =>
  Number.isSafeInteger(id) && (id as number) >= 0 && (id as number) < propCount && amount(remaining);
const validSeam = ([id, remaining]: unknown[]) =>
  Number.isSafeInteger(id) && (id as number) <= FORMATION_ID_FLOOR && amount(remaining);

export const validIslandStoneLedger = (value: unknown, propCount: number) => {
  if (!value || typeof value !== "object") return false;
  const { formations, nextId, props, seams } = value as Record<string, unknown>;
  return formationId(nextId) &&
    tuples(formations, 4, validFormation) &&
    tuples(props, 2, validProp(propCount)) &&
    tuples(seams, 2, validSeam);
};

/** Formation identity is its placed position, deterministic per world. */
export const formationKey = (x: number, z: number) => `${Math.round(x * 1000)}:${Math.round(z * 1000)}`;
