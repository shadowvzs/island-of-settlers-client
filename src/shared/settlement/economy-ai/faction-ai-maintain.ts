import type { SettlementContext } from "../settlement-types";
import { MAINTAIN_DONE, MAINTAIN_REFUSED } from "./constants";
import { reportMaintain } from "./faction-ai-probe";
import type { FactionAiLayer } from "./faction-ai-types";
import { regarrisonFromReserve } from "./maintain-garrison";
import { rebuildOnePlot, trackFactionRuins } from "./maintain-rebuild";
import { repairOneWall } from "./maintain-repair";
import type { MaintainState } from "./maintain-state";

/** Refused wall repairs so far (a refusal adds an attempt), so the probe hears a new one. */
const repairRefusals = (state: MaintainState) =>
  state.repairs.reduce((sum, entry) => sum + (entry.attempts ?? 0), 0);

/**
 * The `maintain` decision of one faction's layer (enemy economy AI plan §4.1, EAI2b). The loop calls it in the tick,
 * on the layer's staggered due tick, only while the faction plays `maintain` or `develop` and is not paused. It reads
 * only the faction's own state (its ruins, buildings and stored soldiers) and acts through the player's paths:
 * - planner (2 s): a fallen building's ruin is cleared by the faction's own settlers (BD2 clearing job, waiting while
 *   enemies the faction knows stand near), then the plot is asked for again from the faction's depot stock; and
 *   one damaged wall of the faction gets a repairer with its share of the construction cost (EAI2d);
 * - military (3 s, unless `regarrison` is false: a `develop` faction fills its towers to its own targets): stored
 *   soldiers of the depot, else idle uncommitted field soldiers, walk to its garrison buildings below target.
 * Catapult ground stone needs no decision: a computer economy's Catapult asks its carriers for stone through the
 * shared logistics demand, as the player's does. Every quota is a count (plan §3.1). Returns whether the planner
 * layer placed a site (a decision places at most one).
 */
export const runMaintainDecision = (
  context: SettlementContext, faction: number, layer: FactionAiLayer, state: MaintainState, regarrison: boolean
) => {
  if (layer === "planner") {
    const now = context.clock?.tick() ?? 0;
    trackFactionRuins(context, faction, state);
    const placed = rebuildOnePlot(context, faction, state, now);
    const refusals = repairRefusals(state);
    if (repairOneWall(context, faction, state, now)) reportMaintain(faction, now, "repair", MAINTAIN_DONE);
    else if (repairRefusals(state) > refusals) reportMaintain(faction, now, "repair", MAINTAIN_REFUSED);
    return placed;
  }
  if (layer !== "military" || !regarrison) return false;
  const sent = regarrisonFromReserve(context, faction);
  if (sent) reportMaintain(faction, context.clock?.tick() ?? 0, "garrison", String(sent));
  return false;
};
