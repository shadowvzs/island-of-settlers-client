import { FOG, type WorldData } from "./world-data";

/** Presentation only: exploration, permanent sight and persisted fog bytes stay authoritative. */
export const displayFogAt = (world: Pick<WorldData, "fog" | "fogDisplayDisabled">, cell: number) =>
  world.fogDisplayDisabled || !world.fog ? FOG.visible : world.fog[cell] ?? FOG.hidden;

export const setFogDisplay = (world: WorldData, enabled: boolean) => {
  if (!!world.fogDisplayDisabled === !enabled) return;
  world.fogDisplayDisabled = !enabled;
  world.fogRevision = (world.fogRevision ?? 0) + 1;
};

/**
 * Display fog of the cell under a world point (clamped to the map) as visibility: 1 visible, 0.5
 * explored (dimmed), 0 hidden (FOG's values halved). Presentation only.
 */
export const displayFogVisibilityAt = (
  world: Pick<WorldData, "cellsX" | "cellsZ" | "fog" | "fogDisplayDisabled">,
  x: number,
  z: number
) => {
  const cellX = Math.min(world.cellsX - 1, Math.max(0, Math.floor(x)));
  const cellZ = Math.min(world.cellsZ - 1, Math.max(0, Math.floor(z)));
  return displayFogAt(world, cellZ * world.cellsX + cellX) / FOG.visible;
};
