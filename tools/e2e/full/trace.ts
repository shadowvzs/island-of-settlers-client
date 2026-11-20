import { join } from "node:path";
import type { BrowserContext } from "playwright-core";

/** A case prefix or failure-only window. No DOM snapshots or source copies; no lane-wide polling trace. */
export const startTraceWindow = async (
  tracing: BrowserContext["tracing"], directory: string, id: string, seconds = 8
) => {
  const filename = `${id.replace(/[^a-zA-Z0-9_-]/g, "-")}.trace.zip`;
  await tracing.start({ screenshots: true, snapshots: false, sources: false });
  let active = true;
  let stopped: Promise<{ filename?: string; error?: string }> | undefined;
  const stop = () => stopped ??= (async () => {
    active = false;
    clearTimeout(timer);
    try {
      await tracing.stop({ path: join(directory, filename) });
      return { filename };
    } catch (error) { return { error: String(error) }; }
  })();
  const timer = setTimeout(() => { void stop(); }, seconds * 1000);
  return { get active() { return active; }, stop };
};
