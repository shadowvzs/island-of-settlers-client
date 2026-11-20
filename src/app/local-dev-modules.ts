import { readDevParams } from "./dev-params";
import type { DevelopmentModules } from "./development-modules";
import { createSceneReplayRuntime, readSceneReplayBoot } from "./scene-replay/runtime";
import { startSceneReplayViewer } from "./scene-replay/viewer";
import { createDebugClickModes } from "./settlement/debug-click-modes";
import { createSettlementDebugActions } from "./settlement/settlement-debug-actions";

/**
 * Local dev-server test surface: existing Playwright/review harnesses keep their simulation hooks,
 * scene replay and URL switches, but the player entry still never shows the Development panel.
 * Production builds never import this module.
 */
export const localDevModules = {
  development: {
    createDebugClickModes,
    createSceneReplayRuntime,
    createSettlementDebugActions
  } satisfies DevelopmentModules,
  readDevParams,
  readSceneReplayBoot,
  startSceneReplayViewer
};
