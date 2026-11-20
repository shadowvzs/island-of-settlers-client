/**
 * Resolves `drawn` in a task after the first render call, so work deferred to it (bakes of far
 * zoom impostors, birds, animals) never delays the first frame of the island.
 */
export const createFirstFrameSignal = () => {
  let resolve = () => {};
  let pending = true;
  const drawn = new Promise<void>((done) => {
    resolve = done;
  });
  const markDrawn = () => {
    if (!pending) return;
    pending = false;
    setTimeout(resolve, 0);
  };
  return { drawn, markDrawn };
};
