import { colonyResourcePair } from "../colony-resource-tiers";
import { createPatchNoise, createSpeciesNoise, type PropSample } from "../generation/prop-rules";
import { createThemeSampler } from "../generation/theme-field";
import { chooseSoftwoodSpecies } from "../generation/tree-rules";
import { sampleBilinear, sampleSmooth } from "../grid-geometry";
import { getWorldNationAffinity } from "../nation-terrain-affinity";
import { createRandom, deriveSeed } from "../rng";
import { BLOCKING, MATERIAL, MATERIAL_COUNT, PROP, SLOPE, type WorldData } from "../world-data";

/** Rootable land, independent of a renderer or a forester's work reservations. */
export const isTreePlantingTerrain = (world: WorldData, x: number, z: number) => {
  if (x < 0 || z < 0 || x >= world.cellsX || z >= world.cellsZ) return false;
  const cell = Math.floor(z) * world.cellsX + Math.floor(x);
  if (
    !world.walkCost[cell] ||
    world.blocking[cell] !== BLOCKING.free ||
    world.slopeClass[cell]! > SLOPE.gentle ||
    world.buildClass[cell]! < 2 ||
    world.buildClass[cell]! > 4
  )
    return false;
  // A rendered rocky or submerged root zone must not accept a sapling.
  if (world.waterDepth && sampleBilinear(world, world.waterDepth, x, z) > 0) return false;
  if (world.coastDistance && sampleBilinear(world, world.coastDistance, x, z) < 1.6) return false;
  if (!world.splat) return true;
  const vertex = Math.round(z) * (world.cellsX + 1) + Math.round(x);
  const share = (material: number) => (world.splat[vertex * MATERIAL_COUNT + material] ?? 0) / 255;
  return share(MATERIAL.rock) < 0.4 && share(MATERIAL.mine) < 0.4 && share(MATERIAL.gravel) < 0.55;
};

/** The same site/species rules as generated trees, sampled from the current edited world. */
export const createPlantedTreeSpecies = (world: WorldData) => {
  const themes = createThemeSampler(world, world.themeWeights, 1, true, getWorldNationAffinity(world));
  const species = createSpeciesNoise(world.seed);
  const patches = createPatchNoise(world.seed);
  const random = createRandom(deriveSeed(world.seed, "forester-species"));
  return (x: number, z: number) => {
    if (world.colonyResourceTier !== undefined) return colonyResourcePair(world.colonyResourceTier).treeKind;
    const vertex = Math.round(z) * (world.cellsX + 1) + Math.round(x);
    const material = (kind: number) => (world.splat[vertex * MATERIAL_COUNT + kind] ?? 0) / 255;
    const height = sampleSmooth(world, world.heights, x, z);
    const coast = sampleBilinear(world, world.coastDistance, x, z);
    const sample: PropSample = {
      cluster: 0,
      coast,
      curvature: 0,
      depth: 0,
      exposure: 0,
      forest: material(MATERIAL.forestFloor),
      forestSlopeX: 0,
      forestSlopeZ: 0,
      grain: 0,
      grove: species(x + 70, z + 70),
      heatLoad: 0.5,
      height,
      moisture: sampleBilinear(world, world.moisture, x, z) / 255,
      // Persisted ground identifies the mountain foot; elevation supplies the upland band.
      mountainDistance: material(MATERIAL.mine) > 0 ? 2 : 20,
      patches: patches(x, z),
      plateau: 0,
      riverDistance: sampleBilinear(world, world.riverDistance, x, z),
      rock: material(MATERIAL.rock),
      rockSkin: 0,
      sand: material(MATERIAL.sand),
      seaDistance: coast,
      slope: 0,
      species: species(x, z),
      stand: 0,
      surfaceSlope: 0,
      trunkDistance: 3,
      vegetation: themes.at(x, z).vegetation
    };
    const chosen = chooseSoftwoodSpecies(sample, random);
    // Regrowth on new expedition maps follows the same ecology as their initial timber.
    // Consume the normal species draw first so the original planting RNG stream stays intact.
    if (world.expeditionKind && world.expeditionTheme === "tropical") return PROP.palmTree;
    if (world.expeditionKind && ["forest", "swamp"].includes(world.expeditionTheme ?? ""))
      return PROP.coniferTree;
    if (world.expeditionKind && world.expeditionTheme === "winter" && chosen === PROP.palmTree)
      return PROP.coniferTree;
    return chosen;
  };
};
