import { createScenarioInspectionContext } from "../../settlement/settlement-map-scenario";
import { isNavigationClear } from "../../settlement/settlement-navigation";
import { createRandom } from "../rng";
import { PROP, PROP_REMOVED, type WorldData } from "../world-data";
import { placeProp } from "./prop-placement";
import { reservePropCapacity } from "./prop-set";
import { createPlantedTreeSpecies, isTreePlantingTerrain } from "./tree-planting";

export interface VegetationRegrowthOptions {
  cells: readonly number[];
  seed: number;
  density: number;
  age: number;
  /** Minimum tree spacing in cells (default 2.5, minimum 1.2). */
  spacing?: number;
  /** -1: current local biome. Hardwood must be an explicit editor choice. */
  species: number;
  /** Actual live roads/building reservations, supplied by the editor integration. */
  canPlant: (x: number, z: number) => boolean;
}

/** Additive procedural repopulation. Existing props/paints/heights/ore are never replaced. */
export const regrowVegetation = (world: WorldData, options: VegetationRegrowthOptions) => {
  if (![options.seed, options.density, options.age].every(Number.isFinite)) throw new Error("Regrowth seed, density and tree age must be finite.");
  const allowed: readonly number[] = [-1, PROP.broadleafTree, PROP.coniferTree, PROP.birchTree, PROP.palmTree, PROP.hardwoodTree, PROP.cedarTree, PROP.walnutTree, PROP.mahoganyTree];
  if (!allowed.includes(options.species)) throw new Error("Choose an existing tree species or local biome.");
  const cells = [...new Set(options.cells)];
  if (!cells.length || cells.length > 32768 || cells.some(cell => !Number.isInteger(cell) || cell < 0 || cell >= world.cellsX * world.cellsZ))
    throw new Error("Regrowth needs a complete bounded brush or contour of at most 32,768 cells.");
  const spacing = options.spacing ?? 2.5;
  if (!Number.isFinite(spacing) || spacing < 1.2) throw new Error("Regrowth tree spacing must be at least 1.2 cells.");
  const context = createScenarioInspectionContext(world), random = createRandom(options.seed >>> 0);
  const species = createPlantedTreeSpecies(world);
  const buckets = new Map<string, { x: number; z: number }[]>();
  const key = (x: number, z: number) => `${Math.floor(x / spacing)}/${Math.floor(z / spacing)}`;
  const add = (x: number, z: number) => { const k = key(x, z), entries = buckets.get(k) ?? []; entries.push({ x, z }); buckets.set(k, entries); };
  for (let id = 0; id < world.props.count; id++) if (world.props.types[id] !== PROP_REMOVED) add(world.props.x[id]!, world.props.z[id]!);
  const free = (x: number, z: number) => {
    for (const dx of [-spacing, 0, spacing]) for (const dz of [-spacing, 0, spacing])
      if (buckets.get(key(x + dx, z + dz))?.some(point => Math.hypot(point.x - x, point.z - z) < spacing)) return false;
    return true;
  };
  const target = Math.min(256, Math.ceil(cells.length * Math.max(0, Math.min(1, options.density)) / (spacing * spacing)));
  const placed: number[] = [];
  let attempts = 0;
  while (placed.length < target && attempts < 4096) {
    attempts++;
    const cell = cells[Math.floor(random() * cells.length)]!;
    const x = cell % world.cellsX + random(), z = Math.floor(cell / world.cellsX) + random();
    if (world.settlementGroundClearance?.[cell] || context.occupied[cell] || !free(x, z) ||
      !isTreePlantingTerrain(world, x, z) || !isNavigationClear(context, { x, z }, false, false, .4) || !options.canPlant(x, z)) continue;
    const kind = options.species === -1 ? species(x, z) : options.species;
    if (!placed.length) reservePropCapacity(world.props, world.props.count + target);
    const id = placeProp(world, { ageSeconds: options.age, kind, x, z, seed: Math.floor(random() * 0x100000000) });
    if (typeof id === "string") continue;
    (world.authoredTreeAges ??= {})[id] = Math.max(0, Math.min(120, options.age));
    add(x, z); placed.push(id);
  }
  return { placed, attempts, requested: target, seed: options.seed >>> 0 };
};
