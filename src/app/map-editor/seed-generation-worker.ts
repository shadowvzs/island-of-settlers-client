import type { WorldOptions } from "../../shared/world/generation/generate-world";
import type { WorldData } from "../../shared/world/world-data";
import { runWorkerJob, toError } from "./worker-job";

interface SeedGenerationControl {
  signal?: AbortSignal;
  onPhase?: (phase: string) => void;
}
export type RegenerateSeedWorld = (options: WorldOptions, control?: SeedGenerationControl) => Promise<WorldData>;

interface SeedWorkerReply {
  error?: string;
  phase?: string;
  world?: WorldData;
}

const cancelled = () => new Error("Seed generation cancelled.");

/** Editor jobs have an independent worker so cancellation actually stops CPU work. */
export const regenerateSeedWorld: RegenerateSeedWorld = (options, control = {}) => {
  if (control.signal?.aborted) return Promise.reject(cancelled());
  return runWorkerJob<WorldData, SeedWorkerReply>({
    abortError: cancelled,
    createWorker: () => new Worker(new URL("../../workers/editor-seed-worker.ts", import.meta.url), { type: "module" }),
    message: options,
    signal: control.signal,
    timeoutError: () => new Error("Seed worker exceeded its 120-second bound. No map changes were adopted."),
    timeoutMs: 120000,
    onError: event => {
      event.preventDefault();
      return new Error(event.message || "Seed worker failed.");
    },
    onMessage: (data, finish) => {
      if (typeof data.phase === "string") {
        try { control.onPhase?.(data.phase); }
        catch (error) { finish(toError(error)); }
        return;
      }
      finish(data.error ? new Error(data.error) : undefined, data.world);
    },
    onMessageError: () => new Error("Seed worker reply could not be read.")
  });
};
