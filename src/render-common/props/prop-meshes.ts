import type { Random } from "../../shared/world/rng";
import { PROP } from "../../shared/world/world-data";
import { profileStep } from "../load-profile";
import { ADVENTURE_PROP } from "./adventure-prop-kinds";
import { createIslandTreePropMesh } from "./island-trees";
import { MeshBuilder, type PropMesh } from "./mesh-builder";
import { createBiomeGrassMesh } from "./plants/biome-grass-mesh";
import { createCactus } from "./plants/cactus";
import { createCattail } from "./plants/cattail-model";
import { createFlowerClump, createThistle, createWildflower } from "./plants/field-flowers";
import {
  createClover,
  createDryTuft,
  createFieldShrub,
  createFieldWeed,
  createSeedGrass,
  createShortGrass,
  createTallGrass
} from "./plants/field-grasses";
import {
  createBerryBush,
  createBroadleafShrub,
  createFern,
  createSapling,
  createWoodyShrub
} from "./plants/forest-plants";
import { createMushrooms } from "./plants/mushrooms";
import {
  createReeds,
  createRiverShrub,
  createSedge,
  createWillowShrub
} from "./plants/riverbank-plants";
import { createSparseSwampTree } from "./plants/swamp-tree";
import { createWaterLily } from "./plants/water-lily";
import { COVER, getVariantCount, PROP_KIND_COUNT } from "./prop-mesh-layout";
import { propMeshRandom, treeModelSeed } from "./prop-mesh-seed";
import { createSeashell } from "./shells/bivalve-shells";
import { createOpenShell } from "./shells/open-shells";
import { createSeaStar } from "./shells/sea-star";
import { createSeaSnailShell, createSnailShell } from "./shells/spiral-shells";

export { COVER, getMeshId, getMeshKind, getMeshVariant, getVariantCount,GRASS_KIND, PROP_MESH_COUNT } from "./prop-mesh-layout";

/** Trees come from the procedural species models (variant = growth stage). */
const tree = (kind: number) => (random: Random, variant: number) =>
  createIslandTreePropMesh(kind, variant, treeModelSeed(random));

const RECIPES: Record<number, (random: Random, variant: number) => PropMesh> = {
  [ADVENTURE_PROP.cactus]: createCactus,
  [ADVENTURE_PROP.sparseOak]: (random, variant) => createSparseSwampTree(PROP.broadleafTree, variant,
    Math.floor(random() * 1_000_000)),
  [ADVENTURE_PROP.sparseBirch]: (random, variant) => createSparseSwampTree(PROP.birchTree, variant,
    Math.floor(random() * 1_000_000)),
  [PROP.broadleafTree]: tree(PROP.broadleafTree),
  [PROP.coniferTree]: tree(PROP.coniferTree),
  [PROP.palmTree]: tree(PROP.palmTree),
  [PROP.birchTree]: tree(PROP.birchTree),
  [PROP.cedarTree]: tree(PROP.cedarTree),
  [PROP.walnutTree]: tree(PROP.walnutTree),
  [PROP.mahoganyTree]: tree(PROP.mahoganyTree),
  [PROP.hardwoodTree]: tree(PROP.hardwoodTree),
  [PROP.bush]: createWoodyShrub,
  /** Meadow rocks are drawn by the rock layer (rocks/meadow-stones.ts): no prop mesh. */
  [PROP.smallRock]: () => new MeshBuilder().finish(),
  [PROP.largeRock]: () => new MeshBuilder().finish(),
  [PROP.pebbles]: () => new MeshBuilder().finish(),
  [PROP.flowers]: createFlowerClump,
  [PROP.mushrooms]: createMushrooms,
  [PROP.reeds]: createReeds,
  [PROP.cattail]: createCattail,
  [PROP.riverShrub]: createRiverShrub,
  [PROP.willowShrub]: createWillowShrub,
  [PROP.sedge]: createSedge,
  [PROP.berryBush]: createBerryBush,
  [PROP.fern]: createFern,
  [PROP.sapling]: createSapling,
  [PROP.broadleafShrub]: createBroadleafShrub,
  [PROP.fieldShrub]: createFieldShrub,
  [PROP.waterLily]: createWaterLily,
  [COVER.forestGrass]: (_random, variant) => createBiomeGrassMesh(COVER.forestGrass, variant),
  [COVER.jungleGrass]: (_random, variant) => createBiomeGrassMesh(COVER.jungleGrass, variant),
  [COVER.savannaGrass]: (_random, variant) => createBiomeGrassMesh(COVER.savannaGrass, variant),
  [COVER.shortGrass]: createShortGrass,
  [COVER.tallGrass]: createTallGrass,
  [COVER.dryTuft]: createDryTuft,
  [COVER.seedGrass]: createSeedGrass,
  [COVER.clover]: createClover,
  [COVER.fieldWeed]: createFieldWeed,
  [COVER.yellowFlower]: createWildflower("yellow"),
  [COVER.whiteFlower]: createWildflower("white"),
  [COVER.pinkFlower]: createWildflower("pink"),
  [COVER.thistle]: createThistle,
  [COVER.seashell]: createSeashell,
  [COVER.snailShell]: createSnailShell,
  [COVER.seaStar]: createSeaStar,
  [COVER.seaSnailShell]: createSeaSnailShell,
  [COVER.openShell]: createOpenShell
};

/** Kind names (load profile). */
const KIND_NAMES = Object.fromEntries(
  Object.entries({ ...PROP, ...COVER, ...ADVENTURE_PROP }).map(([name, kind]) => [kind, name])
);

/** One prop mesh (kind, variant) of the set `seed` makes. Deterministic. */
export const createPropMesh = (seed: number, kind: number, variant: number) =>
  RECIPES[kind]!(propMeshRandom(seed, kind, variant), variant);

/** Every prop mesh, indexed by getMeshId(kind, variant). Deterministic. */
export const createPropMeshes = (seed: number): PropMesh[] => {
  const meshes: PropMesh[] = [];
  for (let kind = 0; kind < PROP_KIND_COUNT; kind += 1) {
    profileStep(`prop meshes ${KIND_NAMES[kind]} x${getVariantCount(kind)}`, () => {
      for (let variant = 0; variant < getVariantCount(kind); variant += 1) {
        meshes.push(createPropMesh(seed, kind, variant));
      }
    });
  }
  return meshes;
};
