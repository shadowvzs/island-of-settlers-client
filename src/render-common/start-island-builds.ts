import type { ContentBuilders } from "./content-builders";
import { allocatePropInstances } from "./props/prop-instances";
import type { QualityPreset } from "./quality";

/**
 * Arrival and voyage warming must request identical worker jobs and cache keys. Without drawn
 * grass (Minimal) no field cover is built: the layer is empty and no cache entry is requested.
 */
export const startIslandBuilds = (builders: ContentBuilders, quality: QualityPreset) => ({
  coverFieldBuild: builders.coverField(),
  grassBuild: quality.grass
    ? builders.fieldCover(quality.grassSamples)
    : Promise.resolve(allocatePropInstances(0)),
  rocksBuild: builders.islandRocks(quality.rockDetail ? "full" : "coarse"),
  terrainBuild: Promise.all([builders.terrainChunks("terrain"), builders.terrainChunks("water")]),
  waterFieldBuild: builders.waterField()
});
