import { readFile } from "node:fs/promises";

import { stageGameSession } from "../../src/app/settlement/game-session";
import { type CameraState, createCamera } from "../../src/render-common/camera-state";
import type { AnimalSaveState } from "../../src/render-common/wildlife/manager/animal-save";
import { colonyIslandOffers } from "../../src/shared/settlement/colony-expedition-rules";
import { chooseColonyWorld } from "../../src/shared/settlement/colony-world-choice";
import type { LoadedGameSave } from "../../src/shared/settlement/game-save";
import { DEFAULT_WORLD_OPTIONS, generateWorld } from "../../src/shared/world/generation/generate-world";
import { sampleBilinear } from "../../src/shared/world/grid-geometry";
import { createRandom } from "../../src/shared/world/rng";
import {
  BUILD, MATERIAL, MATERIAL_COUNT, PROP, type PropSet, type WorldData
} from "../../src/shared/world/world-data";

export interface MeasureIsland { fresh?: boolean; label: string; loaded?: LoadedGameSave; world: WorldData }

/** Glades of a dense forest: one per GLADE_GRID² cells (jittered), 4 to 7 cells in radius. */
const GLADE_GRID = 24;

/** Whether a point lies in one of the seeded glades (the glades of its grid cell and neighbours). */
const createGladeTest = (size: number, random: () => number) => {
  const columns = Math.ceil(size / GLADE_GRID);
  const glades = Array.from({ length: columns * columns }, (_, cell) => ({ radius: 4 + random() * 3,
    x: (cell % columns + random()) * GLADE_GRID, z: (Math.floor(cell / columns) + random()) * GLADE_GRID }));
  return (x: number, z: number) => {
    const column = Math.floor(x / GLADE_GRID), row = Math.floor(z / GLADE_GRID);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      if (column + dx < 0 || row + dz < 0 || column + dx >= columns || row + dz >= columns) continue;
      const glade = glades[(row + dz) * columns + column + dx]!;
      if (Math.hypot(glade.x - x, glade.z - z) < glade.radius) return true;
    }
    return false;
  };
};

/**
 * A synthetic dense forest island (owner D-S8 targets): the generated island's coast, its land
 * flattened to grass and covered by mature broadleaf trees `spacing` cells apart (lightly
 * jittered) around seeded glades. With `block` > 0 the forest grows in a checkerboard of
 * `block`-cell stands and meadows (forest edges everywhere).
 */
const createDenseForestWorld = (size: number, spacing: number, block = 0): WorldData => {
  const world = generateWorld({ ...DEFAULT_WORLD_OPTIONS, cellsX: size, cellsZ: size, erosionDroplets: 0 });
  world.heights.fill(2); world.blocking.fill(0); world.walkCost.fill(10);
  world.buildClass.fill(BUILD.large); world.buildCap.fill(BUILD.large); world.slopeClass.fill(0);
  world.seaLevel = -1; world.splat.fill(0);
  for (let index = 0; index < world.splat.length; index += MATERIAL_COUNT) world.splat[index + MATERIAL.grass] = 255;
  const random = createRandom(7), perRow = Math.floor((size - 4) / spacing), inGlade = createGladeTest(size, random);
  const points: number[] = [];
  for (let index = 0; index < perRow * perRow; index++) {
    const x = 2 + (index % perRow + 0.5 + (random() - 0.5) * 0.3) * spacing;
    const z = 2 + (Math.floor(index / perRow) + 0.5 + (random() - 0.5) * 0.3) * spacing;
    const meadow = block > 0 && (Math.floor(x / block) + Math.floor(z / block)) % 2 === 1;
    const sea = sampleBilinear(world, world.waterDepth, x, z) > 0;
    if (!meadow && !sea && !inGlade(x, z)) points.push(x, z);
  }
  const count = points.length / 2;
  const props: PropSet = { count, form: new Uint8Array(count), phase: new Float32Array(count),
    rotation: new Float32Array(count), scale: new Float32Array(count).fill(1),
    types: new Uint8Array(count).fill(PROP.broadleafTree), x: new Float32Array(count),
    y: new Float32Array(count).fill(2), z: new Float32Array(count) };
  for (let index = 0; index < count; index++) {
    props.x[index] = points[index * 2]!;
    props.z[index] = points[index * 2 + 1]!;
    props.rotation[index] = random() * Math.PI * 2;
  }
  world.props = props;
  return world;
};

/**
 * A save file path, `colony:<offer index>` for a generated colony island (no save), or
 * `dense:<size>:<spacing>[:<block>]` for a synthetic dense forest island (no save).
 * `fresh:<save>` keeps the save's island but spawns the initial animal population (older saves
 * carry a wildlife section of other rules, which is dropped).
 */
export const loadIsland = async (source: string, dropAnimals = false): Promise<MeasureIsland> => {
  if (source.startsWith("fresh:")) {
    const island = await loadIsland(source.slice(6), true);
    return { ...island, fresh: true, label: `${island.label} (initial population)` };
  }
  if (source.startsWith("dense:")) {
    const [, size, spacing, block] = source.split(":").map(Number);
    const world = createDenseForestWorld(size!, spacing!, block);
    const stands = block ? `, ${block}-cell stands` : "";
    return { label: `dense ${size}² forest, spacing ${spacing}${stands}, ${world.props.count} trees`, world };
  }
  if (source.startsWith("colony:")) {
    const offer = colonyIslandOffers(1234)[Number(source.slice(7))]!;
    const world = chooseColonyWorld(offer);
    return { label: `colony offer ${source.slice(7)} (${offer.difficulty}) ${world.cellsX}²`, world };
  }
  const game = JSON.parse(await readFile(source, "utf8"));
  if (dropAnimals && game.runtime) delete game.runtime.animals;
  const loaded = await stageGameSession(game);
  const { world } = loaded.map;
  world.buildRevision ??= 0;
  return { label: `${source.split("/").slice(-3).join("/")} ${world.cellsX}²`, loaded, world };
};

export const savedAnimals = (island: MeasureIsland) => island.fresh ? undefined :
  (island.loaded?.runtime as { animals?: AnimalSaveState } | undefined)?.animals;

/** A live 1600x900 view at gameplay zoom centred at `x, z`. */
export const liveCamera = (x: number, z: number, zoom = .85): CameraState =>
  ({ ...createCamera(x, z, zoom), viewportHeight: 900, viewportWidth: 1600 });

/** A view whose region covers the whole map with every animal inside the "near" distance. */
export const wholeMapCamera = (world: WorldData): CameraState =>
  ({ ...createCamera(world.cellsX / 2, world.cellsZ / 2, .01), viewportHeight: 1e5, viewportWidth: 1e5 });

/** Living (non-pending) animals by species name. */
export const countAnimals = (pool: { active: Uint8Array; pending: Uint8Array; species: Uint8Array }) => {
  const names = ["rabbit", "deer", "elk"], counts: Record<string, number> = { total: 0 };
  for (let animal = 0; animal < pool.active.length; animal++) {
    if (!pool.active[animal] || pool.pending[animal]) continue;
    const name = names[pool.species[animal]!] ?? `species${pool.species[animal]}`;
    counts[name] = (counts[name] ?? 0) + 1;
    counts.total! += 1;
  }
  return counts;
};

export const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)]!;
