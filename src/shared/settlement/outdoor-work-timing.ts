/** Shared authoritative durations: UI reads the same clocks as the outdoor workers. */
export const FISHING_WORK_TIMING = { cast: 2.4, wait: 5.6, reel: 4 } as const;
export const FORESTER_PLANT_SECONDS = 8;

export type FishingPhase = "fishCast" | "fishWait" | "fishReel";
type FishingAction = "fish_cast" | "fish_wait" | "fish_reel";

const FISHING_ACTIONS: Record<FishingPhase, FishingAction> = {
  fishCast: "fish_cast",
  fishWait: "fish_wait",
  fishReel: "fish_reel"
};

export interface FishingAdvance {
  phase: FishingPhase;
  action: FishingAction;
  timer: number;
  done: boolean;
}

/**
 * Advances one visible fishing phase. Keeping this pure makes the cast/wait/reel timeline reusable by
 * the fixed tick today and by an exact event timer later, without duplicating the boundary rules.
 */
export const advanceFishingPhase = (phase: FishingPhase, timer: number, dt: number): FishingAdvance => {
  const remaining = timer - dt;
  if (remaining > 0) return { phase, action: FISHING_ACTIONS[phase], timer: remaining, done: false };
  if (phase === "fishCast")
    return { phase: "fishWait", action: FISHING_ACTIONS.fishWait, timer: FISHING_WORK_TIMING.wait, done: false };
  if (phase === "fishWait")
    return { phase: "fishReel", action: FISHING_ACTIONS.fishReel, timer: FISHING_WORK_TIMING.reel, done: false };
  return { phase: "fishReel", action: FISHING_ACTIONS.fishReel, timer: 0, done: true };
};
