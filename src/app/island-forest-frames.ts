import { tickSeconds } from "../shared/settlement/game-clock";
import type { createIslandFelling } from "./island-felling";
import type { createIslandGrowth } from "./island-growth";

interface ForestFrameOptions {
  felling: ReturnType<typeof createIslandFelling>;
  growth: ReturnType<typeof createIslandGrowth>;
  /** The share of the next settlement tick already elapsed (0..1); absent on islands without a settlement. */
  tickFraction?: () => number;
}

/**
 * The render loop's tree growth and felling frames. A settlement's ticks own both (`onTickStart`), so frames only
 * animate leaves and draw falls between ticks; without a settlement the render clock drives them as before.
 */
export const createForestFrameUpdates = ({ felling, growth, tickFraction }: ForestFrameOptions) => {
  if (!tickFraction) return { updateFelling: felling.update, updateGrowth: growth.update };
  let previousTime: number | null = null;
  const updateFelling = (time: number) => {
    const deltaSeconds = previousTime === null ? 0 : Math.max(0, time - previousTime);
    previousTime = time;
    return felling.animate(deltaSeconds, tickSeconds(tickFraction()));
  };
  return { updateFelling, updateGrowth: () => growth.frame };
};
