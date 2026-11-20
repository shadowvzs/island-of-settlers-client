import { styleStrategyOf } from "@shared/catalog/ai/build-programs";

import { createDiscoveryBits, isCellDiscovered, markOwnedLand, markSeenCells } from "../faction-discovery";
import { type SettlementTerritory, settlementTerritory } from "../settlement-territory";
import type { SettlementContext } from "../settlement-types";
import { DEVELOP_MODE, PLANNER_REFUSED } from "./constants";
import { garrisonTowers } from "./develop-garrison";
import { runMilitaryEconomy } from "./develop-military";
import {
  committedGoal, factionProgram, factionStrategyRow, factionStyle, refuseCommittedGoal, runDevelopStrategy
} from "./develop-strategy";
import { knowsDeposit, recordDeposit, surveyOneDeposit } from "./develop-survey";
import { runEconomyDecision } from "./economy-manager";
import { economyStockOf } from "./economy-stock";
import { reportMaintain } from "./faction-ai-probe";
import type { FactionAiLayer, FactionAiState } from "./faction-ai-types";
import { runPlannerDecision } from "./planner";
import { stepPlannerPlacement } from "./planner-placement";

/**
 * Readies a `develop` faction before its first decision (creation, load, script change): its build program is
 * resolved, and its discovered cells get their bits and are stamped by the vision layer from now on. `live` (a
 * script's switch mid-game) also marks what the faction sees now; at creation the layer is empty, and after a load
 * the vision rebuild restamps the restored positions into the saved bits.
 */
export const prepareDevelop = (context: SettlementContext, state: FactionAiState, live: boolean) => {
  const { develop, faction } = state;
  if (state.mode === DEVELOP_MODE) {
    factionProgram(context, state);
    economyStockOf(factionStyle(state));
    if (!develop.discovered) {
      const { cellsX, cellsZ } = context.options.world;
      develop.discovered = createDiscoveryBits(cellsX * cellsZ);
      if (live) markSeenCells(develop.discovered, context.factionVision?.layer(faction));
    }
  }
  context.factionVision?.trackDiscovery(faction, develop.discovered);
};

/** The territory snapshot each faction's land was last marked from (derived: a reload marks it once again). */
const markedTerritory = new WeakMap<FactionAiState, SettlementTerritory>();

/** Marks the faction's own land discovered whenever its territory changed since the last strategic decision. */
const discoverOwnLand = (context: SettlementContext, state: FactionAiState) => {
  const bits = state.develop.discovered;
  if (!bits) return;
  const territory = settlementTerritory(context, state.faction);
  if (markedTerritory.get(state) === territory) return;
  markedTerritory.set(state, territory);
  markOwnedLand(bits, territory.owned, context.options.world.cellsX, territory.sources);
};

/**
 * The `develop` decisions of one due layer (plan §3.3): the strategic layer scores the build program (EAI3a), marks
 * its own land discovered and sends a geologist to a deposit it has seen; the economy layer runs the economy manager
 * (EAI3c) and funds its soldiers (EAI4a); the military layer mans its garrison buildings to its own targets (EAI4a).
 */
export const decideDevelop = (
  context: SettlementContext, state: FactionAiState, layer: FactionAiLayer, now: number
) => {
  const { develop, faction } = state;
  if (layer === "strategic") {
    runDevelopStrategy(context, state, state.diagnostics.threat, now);
    discoverOwnLand(context, state);
    surveyOneDeposit(context, faction, develop);
    return;
  }
  if (layer === "economy") {
    const style = factionStyle(state);
    const stock = economyStockOf(style);
    runEconomyDecision(context, faction, develop, stock);
    runMilitaryEconomy(context, state.authored, stock, develop.fortify, styleStrategyOf(style).soldierReserve);
    return;
  }
  if (layer !== "military") return;
  const sent = garrisonTowers(context, faction, develop.fortify, factionStrategyRow(context, state).raidParty);
  if (sent) reportMaintain(faction, now, "garrison", String(sent));
};

/**
 * The planner layer of a `develop` faction (EAI3b): places for its committed goal (one site per decision, plan §3.3);
 * a goal it cannot place backs off and is dropped until the next strategic decision (EAI3a).
 */
export const planDevelop = (context: SettlementContext, state: FactionAiState, now: number) => {
  const goal = committedGoal(context, state);
  if (goal && runPlannerDecision(context, state.faction, state.planner, goal, now) === PLANNER_REFUSED)
    refuseCommittedGoal(state.develop, now);
};

/** One step of a running planner placement, every tick after its decision (a refusal backs the goal off). */
export const stepDevelopPlacement = (context: SettlementContext, state: FactionAiState, now: number) => {
  if (stepPlannerPlacement(context, state.faction, state.planner, now) === PLANNER_REFUSED)
    refuseCommittedGoal(state.develop, now);
};

/**
 * What the planner (EAI3b) and the survey job ask of a faction's AI. `developing` is a deciding `develop` faction's
 * state; `stateOf` any faction's. The knowledge queries answer for every state that holds it (also while paused).
 */
export const createDevelopQueries = (
  context: SettlementContext, developing: (faction: number) => FactionAiState | undefined,
  stateOf: (faction: number) => FactionAiState | undefined, tick: () => number
) => ({
  /**
   * The build goal a deciding `develop` faction committed to at its last strategic decision (EAI3a): the building
   * type and the total count it wants. The planner (EAI3b) builds for it; undefined: nothing to build now.
   */
  currentGoal: (faction: number) => {
    const state = developing(faction);
    return state && committedGoal(context, state);
  },
  /** Whether the faction ever saw the cell (plan §3.2); false for a faction that tracks no discovery. */
  isDiscovered: (faction: number, cell: number) => {
    const bits = stateOf(faction)?.develop.discovered;
    return bits !== undefined && isCellDiscovered(bits, cell);
  },
  /** Whether one of the faction's geologists surveyed the mine zone `zone` (`world.mineZones` id). */
  knowsDeposit: (faction: number, zone: number) => {
    const state = stateOf(faction);
    return state !== undefined && knowsDeposit(state.develop, zone);
  },
  /** Whether the cell lies in a deposit the faction surveyed (a mine plot of the planner must reach one). */
  knowsDepositAt: (faction: number, cell: number) => {
    const zone = context.options.world.mineZone[cell] ?? 0;
    const state = stateOf(faction);
    return zone !== 0 && state !== undefined && knowsDeposit(state.develop, zone);
  },
  /** The faction's geologist surveyed the deposit (the survey job calls it). */
  recordDeposit: (faction: number, zone: number) => {
    const state = stateOf(faction);
    if (state) recordDeposit(state.develop, zone);
  },
  /**
   * The planner could not place the current goal: it backs off (plan §3.5) and the faction holds no goal until its
   * next strategic decision. False when the faction has no current goal.
   */
  refuseCurrentGoal: (faction: number) => {
    const state = developing(faction);
    return state !== undefined && refuseCommittedGoal(state.develop, tick());
  }
});
