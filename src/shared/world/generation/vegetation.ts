import { createBuildCap, createBuildClass } from "../build-class";
import { getFootprintShortfall } from "../building-space";
import type { GridSize } from "../grid-geometry";
import { type Clearing,paintClearings, pickClearings, planClearings } from "./clearings";
import { createCellTerrain } from "./gameplay";
import { addRockPropPatches } from "./ground-chain";
import { type BiomeFields, createSplat, fadeForest, type MaterialInputs } from "./materials";
import { addMineClearing, applyMineGround } from "./mine-ground";
import { placeProps, TREE_SPACING } from "./props";
import { createRoughGround } from "./rough-ground";

/**
 * Ground (with the mine fields), props (stones in their soil patches) and the gameplay layers
 * they leave, with the given clearings cut; the mine fields and the band around the massifs are
 * cleared like clearings.
 */
const growVegetation = (
  grid: GridSize,
  seed: number,
  inputs: MaterialInputs,
  biome: BiomeFields,
  settlementClearing: Float32Array,
  treeDensity: number,
  treeSpacing: number
) => {
  const clearing = addMineClearing(settlementClearing, inputs.massifFoot);
  const meadowBiome = fadeForest(biome, clearing);
  const splat = createSplat(grid, seed, inputs, meadowBiome);
  applyMineGround(grid, splat,
    { coastDistance: inputs.coastDistance, contact: inputs.massifContact, mineGround: inputs.mineGround });
  const props = placeProps(grid, seed, { ...inputs, clearing }, meadowBiome, splat, treeDensity, treeSpacing);
  addRockPropPatches(grid, seed, { props, splat }, inputs.theme);
  const { heights, mineZone, riverDistance, waterDepth } = inputs;
  const { blocking, slopeClass } = createCellTerrain(grid, { heights, props, waterDepth });
  const rough = createRoughGround(grid, { heights, riverDistance, splat });
  const buildCap = createBuildCap(grid, { ...rough, mineZone, slopeClass });
  const layers = { ...grid, blocking, buildCap, slopeClass };
  const buildClass = createBuildClass(layers);
  /** The guarantee counts the land as it is once the trees around are felled (woodcutters). */
  const guaranteeClass = createBuildClass(layers, false);
  return { blocking, buildCap, buildClass, guaranteeClass, props, slopeClass, splat };
};

/**
 * Splat, props and gameplay layers around settlement clearings, planned against the result: the
 * vegetation grows with the start clearing first; while the island falls short of its footprint
 * minimums, the candidate clearings with the best real gain are cut for the shortfall and the
 * vegetation grows again (one pass on most islands, two or three on dense forests).
 */
export const placeVegetation = (
  grid: GridSize,
  seed: number,
  inputs: MaterialInputs,
  biome: BiomeFields,
  start: { x: number; z: number },
  treeDensity = 1,
  treeSpacing = TREE_SPACING
) => {
  const { heights, mineZone, riverDistance, waterDepth } = inputs;
  const terrain = { forest: biome.forest, heights, mineZone, riverDistance, waterDepth };
  const plan = planClearings(grid, seed, terrain, start);
  let cut: Clearing[] = [plan.start];
  let candidates = plan.further;
  for (;;) {
    const vegetation = growVegetation(grid, seed, inputs, biome, paintClearings(grid, seed, cut), treeDensity,
      treeSpacing);
    const grown = { ...grid, buildClass: vegetation.guaranteeClass, heights };
    const shortfall = getFootprintShortfall(grown, plan.landCells);
    if (shortfall === 0) return vegetation;
    const extra = pickClearings(plan.terrain, grown, candidates, shortfall);
    if (extra.length === 0) return vegetation;
    cut = [...cut, ...extra];
    candidates = candidates.filter((clearing) => !extra.includes(clearing));
  }
};
