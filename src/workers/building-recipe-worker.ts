import { getBuildingDefinition } from "../render-common/buildings/building-catalog";
import {
  leveledRecipeEntry, leveledRecipeKey
} from "../render-common/buildings/levels/leveled-building-recipe";
import { packPartGroups } from "../renderers/three/buildings/building-prepared-geometry";
import type {
  BuildingRecipeEntry, BuildingRecipeJob, BuildingRecipeReply, BuildingRecipeRequest
} from "../renderers/three/buildings/building-recipe-jobs";
import { prepareMergedPartGroups } from "../renderers/three/buildings/roman-building";

/**
 * Generates leveled building recipes and their merged model geometry off the main thread. DOM and
 * GPU free: recipes are plain deterministic data (structured-cloned), geometry is typed arrays
 * (transferred); the main thread adopts both and builds byte-identical models.
 */
const scope = self as unknown as { onmessage: ((event: MessageEvent<BuildingRecipeRequest>) => void) | null;
  postMessage(message: BuildingRecipeReply, transfer?: Transferable[]): void };

const generate = (job: BuildingRecipeJob, transfer: Transferable[]): BuildingRecipeEntry => {
  const { detailed, level, nation, type } = job;
  const leveled = leveledRecipeEntry(getBuildingDefinition(type), nation, detailed, level);
  const key = leveledRecipeKey(type, nation, level, detailed);
  if (!job.geometry) return { key, leveled: job.recipe ? leveled : undefined };
  const { packed, transfer: buffers } = packPartGroups(prepareMergedPartGroups(leveled.recipe, detailed));
  transfer.push(...buffers);
  return { groups: packed, key, leveled: job.recipe ? leveled : undefined };
};

scope.onmessage = ({ data }) => {
  const started = performance.now();
  try {
    const transfer: Transferable[] = [];
    const entries = data.jobs.map(job => generate(job, transfer));
    scope.postMessage({ entries, ms: performance.now() - started }, transfer);
  } catch (error) {
    scope.postMessage({ entries: [], error: error instanceof Error ? error.message : String(error), ms: 0 });
  }
};
