import type { WorldOptions } from "./generate-world";

/**
 * The default generator options, apart from the generator itself: page boot reads the default seed without
 * loading world generation (and the settlement modules it reaches).
 */
export const DEFAULT_WORLD_OPTIONS: WorldOptions = {
  cellsX: 256,
  cellsZ: 256,
  erosionDroplets: 30_000,
  forest: 1,
  landform: null,
  mountains: 1,
  rivers: 2,
  seed: 1234,
  theme: "meadow",
  themeLayout: "uniform"
};
