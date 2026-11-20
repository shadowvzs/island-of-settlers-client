import type { createIslandDevelopmentTools } from "./island-development-tools";
import type { createSceneReplayRuntime } from "./scene-replay/runtime";
import type { createDebugClickModes } from "./settlement/debug-click-modes";
import type { createEconomyAiWindow } from "./settlement/economy-ai-window";
import type { createMilitaryAiDebug } from "./settlement/military-ai-debug";
import type { createMilitaryBenchmarkWindow } from "./settlement/military-benchmark-window";
import type { createSettlementDebugActions } from "./settlement/settlement-debug-actions";

/**
 * Development-only factories, kept out of the player entry. The admin page loads the full set after
 * the account role is verified; a local dev player loads only the hooks its existing tests use.
 */
export interface DevelopmentModules {
  /** Admin-only map-click tools; absent: no-op modes. */
  createDebugClickModes?: typeof createDebugClickModes;
  /** Economy AI "why" window; absent: no admin window. */
  createEconomyAiWindow?: typeof createEconomyAiWindow;
  /** The Development menu and its tool actions; absent: no panel in the player entry. */
  createIslandDevelopmentTools?: typeof createIslandDevelopmentTools;
  /** Military AI overlay; absent: no admin overlay. */
  createMilitaryAiDebug?: typeof createMilitaryAiDebug;
  /** Military benchmark window; absent: no admin benchmark tool. */
  createMilitaryBenchmarkWindow?: typeof createMilitaryBenchmarkWindow;
  /** Full-scene recording; absent: no scene replay runtime. */
  createSceneReplayRuntime?: typeof createSceneReplayRuntime;
  /** State-changing debug actions; absent: no-op actions. */
  createSettlementDebugActions?: typeof createSettlementDebugActions;
}
