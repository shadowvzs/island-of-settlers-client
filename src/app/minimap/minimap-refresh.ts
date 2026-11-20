/** Scheduling hooks of the coalesced minimap refresh (the browser frame and visibility). */
export interface MinimapRefreshSchedulerOptions {
  /** Rebakes the world image. */
  bake: () => void;
  isVisible: () => boolean;
  schedule: (callback: () => void) => void;
}

/**
 * Coalesces minimap refresh requests: several asks before the scheduled frame run one bake, on
 * the latest world state. Hidden requests return cheaply; showing the minimap refreshes it.
 */
export const createMinimapRefreshScheduler = ({
  bake,
  isVisible,
  schedule
}: MinimapRefreshSchedulerOptions) => {
  let scheduled = false;
  let requested = false;
  const refresh = () => {
    scheduled = false;
    if (!requested) return;
    requested = false;
    if (!isVisible()) return;
    bake();
  };
  return {
    request: () => {
      if (!isVisible()) return;
      requested = true;
      if (scheduled) return;
      scheduled = true;
      schedule(refresh);
    }
  };
};
