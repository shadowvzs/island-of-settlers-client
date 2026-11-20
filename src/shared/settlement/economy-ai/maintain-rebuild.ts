import { NOT_AN_ECONOMY_FACTION, NOT_BUILDABLE } from "../settlement-faction-placement";
import type { SettlementContext } from "../settlement-types";
import { MAINTAIN_DONE } from "./constants";
import { reportMaintain } from "./faction-ai-probe";
import { backOffGoal, forgetGoal, isGoalDue, type MaintainState } from "./maintain-state";

/** Refusals no later state can lift: the faction lost its economy, or its type is never built (a headquarters). */
const PERMANENT_REFUSALS: ReadonlySet<string | undefined> = new Set([NOT_AN_ECONOMY_FACTION, NOT_BUILDABLE]);

const hasRuin = (context: Pick<SettlementContext, "ruins">, uid: number) =>
  context.ruins?.some(ruin => ruin.uid === uid) === true;

const isTracked = (state: MaintainState, uid: number) => state.rebuilds.some(entry => entry.uid === uid);

/** Remembers every ruin of the faction not yet remembered, in the ruins' (fall) order. */
export const trackFactionRuins = (
  context: Pick<SettlementContext, "ruins">, faction: number, state: MaintainState
) => {
  for (const ruin of context.ruins ?? []) {
    if (ruin.owner !== faction || isTracked(state, ruin.uid)) continue;
    const { rotation, typeId, uid, x, z } = ruin;
    state.rebuilds.push({ rotation, typeId, uid, x, z });
  }
};

/** The first remembered plot whose ruin is cleared and whose backoff is over. */
const nextDueRebuild = (context: Pick<SettlementContext, "ruins">, state: MaintainState, now: number) =>
  state.rebuilds.find(entry => isGoalDue(entry, now) && !hasRuin(context, entry.uid));

/**
 * At most one placement per decision (plan §3.5 quota): the first cleared plot is asked for again through the
 * faction's own placement (`placeFactionBuilding`: plot rules, territory and the faction's own stock, then its
 * builders and carriers). A refusal backs the plot off; once the depot stock runs out every try is refused, so the
 * faction stops rebuilding without stalling anything else. Returns whether a site was placed.
 */
export const rebuildOnePlot = (context: SettlementContext, faction: number, state: MaintainState, now: number) => {
  const placement = context.factionPlacement;
  const entry = placement && nextDueRebuild(context, state, now);
  if (!entry) return false;
  const { rotation, typeId, x, z } = entry;
  const placed = placement.placeFactionBuilding(faction, { rotation, typeId, x, z });
  reportMaintain(faction, now, "rebuild", placed.ok ? MAINTAIN_DONE : placed.reason ?? "");
  if (placed.ok || PERMANENT_REFUSALS.has(placed.reason)) forgetGoal(state.rebuilds, entry);
  else backOffGoal(entry, now);
  return placed.ok;
};
