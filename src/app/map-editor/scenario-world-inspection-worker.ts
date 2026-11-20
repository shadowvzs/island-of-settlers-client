import { inspectScenarioWorld, type ScenarioWorldInspectionOptions, type ScenarioWorldReport } from "../../shared/settlement/scenario-world-inspection";
import type { ScenarioSpaceProgress } from "../../shared/settlement/settlement-scenario-space";
import type { WorldData } from "../../shared/world/world-data";
import { getWorldRevision } from "./helpers";
import { runWorkerJob } from "./worker-job";

interface InspectionWorkerReply {
  error?: string;
  phase?: string;
  progress?: ScenarioSpaceProgress;
  result?: ScenarioWorldReport;
}

/** postMessage snapshots once; worker termination interrupts even a native synchronous route search. */
export const inspectScenarioWorldInWorker = (world: WorldData, options: ScenarioWorldInspectionOptions = {}) => {
  if (typeof Worker === "undefined") return inspectScenarioWorld(world, options);
  const navigationMilliseconds = options.navigationMilliseconds ?? 15000, spaceMilliseconds = options.maxMilliseconds ?? 5000;
  if (!Number.isFinite(navigationMilliseconds) || navigationMilliseconds < 0 || navigationMilliseconds > 60000 ||
    !Number.isFinite(spaceMilliseconds) || spaceMilliseconds < 0 || spaceMilliseconds > 10000)
    return Promise.reject(new Error("Invalid inspection time budget"));
  const original = { scenario: world.scenario, heights: world.heights, water: world.waterSurface, props: world.props };
  const revision = getWorldRevision(world, { props: true });
  const current = () => !options.signal?.aborted && options.isCurrent?.() !== false &&
    original.scenario === world.scenario && original.heights === world.heights && original.water === world.waterSurface &&
    original.props === world.props && revision === getWorldRevision(world, { props: true });
  if (!current()) return Promise.reject(new DOMException("Inspection cancelled.", "AbortError"));
  const abortError = () => new DOMException("Map changed or inspection cancelled.", "AbortError");
  return runWorkerJob<ScenarioWorldReport, InspectionWorkerReply>({
    abortError,
    createWorker: () =>
      new Worker(new URL("../../workers/scenario-inspection-worker.ts", import.meta.url), { type: "module" }),
    isCurrent: current,
    message: { world, wildlife: options.wildlife, spaceMilliseconds, navigationMilliseconds },
    signal: options.signal,
    timeoutError: () => new Error(
      "Inspection worker exceeded its time bound. Unfinished checks remain UNKNOWN; retry with a larger budget."
    ),
    timeoutMs: navigationMilliseconds + spaceMilliseconds + 5000,
    onError: () => new Error("Navigation inspection worker failed; no clearance proof was published."),
    onMessage: (data, finish) => {
      if (!current()) { finish(abortError()); return; }
      if (data.error) finish(new Error(data.error));
      else if (data.result) finish(undefined, data.result);
      else if (data.progress) options.onProgress?.(data.progress);
      else if (data.phase) options.onPhase?.(data.phase);
    }
  });
};
