import type { ScenarioWildlifeSnapshot } from "../shared/settlement/scenario-wildlife-inspection";
import { inspectScenarioWorld } from "../shared/settlement/scenario-world-inspection";
import type { ScenarioSpaceProgress } from "../shared/settlement/settlement-scenario-space";
import type { WorldData } from "../shared/world/world-data";

const scope = self as unknown as { onmessage: ((event: MessageEvent<{
  world: WorldData; wildlife?: ScenarioWildlifeSnapshot; spaceMilliseconds: number; navigationMilliseconds: number
}>) => void) | null; postMessage(message: unknown): void };
scope.onmessage = async ({ data }) => {
  try {
    let lastProgress = -Infinity;
    const progress = (message: unknown) => {
      const now = performance.now();
      if (now - lastProgress < 100) return;
      lastProgress = now; scope.postMessage(message);
    };
    const result = await inspectScenarioWorld(data.world, {
      wildlife: data.wildlife,
      maxMilliseconds: data.spaceMilliseconds, navigationMilliseconds: data.navigationMilliseconds,
      onProgress: (value: ScenarioSpaceProgress) => progress({ progress: value }),
      onPhase: phase => progress({ phase }),
      // All work is isolated. The parent terminates this worker immediately for cancellation.
      yieldControl: () => Promise.resolve()
    });
    scope.postMessage({ result });
  } catch (error) {
    scope.postMessage({ error: error instanceof Error ? error.message : String(error) });
  }
};
