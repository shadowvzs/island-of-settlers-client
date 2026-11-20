import { MARBLE_DEPOSIT_QUANTITY } from "../../shared/balance/resources";
import type { ColonyStone } from "../../shared/world/colony-resource-tiers";
import { sampleBilinear, sampleSmooth } from "../../shared/world/grid-geometry";
import type { MarbleDeposit } from "../../shared/world/marble-deposit";
import { createCellRandom, deriveSeed } from "../../shared/world/rng";
import { PROP, type WorldData } from "../../shared/world/world-data";
import { createPropStones } from "./meadow-stones";
import { buildRockMesh } from "./rock-mesh";
import { createRockLibrary, type RockLibrary } from "./rock-shapes";
import type { RockTerrain } from "./rock-terrain";

/**
 * Stone material deposits look like the quarry stone boulders: the same boulder cluster (a main stone with
 * companions, rock shapes and rock shader), recoloured per material. The cluster shrinks as it is worked.
 *
 * Base boulder albedo in the rock shader's display-space lighting: the shader keeps the boulder's
 * luminance detail and replaces its chroma with this tint. The four materials separate by both
 * hue and lightness, so they still read apart at gameplay distance and under the cool moonlight:
 * basalt near-black blue-grey, granite mid cool grey-pink, limestone warm sandy cream, marble
 * bright cool white. The map editor deposit icons are rendered from these same values; keep them
 * apart.
 */
export const STONE_DEPOSIT_TINTS: Readonly<Record<ColonyStone, readonly [number, number, number]>> = {
  basalt: [0.22, 0.24, 0.29],
  granite: [0.62, 0.55, 0.56],
  limestone: [0.87, 0.8, 0.64],
  marble: [0.88, 0.91, 0.96]
};

/** Cluster scale per size state: full, worked, nearly exhausted (worked out: gone until it respawns). */
const SIZE_SCALES = [1.35, 1.1, 0.85] as const;

/** 0 full .. 2 nearly exhausted: the cluster is rebuilt only when this changes. */
export const depositSizeState = (remaining: number) => {
  if (remaining <= MARBLE_DEPOSIT_QUANTITY / 4) return 2;
  return remaining <= MARBLE_DEPOSIT_QUANTITY * 0.65 ? 1 : 0;
};

/** A light rock terrain for a few clusters (no mountain field: deposits sit on buildable ground). */
export const createDepositRockTerrain = (world: WorldData): RockTerrain => ({
  cellsX: world.cellsX,
  cellsZ: world.cellsZ,
  height: (x, z) => sampleSmooth(world, world.heights, x, z),
  moisture: (x, z) => sampleBilinear(world, world.moisture, x, z) / 255,
  mountain: () => 0,
  visibility: () => 1
});

let library: RockLibrary | null = null;
const getLibrary = () => {
  library ??= createRockLibrary();
  return library;
};

/** The deposit's boulders: deterministic per world seed and deposit id, sized by its amount. */
const createClusterStones = (deposit: MarbleDeposit, seed: number, terrain: RockTerrain) => {
  const random = createCellRandom(deriveSeed(seed, "stone-deposits"), deposit.id);
  const scale = SIZE_SCALES[depositSizeState(deposit.remaining)];
  const place = { scale, x: deposit.x, yaw: random() * Math.PI * 2, z: deposit.z };
  return createPropStones(PROP.largeRock, place, { random, terrain, tint: () => 0.5 });
};

/** Rock mesh data of one deposit cluster; `low` is the cheap Minimal variant (low detail shapes). */
export const buildDepositClusterMesh = (
  deposit: MarbleDeposit, seed: number, terrain: RockTerrain, low: boolean
) => buildRockMesh(createClusterStones(deposit, seed, terrain), getLibrary(), terrain,
  { detail: low ? "low" : "auto", skipRubble: false });
