import { TERRAIN_GENERATOR_VERSION, validGenerationProvenance } from "../../generation/generation-provenance";
import type { WorldData } from "../../world-data";
import { restoreTerrainSelection, type TerrainRestoreSource } from "./scoped-restore";
import type { TerrainEditState } from "./terrain-edit-state";

export const seedRegenerationProblem = (world: WorldData): string | null => {
  const provenance = world.generationProvenance;
  if (!provenance) return "This map has no exact saved generator recipe. Named baseline restoration remains available.";
  if (!validGenerationProvenance(provenance)) return "The saved generator recipe is invalid.";
  if (provenance.generatorVersion !== TERRAIN_GENERATOR_VERSION)
    return "This map uses a different terrain generator version; exact seed regeneration is unavailable.";
  if (provenance.options.seed !== world.seed || provenance.options.cellsX !== world.cellsX ||
    provenance.options.cellsZ !== world.cellsZ) return "The saved generator recipe belongs to a different map.";
  return null;
};
/** Retain only immutable terrain arrays after the detached worker world has been validated. */
export const seedTerrainSource = (world: WorldData, candidate: WorldData): TerrainRestoreSource => {
  const problem = seedRegenerationProblem(world);
  if (problem) throw new Error(problem);
  if (seedRegenerationProblem(candidate) || candidate.seed !== world.seed || candidate.cellsX !== world.cellsX ||
    candidate.cellsZ !== world.cellsZ || candidate.seaLevel !== world.seaLevel)
    throw new Error("Regenerated candidate does not match the saved map recipe.");
  const expected = world.generationProvenance!.options, actual = candidate.generationProvenance!.options;
  for (const key of new Set([...Object.keys(expected), ...Object.keys(actual)]))
    if (expected[key as keyof typeof expected] !== actual[key as keyof typeof actual])
      throw new Error("Regenerated candidate options differ from the saved map recipe.");
  if (candidate.heights.length !== world.heights.length || candidate.waterSurface.length !== world.heights.length ||
    candidate.flow.length !== world.heights.length * 2 ||
    candidate.heights.some(value => !Number.isFinite(value)) ||
    candidate.waterSurface.some(value => !Number.isFinite(value)) || candidate.flow.some(value => !Number.isFinite(value)))
    throw new Error("Regenerated candidate terrain arrays are invalid.");
  return { heights: candidate.heights, waterSurface: candidate.waterSurface, lakeWater: candidate.lakeWater,
    flow: candidate.flow, seedBaseline: true };
};
export const regenerateSeedTerrainSelection = (world: WorldData, state: TerrainEditState,
  selected: readonly number[], source: TerrainRestoreSource) => {
  const problem = seedRegenerationProblem(world);
  if (problem) throw new Error(problem);
  if (!source.seedBaseline) throw new Error("An exact detached seed terrain candidate is required.");
  return restoreTerrainSelection(world, state, selected, source);
};
