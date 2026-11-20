/**
 * Runs resource releases after a quiet delay. A possession return drops the hero tier in the same
 * frame the camera leaves the body; disposing several GPU resources there is a visible stall, so
 * the releases wait outside the transition. A second defer while the timer runs joins the batch.
 */
export const createDelayedRelease = (
  delayMs: number,
  schedule: (callback: () => void, milliseconds: number) => unknown = setTimeout,
  cancel: (handle: unknown) => void = handle => clearTimeout(handle as ReturnType<typeof setTimeout>)
) => {
  const pending: (() => void)[] = [];
  let handle: unknown;
  const run = () => {
    handle = undefined;
    for (const release of pending.splice(0)) release();
  };
  return {
    defer: (release: () => void) => {
      pending.push(release);
      if (handle === undefined) handle = schedule(run, delayMs);
    },
    /** Runs every deferred release now; crowd teardown must not leak past its owner. */
    flush: () => {
      if (handle !== undefined) { cancel(handle); handle = undefined; }
      run();
    },
    pending: () => pending.length
  };
};
