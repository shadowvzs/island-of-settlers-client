import { COIN_DIAMETER, COIN_THICKNESS } from "../wares/ware-coin-recipe";

/** A presentation container, not a new ware or a grant of coins. Metres/world cells. */
export const COIN_CHEST = Object.freeze({
  capacity: 250,
  depth: .38,
  height: .238,
  width: .54,
  floor: .024,
  wall: .022,
  /** Bulk cargo coins reuse the stylised loose-coin form at a consistent presentation scale. */
  coinScale: .64,
  rimClearance: .014
});
export const CHEST_COIN_DIAMETER = COIN_DIAMETER * COIN_CHEST.coinScale;
export const CHEST_COIN_THICKNESS = COIN_THICKNESS * COIN_CHEST.coinScale;

export interface ChestCoin {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  roll: number;
  layer: number;
  column: number;
  top: boolean;
}

const validateUnits = (units: number) => {
  if (!Number.isSafeInteger(units) || units < 0 || units > COIN_CHEST.capacity)
    throw new Error("Coin chest quantity must be an integer from 0 to 250");
};
const noise = (seed: number) => {
  const value = Math.sin(seed * 12.9898 + 78.233) * 43758.5453;
  return value - Math.floor(value);
};

/** A finite real count of packed discs. Rendering may omit covered lower layers, never add coins. */
export const createCoinChestPacking = (units: number): ChestCoin[] => {
  validateUnits(units);
  const columns: { x: number; z: number }[] = [];
  const spacing = CHEST_COIN_DIAMETER + .003;
  for (let row = 0; row < 4; row++) {
    const count = row % 2 === 0 ? 5 : 4;
    for (let column = 0; column < count; column++) columns.push({
      x: (column - (count - 1) / 2) * spacing,
      z: (row - 1.5) * spacing * Math.sqrt(3) / 2
    });
  }
  // Equal-depth packing avoids loose heaps or implausibly vertical unsupported coin towers.
  const order = columns.map((_, index) => index).sort((a, b) => noise(a + 8) - noise(b + 8));
  const heights = columns.map(() => Math.floor(units / columns.length));
  for (let index = 0; index < units % columns.length; index++) heights[order[index]!]!++;
  const coins: ChestCoin[] = [];
  for (let column = 0; column < columns.length; column++) {
    const point = columns[column]!;
    for (let layer = 0; layer < heights[column]!; layer++) {
      const top = layer === heights[column]! - 1;
      const pitch = top ? (noise(column * 3 + 9) - .5) * .08 : 0;
      const roll = top ? (noise(column * 3 + 10) - .5) * .08 : 0;
      const lift = Math.sin(Math.hypot(pitch, roll)) * CHEST_COIN_DIAMETER / 2;
      coins.push({ ...point, column, layer, top, pitch, roll,
        yaw: noise(column * 79 + layer) * Math.PI * 2,
        y: COIN_CHEST.floor + layer * CHEST_COIN_THICKNESS + CHEST_COIN_THICKNESS / 2 + lift });
    }
  }
  return coins;
};

/** Covered layers remain represented in the exact count, without spending GPU triangles on them. */
export const visibleChestCoins = (packing: readonly ChestCoin[], detailed: boolean) => {
  const layers = new Map<number, number>();
  for (const coin of packing) layers.set(coin.column, Math.max(layers.get(coin.column) ?? -1, coin.layer));
  const depth = detailed ? 2 : 1;
  return packing.filter(coin => coin.layer > layers.get(coin.column)! - depth);
};

/** Ships always use chests; land bulk selection remains a separately configured future policy. */
export const splitShipCoinChests = (units: number): number[] => {
  if (!Number.isSafeInteger(units) || units < 0) throw new Error("Invalid ship coin quantity");
  const full = Math.floor(units / COIN_CHEST.capacity);
  if (Math.ceil(units / COIN_CHEST.capacity) > 10_000)
    throw new Error("Coin shipment exceeds bounded chest manifest");
  const result = Array<number>(full).fill(COIN_CHEST.capacity);
  if (units % COIN_CHEST.capacity) result.push(units % COIN_CHEST.capacity);
  return result;
};
