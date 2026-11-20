/** A delayed render admits four fixed economy steps at most; long absences use the offline replay worker. */
export const settlementFrameDelta = (elapsed: number) =>
  Number.isFinite(elapsed) ? Math.max(0, Math.min(elapsed, .2)) : 0;
