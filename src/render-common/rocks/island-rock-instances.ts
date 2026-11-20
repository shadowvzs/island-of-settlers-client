import { overlapsSettlementGround } from "../../shared/settlement/settlement-ground-clearance";
import { createThemeSampler } from "../../shared/world/generation/theme-field";
import { getVertexCount } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";
import { collectChoppableTrees } from "../felling/felling-trees";
import type { Vec3 } from "../props/mesh-builder";
import type { RockInstance } from "./rock-instances";
import { placeRocks } from "./rock-placement";
import { createWorldRockTerrain, type RockTerrain } from "./rock-terrain";

/** Fully visible vertex fog (placement does not depend on it). */
/** Local stone tint shift of the world's theme field (warm sandstone where desert). */
export const createThemeTintShift = (world: WorldData) => {
  const theme = createThemeSampler(world, world.themeWeights);
  return (x: number, z: number) => theme.at(x, z).rockTint;
};

export const createClearFog = (world: WorldData) => new Float32Array(getVertexCount(world)).fill(1);

/** Tree trunk positions: rocks and pebbles keep clear of them. */
export const collectTrunks = (world: WorldData) =>
  collectChoppableTrees(world).map(([, tree]): Vec3 => [tree.x, tree.y, tree.z]);

const placedRocks = new WeakMap<WorldData, RockInstance[]>();
const clearanceMasks = new WeakMap<WorldData, Uint8Array | undefined>();
const keepSettlementClear = (world: WorldData, rocks: RockInstance[]) => {
  if (!world.settlementGroundClearance && !world.clearedStoneGround) return rocks;
  const kept = rocks.filter(rock => {
    const x = rock.axes.reduce((sum, axis) => sum + Math.abs(axis[0]), 0) / 2;
    const z = rock.axes.reduce((sum, axis) => sum + Math.abs(axis[2]), 0) / 2;
    return !overlapsSettlementGround(world, rock.centre[0] - x, rock.centre[2] - z,
      rock.centre[0] + x, rock.centre[2] + z);
  });
  return kept.length === rocks.length ? rocks : kept;
};

/** The rocks known for this world so far (placed or remembered), empty when none. */
export const getKnownRocks = (world: WorldData) => placedRocks.get(world) ?? [];

/** Rocks placed elsewhere (a loading worker) for this world: getIslandRocks reuses them. */
export const rememberIslandRocks = (world: WorldData, rocks: RockInstance[]) => {
  placedRocks.set(world, keepSettlementClear(world, rocks));
  clearanceMasks.set(world, world.settlementGroundClearance);
};

/**
 * Every rock of the island (deterministic per world, placed once): the renderers mesh them and
 * the animal navigation turns them into colliders. Placement does not read the fog.
 */
export const getIslandRocks = (
  world: WorldData,
  terrain: RockTerrain = createWorldRockTerrain(world, createClearFog(world))
) => {
  const known = placedRocks.get(world);
  if (known && clearanceMasks.get(world) === world.settlementGroundClearance) return known;
  const rocks = known ? keepSettlementClear(world, known) : placeIslandRocks(world, terrain);
  placedRocks.set(world, rocks);
  clearanceMasks.set(world, world.settlementGroundClearance);
  return rocks;
};

/** Places the rocks afresh (uncached; a terrain with an area places only there). */
export const placeIslandRocks = (world: WorldData, terrain: RockTerrain) =>
  keepSettlementClear(world, placeRocks(terrain, {
    keepClear: collectTrunks(world),
    seed: world.seed,
    tintShift: createThemeTintShift(world)
  }));
