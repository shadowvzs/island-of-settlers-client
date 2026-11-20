import {
  createCellRandom,
  deriveSeed,
  type Random} from "../../shared/world/rng";
import { NO_MINE_ZONE, type WorldData } from "../../shared/world/world-data";
import { createStone, type StoneRequest } from "./meadow-stones";
import type { RockInstance } from "./rock-instances";
import { createPebble } from "./rock-pebbles";
import type { RockTerrain } from "./rock-terrain";

/** Loose chips per mine cell (render only, small-rock LOD) and their contact strength. */
const CHIPS_PER_CELL = 1.6;
const CHIP_CONTACT = 0.45;
/** Mine stones are a pale cool grey (rock tint -1 cool .. 1 warm). */
const MINE_TINT = -0.35;

export interface MineStoneOptions {
  /** Only stones standing in cells that pass (map editor rebuilds of some chunks); all if unset. */
  keepCell?: (cellX: number, cellZ: number) => boolean;
  seed: number;
  terrain: RockTerrain;
}

const keepsCell = (options: MineStoneOptions, cellX: number, cellZ: number) =>
  options.keepCell?.(cellX, cellZ) ?? true;

/** Loose grey chips scattered over every mine cell (every zone, barren or not). */
const scatterChips = (world: WorldData, options: MineStoneOptions) => {
  const { seed, terrain } = options;
  const chipSeed = deriveSeed(seed, "mine-chips");
  const chips: RockInstance[] = [];
  for (let cell = 0; cell < world.mineZone.length; cell += 1) {
    const cellX = cell % world.cellsX;
    const cellZ = Math.floor(cell / world.cellsX);
    if (world.mineZone[cell] === NO_MINE_ZONE || !keepsCell(options, cellX, cellZ)) continue;
    const random = createCellRandom(chipSeed, cell);
    const tint = () => MINE_TINT + (random() - 0.5) * 0.4;
    const count = Math.floor(CHIPS_PER_CELL + random());
    for (let index = 0; index < count; index += 1) {
      const x = cellX + random();
      const z = cellZ + random();
      chips.push(createPebble([x, z], CHIP_CONTACT, random, { seed, terrain, tint, trunks: [] }));
    }
  }
  return chips;
};

/** A boulder showing its ore (coal seams, rust, gold veins, granite) on mine gravel. */
export const createOreStone = (
  terrain: RockTerrain,
  random: Random,
  request: StoneRequest,
  ore: number
): RockInstance => ({ ...createStone(terrain, () => MINE_TINT, random, request), moss: 0, ore });

/** Deterministic loose mine chips only. Surveyed deposits are marked by movable signposts. */
export const createMineStones = (world: WorldData, options: MineStoneOptions): RockInstance[] =>
  scatterChips(world, options);
