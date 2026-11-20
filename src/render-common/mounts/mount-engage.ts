/** How long a rider stays engaged after its last blow (the cavalry interval is 1.3 s). */
const ENGAGED_SECONDS = 1.5;
/** Rate (1/s) at which the horse turns to and away from its target. */
const ENGAGE_RATE = 4;

export interface MountEngagement {
  /** 0..1 drawn engagement (MountFrame.engage). */
  engage: number;
  /** Seconds since the last blow started or was under way. */
  sinceAttack: number;
}

/**
 * Eases a rider into and out of engagement: it stays engaged between blows of one fight, and
 * leaves it once it rides on (a horse never fights sideways at a trot or gallop).
 */
export const advanceMountEngagement = (
  state: MountEngagement | undefined, attacking: boolean, riding: boolean, dt: number
): MountEngagement => {
  const sinceAttack = attacking ? 0 : (state?.sinceAttack ?? Infinity) + dt;
  const target = !riding && sinceAttack < ENGAGED_SECONDS ? 1 : 0;
  const engage = state?.engage ?? 0;
  return { engage: engage + (target - engage) * (1 - Math.exp(-dt * ENGAGE_RATE)), sinceAttack };
};

/** Rate (1/s) at which a rider raises its sword into a parry and lowers it again. */
const GUARD_RATE = 9;

/**
 * Eases a rider's parry (MountFrame.guard): up while an enemy winds up a blow at it (the
 * simulation's pending target, the same signal that raises a foot soldier's shield), down after.
 */
export const advanceMountGuard = (guard: number | undefined, defending: boolean, dt: number) => {
  const current = guard ?? 0, target = defending ? 1 : 0;
  return current + (target - current) * (1 - Math.exp(-dt * GUARD_RATE));
};
