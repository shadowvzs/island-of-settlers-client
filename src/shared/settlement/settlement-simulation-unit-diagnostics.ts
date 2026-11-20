import type { createSettlementMilitary } from "./settlement-military";
import type { SettlementContext } from "./settlement-types";
import { unitDecisionDiagnostics, unitDecisionSnapshot } from "./unit-decision-diagnostics";

/** Development overlay label budget: bounded data, never the full actor list. */
const OVERLAY_LABEL_LIMIT = 48;

/**
 * Read-only "why is it idle?" diagnostics of the settlement (A16). Nothing here advances, allocates
 * per tick or writes simulation state; a caller asks on demand at its own UI cadence.
 */
export const createSimulationUnitDiagnostics = (
  context: SettlementContext, military: ReturnType<typeof createSettlementMilitary>
) => ({
  /** One actor's current reason (Observe window and development inspection). */
  unitDiagnostics: (uid: number) => {
    const actor = context.actors.find(entry => entry.uid === uid);
    if (!actor) return undefined;
    return unitDecisionDiagnostics(context, actor, military.combatant(uid));
  },
  /** Development overlay: counts per reason and a bounded list of visible units. */
  unitDiagnosticsSnapshot: (maximumLabels = OVERLAY_LABEL_LIMIT) =>
    unitDecisionSnapshot(context, maximumLabels, military.combatant)
});
