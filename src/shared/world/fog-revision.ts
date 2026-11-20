import type { WorldData } from "./world-data";

/**
 * Marks a change of `world.fog`: every change bumps `fogRevision` (renderers recompose); a change
 * that explored a hidden cell also bumps `exploredRevision` (charting re-checks its sites).
 */
export const markFogChanged = (world: Pick<WorldData, "exploredRevision" | "fogRevision">, explored: boolean) => {
  world.fogRevision = (world.fogRevision ?? 0) + 1;
  if (explored) world.exploredRevision = (world.exploredRevision ?? 0) + 1;
};
