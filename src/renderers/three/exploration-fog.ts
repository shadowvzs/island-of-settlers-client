/**
 * EXPLORE-01E renderer adapter. The coordinator (01G) owns it together with the exploration session:
 *
 *   const fog = createExplorationFogAdapter(world);
 *   const live = createLiveFog(world, fog);       // renderer shading, not a gameplay consumer
 *   fog.setBubble(frame.bubble);                   // session adapter callback
 *   // createLiveFog's update reads fog.displayFog() lazily; fog.update() is also safe/idempotent.
 *   fog.dispose();                                 // live fog falls back to the current base fog
 *
 * The adapter owns only the transient mask/composition buffer. It never mutates the world, creates a
 * Three texture or talks to a gameplay fog consumer.
 */
import type { ExplorationVisibilityAdapter } from "../../app/exploration/contracts";
import {
  createTemporaryVisibility,
  type TemporaryVisibility,
  type TemporaryVisibilityStats
} from "../../render-common/exploration/temporary-visibility";
import type { LiveFogDisplayProvider } from "../../render-common/live-fog";
import type { WorldData } from "../../shared/world/world-data";

export interface ExplorationFogAdapter extends ExplorationVisibilityAdapter, LiveFogDisplayProvider {
  /** The display texture width/height, matching the world grid. */
  readonly height: number;
  readonly width: number;
  /** Clears the active bubble; equivalent to `setBubble(null)`. */
  clear: () => void;
  /** Applies queued bubble movement or base-fog changes once; false when nothing changed. */
  update: () => boolean;
  revision: () => number;
  stats: () => TemporaryVisibilityStats;
}

export const createExplorationFogAdapter = (world: WorldData): ExplorationFogAdapter => {
  const visibility: TemporaryVisibility = createTemporaryVisibility(world);
  let disposed = false;
  return {
    clear: () => {
      if (!disposed) visibility.clear();
    },
    dispose: () => {
      if (disposed) return;
      disposed = true;
      visibility.dispose();
    },
    displayFog: () => {
      if (disposed) return null;
      visibility.update();
      return visibility.displayFog();
    },
    height: world.cellsZ,
    revision: () => visibility.revision(),
    setBubble: bubble => {
      if (!disposed) visibility.setBubble(bubble ? { ...bubble } : null);
    },
    stats: () => visibility.stats(),
    update: () => !disposed && visibility.update(),
    width: world.cellsX
  };
};
