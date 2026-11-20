import { DMath } from "../math/deterministic-math";
import type { SettlementPoint } from "./settlement-types";

/**
 * Influence map of the smart commander (military AI mode 4, docs/archive/dated/military-motion-2026-10-13.md
 * section 8): every side's fighting strength spread over coarse cells, fading linearly to nothing
 * `INFLUENCE_RADIUS` cells away. The commander reads it for "how strong are we / they here" and
 * "where is it safe". Pure; rebuilt at each decision (a few thousand additions for 128 soldiers).
 */

/** Cell side (tiles). */
export const INFLUENCE_CELL = 4;
/** Influence reaches this many cells round a soldier. */
const INFLUENCE_RADIUS = 3;

export interface InfluenceMap {
  columns: number;
  rows: number;
  /** Strength per cell of each side. */
  layers: Map<number, Float32Array>;
}

export const createInfluenceMap = (cellsX: number, cellsZ: number): InfluenceMap => ({
  columns: Math.max(1, Math.ceil(cellsX / INFLUENCE_CELL)),
  layers: new Map(),
  rows: Math.max(1, Math.ceil(cellsZ / INFLUENCE_CELL))
});

export const influenceCellOf = (map: InfluenceMap, point: SettlementPoint) => {
  const column = Math.min(map.columns - 1, Math.max(0, Math.floor(point.x / INFLUENCE_CELL)));
  const row = Math.min(map.rows - 1, Math.max(0, Math.floor(point.z / INFLUENCE_CELL)));
  return row * map.columns + column;
};

/** Writes the centre of a cell into `out` (no allocation) and returns it. */
export const writeInfluenceCellCentre = (map: InfluenceMap, cell: number, out: SettlementPoint) => {
  out.x = ((cell % map.columns) + 0.5) * INFLUENCE_CELL;
  out.z = (Math.floor(cell / map.columns) + 0.5) * INFLUENCE_CELL;
  return out;
};

const layerOf = (map: InfluenceMap, faction: number) => {
  let layer = map.layers.get(faction);
  if (!layer) {
    layer = new Float32Array(map.columns * map.rows);
    map.layers.set(faction, layer);
  }
  return layer;
};

/** Clears every side's layer (the map keeps its layers for the next fill). */
export const clearInfluence = (map: InfluenceMap) => {
  for (const layer of map.layers.values()) layer.fill(0);
};

/** Spreads `strength` of `faction` at `point` over the cells round it. */
export const addInfluence = (map: InfluenceMap, faction: number, point: SettlementPoint, strength: number) => {
  const layer = layerOf(map, faction),
    centre = influenceCellOf(map, point);
  const column = centre % map.columns,
    row = Math.floor(centre / map.columns);
  for (let dz = -INFLUENCE_RADIUS; dz <= INFLUENCE_RADIUS; dz++)
    for (let dx = -INFLUENCE_RADIUS; dx <= INFLUENCE_RADIUS; dx++) {
      const x = column + dx,
        z = row + dz;
      if (x < 0 || z < 0 || x >= map.columns || z >= map.rows) continue;
      const share = 1 - DMath.hypot(dx, dz) / (INFLUENCE_RADIUS + 1);
      if (share > 0) layer[z * map.columns + x]! += strength * share;
    }
};

/**
 * Spreads the strength of every unit (`strengthOf`) over the cells round it (the layers are cleared first).
 * The units are read in place: no per-unit copy is made.
 */
export const fillInfluence = <Unit extends SettlementPoint & { faction: number }>(
  map: InfluenceMap,
  units: readonly Unit[],
  strengthOf: (unit: Unit) => number
) => {
  clearInfluence(map);
  for (const unit of units) addInfluence(map, unit.faction, unit, strengthOf(unit));
};

/** Strength of `faction` at a cell. */
export const ownInfluence = (map: InfluenceMap, faction: number, cell: number) =>
  map.layers.get(faction)?.[cell] ?? 0;

/** Strength of every side but `faction` at a cell. */
export const enemyInfluence = (map: InfluenceMap, faction: number, cell: number) => {
  let total = 0;
  for (const [side, layer] of map.layers) if (side !== faction) total += layer[cell]!;
  return total;
};

/** Own minus enemy strength per cell, from `faction`'s point of view (the debug overlay's grid). */
export const influenceBalance = (map: InfluenceMap, faction: number) => {
  const balance = new Float32Array(map.columns * map.rows);
  for (let cell = 0; cell < balance.length; cell++)
    balance[cell] = ownInfluence(map, faction, cell) - enemyInfluence(map, faction, cell);
  return balance;
};
