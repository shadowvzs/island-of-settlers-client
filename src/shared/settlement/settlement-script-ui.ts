import type {
  ScriptUiEffect, ScriptUiHighlight
} from "../../../../island-of-settlers-shared/src/script/engine/ui-effects";
import { NO_SCRIPT_UI_EFFECTS } from "./constants";
import type { SettlementContext } from "./settlement-types";

/**
 * The map script's UI boundary of the simulation (trigger design §6.10, TRG9). `scriptUiAck` is the only recorded
 * command: the player clicked the highlighted element a run waits on, so replay, verifier and reload resume the
 * run at the same tick. The outbox and the waiting highlights are presentation reads that never change the island.
 */
export const createSimulationScriptUi = (context: SettlementContext) => ({
  /** Recorded: resumes the run waiting on this highlight effect; false when none waits (stale or forged click). */
  scriptUiAck: (effectId: string) =>
    typeof effectId === "string" && (context.script?.engine.acknowledgeUi(effectId) ?? false),
  /** Highlights that script runs wait on, re-derived from the saved run state (shown again after a reload). */
  scriptWaitingHighlights: (): readonly ScriptUiHighlight[] =>
    context.script?.engine.waitingUiHighlights() ?? NO_SCRIPT_UI_EFFECTS,
  /** Presentation effects since the last call (live ticks only; neither saved nor hashed). */
  takeScriptUiEffects: (): readonly ScriptUiEffect[] => context.script?.engine.takeUiEffects() ?? NO_SCRIPT_UI_EFFECTS
});
