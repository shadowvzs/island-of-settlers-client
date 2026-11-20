import { createRandom, type Random } from "../../shared/world/rng";

/** Shared native variant seed, available without importing unrelated plant asset loaders. */
export const PROP_MESH_SEED = 2024;

/** Random stream of prop mesh (kind, variant) in the set `seed` makes. */
export const propMeshRandom = (seed: number, kind: number, variant: number) =>
  createRandom(seed + kind * 977 + variant * 131);

/** Species model seed a tree recipe draws first from its stream. */
export const treeModelSeed = (random: Random) => Math.floor(random() * 1_000_000);
