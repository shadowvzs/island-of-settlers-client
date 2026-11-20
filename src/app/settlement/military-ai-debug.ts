import type { MilitaryAiMode } from "../../shared/settlement/military-ai-mode";
import { createMilitaryAiOverlay } from "./military-ai-overlay";

import "./military-ai-debug.css";

/**
 * Development tools > Military > Military AI: shows the live simulation's fixed AI mode and the
 * debug overlay. Created once the live simulation exists.
 */
export const createMilitaryAiDebug = (options: Parameters<typeof createMilitaryAiOverlay>[0]) => {
  const overlay = createMilitaryAiOverlay(options);
  return {
    dispose: overlay.dispose,
    /** The live mode; undefined while no simulation runs. */
    getMode: (): MilitaryAiMode | undefined => options.getSimulation()?.militaryAiMode(),
    setOverlayVisible: overlay.setVisible
  };
};

export type MilitaryAiDebug = ReturnType<typeof createMilitaryAiDebug>;
