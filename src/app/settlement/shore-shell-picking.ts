import type { TerrainRenderer } from "../../render-common/renderer-contract";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import { sampleSmooth } from "../../shared/world/grid-geometry";
import type { WorldData } from "../../shared/world/world-data";

/** A click within this many pixels of a shell's projected centre picks it (the shells are small). */
const PICK_PIXELS = 18;
/** Cells refreshed around a shell's old and new place (the field cover chunk is aligned anyway). */
const REFRESH_MARGIN = 1;

interface ShoreShellPickingOptions {
  renderer: Pick<TerrainRenderer, "drawsShoreShells" | "mapEdit" | "projectToViewport">;
  simulation: SettlementSimulation;
  world: WorldData;
}

/**
 * Home-island shell collecting in the view: the shell under the pointer (the renderer's
 * projectToViewport, so it works with any camera) is collected through the settlement command and
 * both its old and new place are redrawn. Minimal draws no shells, so nothing is picked there.
 */
export const createShoreShellPicking = ({ renderer, simulation, world }: ShoreShellPickingOptions) => {
  const refresh = (places: readonly { x: number; z: number }[]) => {
    for (const { x, z } of places) {
      renderer.mapEdit.refreshFieldCover({
        maxX: Math.ceil(x + REFRESH_MARGIN), maxZ: Math.ceil(z + REFRESH_MARGIN),
        minX: Math.floor(x - REFRESH_MARGIN), minZ: Math.floor(z - REFRESH_MARGIN)
      });
    }
  };
  const pick = (screenX: number, screenY: number) => {
    if (!renderer.drawsShoreShells?.()) return null;
    let picked: number | null = null, nearest = Infinity;
    simulation.shoreShellPositions().forEach(({ x, z }, index) => {
      const point = renderer.projectToViewport(x, sampleSmooth(world, world.heights, x, z) + 0.05, z);
      const distance = Math.hypot(point.x - screenX, point.y - screenY);
      if (distance > PICK_PIXELS || point.depth >= nearest) return;
      picked = index;
      nearest = point.depth;
    });
    return picked;
  };
  /** Collects the shell under the pointer; true when one was collected. */
  const click = (screenX: number, screenY: number) => {
    const index = pick(screenX, screenY);
    if (index === null) return false;
    const result = simulation.collectShoreShell(index);
    if (!result) return false;
    refresh([result.from, result.to]);
    return true;
  };
  // A loaded island redraws its moved shells (the first field cover may predate the restore).
  if (renderer.drawsShoreShells?.()) refresh(simulation.movedShoreShells());
  return { click, pick };
};
