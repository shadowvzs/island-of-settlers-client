/** A failing frame logs again only after this many further failures (no console flood at 60 fps). */
const REPEAT_LOG_INTERVAL = 600;

type FrameErrorLog = (message: string, error: unknown) => void;

const errorKey = (error: unknown) =>
  error instanceof Error ? `${error.name}: ${error.message}` : String(error);

/**
 * Keeps the render loop alive through a failing frame: the error is logged (each distinct error
 * once, then every `REPEAT_LOG_INTERVAL` repeats) and later frames still run.
 */
export const createFrameErrorGuard = (log: FrameErrorLog = (message, error) => console.error(message, error)) => {
  const counts = new Map<string, number>();
  const report = (error: unknown) => {
    const key = errorKey(error);
    const count = (counts.get(key) ?? 0) + 1;
    counts.set(key, count);
    if (count === 1 || count % REPEAT_LOG_INTERVAL === 0)
      log(`Render frame failed (${count}x); later frames continue`, error);
  };
  /** Runs `draw(argument)` (no closure per frame); returns its result, or `fallback` when it threw. */
  const run = <A, T>(draw: (argument: A) => T, argument: A, fallback: T): T => {
    try { return draw(argument); }
    catch (error) { report(error); return fallback; }
  };
  return { failures: () => [...counts.values()].reduce((sum, count) => sum + count, 0), run };
};
