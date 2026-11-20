import type { readDevParams } from "./dev-params";
import type { DevelopmentModules } from "./development-modules";
import type { createIslandDevelopmentTools } from "./island-development-tools";
import type { createSceneReplayRuntime } from "./scene-replay/runtime";
import type { createDebugClickModes } from "./settlement/debug-click-modes";
import type { createEconomyAiWindow } from "./settlement/economy-ai-window";
import type { createMilitaryAiDebug } from "./settlement/military-ai-debug";
import type { createMilitaryBenchmarkWindow } from "./settlement/military-benchmark-window";
import type { createSettlementDebugActions } from "./settlement/settlement-debug-actions";

/** The full admin-only module set, loaded after the server-verified administrator role. */
export interface AdminModules extends DevelopmentModules {
  createDebugClickModes: typeof createDebugClickModes;
  createEconomyAiWindow: typeof createEconomyAiWindow;
  createIslandDevelopmentTools: typeof createIslandDevelopmentTools;
  createMilitaryAiDebug: typeof createMilitaryAiDebug;
  createMilitaryBenchmarkWindow: typeof createMilitaryBenchmarkWindow;
  createSceneReplayRuntime: typeof createSceneReplayRuntime;
  createSettlementDebugActions: typeof createSettlementDebugActions;
  readDevParams: typeof readDevParams;
}

export type LoadAdminModules = () => Promise<AdminModules>;

/**
 * Imports the Development panel, debug tools, military overlays, scene replay and dev/test URL parser.
 * Only the administrator page and the already-admin-gated map editor may call this.
 */
export const loadAdminModules: LoadAdminModules = async () => {
  const [
    development, replay, params, clickModes, debugActions, militaryAi, benchmark, economyAi
  ] = await Promise.all([
    import("./island-development-tools"),
    import("./scene-replay/runtime"),
    import("./dev-params"),
    import("./settlement/debug-click-modes"),
    import("./settlement/settlement-debug-actions"),
    import("./settlement/military-ai-debug"),
    import("./settlement/military-benchmark-window"),
    import("./settlement/economy-ai-window")
  ]);
  return {
    createDebugClickModes: clickModes.createDebugClickModes,
    createEconomyAiWindow: economyAi.createEconomyAiWindow,
    createIslandDevelopmentTools: development.createIslandDevelopmentTools,
    createMilitaryAiDebug: militaryAi.createMilitaryAiDebug,
    createMilitaryBenchmarkWindow: benchmark.createMilitaryBenchmarkWindow,
    createSceneReplayRuntime: replay.createSceneReplayRuntime,
    createSettlementDebugActions: debugActions.createSettlementDebugActions,
    readDevParams: params.readDevParams
  };
};
