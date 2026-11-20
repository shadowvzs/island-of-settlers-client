import type { ScenarioFactionAi } from "../../world/scenario-faction-ai";
import { firstDueTick } from "../commander/director-clock";
import { DEVELOP_MODE, FACTION_AI_CLOCK_SLOTS, FACTION_AI_LAYER_TICKS } from "./constants";
import { createDevelopState, restoreDevelopState, saveDevelopState } from "./develop-state";
import type { FactionAiSave, FactionAiSetting, FactionAiSnapshot, FactionAiState } from "./faction-ai-types";
import { copyFactionGoal } from "./faction-goal";
import {
  createFactionStrategyState, restoreFactionStrategyState, saveFactionStrategyState
} from "./faction-strategy-state";
import { createMaintainState, restoreMaintainState, saveMaintainState } from "./maintain-state";
import { createPlannerState, restorePlannerState, savePlannerState } from "./planner-state";

/** The modes that run an economy (`none` keeps today's rules). */
export const runsEconomy = (mode: string) => mode !== "none";

/** Writes each layer's first due tick after `now` on the faction's quarter slot (plan §3.3). */
const scheduleFirst = (due: number[], faction: number, now: number) => {
  for (let layer = 0; layer < FACTION_AI_LAYER_TICKS.length; layer++)
    due[layer] = firstDueTick(faction, now, FACTION_AI_LAYER_TICKS[layer]!, FACTION_AI_CLOCK_SLOTS);
};

/** The map's choice again, with fresh clocks: a fresh start, a script's first change, or a save without state. */
const resetFactionAiState = (state: FactionAiState, now: number) => {
  state.economy = runsEconomy(state.authored.mode);
  restoreDevelopState(state.develop, undefined);
  restoreMaintainState(state.maintain, undefined);
  restorePlannerState(state.planner, undefined);
  restoreFactionStrategyState(state.strategy, undefined);
  state.goal = undefined;
  state.level = undefined;
  state.mode = state.authored.mode;
  state.paused = false;
  state.style = undefined;
  scheduleFirst(state.due, state.faction, now);
};

export const createFactionAiState = (authored: Readonly<ScenarioFactionAi>, now: number): FactionAiState => {
  const state: FactionAiState = {
    authored, develop: createDevelopState(),
    diagnostics: { decisions: FACTION_AI_LAYER_TICKS.map(() => 0), threat: { health: 0, soldiers: 0 } },
    due: [], economy: runsEconomy(authored.mode), faction: authored.faction, maintain: createMaintainState(),
    mode: authored.mode, paused: false, planner: createPlannerState(), strategy: createFactionStrategyState()
  };
  resetFactionAiState(state, now);
  return state;
};

export const restoreFactionAiState = (state: FactionAiState, saved: FactionAiSave) => {
  state.economy = runsEconomy(state.authored.mode) || saved.economy === true;
  restoreDevelopState(state.develop, saved.develop);
  restoreMaintainState(state.maintain, saved.maintain);
  restorePlannerState(state.planner, saved.planner);
  restoreFactionStrategyState(state.strategy, saved.strategy);
  state.goal = saved.goal && copyFactionGoal(saved.goal);
  state.level = saved.level;
  state.mode = saved.mode;
  state.paused = saved.paused === true;
  state.style = saved.style;
  state.due.splice(0, state.due.length, ...saved.due);
};

/** The script-woken economy flag: saved only for a faction the map left at `none`. */
const wokenEconomy = ({ authored, economy }: FactionAiState) =>
  economy && !runsEconomy(authored.mode) ? { economy: true as const } : {};

export const saveFactionAiState = (state: FactionAiState): FactionAiSave => {
  const { develop, due, faction, goal, level, maintain, mode, paused, planner, strategy, style } = state;
  const developSave = saveDevelopState(develop);
  const maintainSave = saveMaintainState(maintain), plannerSave = savePlannerState(planner);
  const strategySave = saveFactionStrategyState(strategy);
  return {
    ...(developSave ? { develop: developSave } : {}), due: [...due], ...wokenEconomy(state), faction,
    ...(goal ? { goal: copyFactionGoal(goal) } : {}), ...(level ? { level } : {}),
    ...(maintainSave ? { maintain: maintainSave } : {}), mode,
    ...(paused ? { paused: true as const } : {}), ...(plannerSave ? { planner: plannerSave } : {}),
    ...(strategySave ? { strategy: strategySave } : {}), ...(style ? { style } : {})
  };
};

export const factionAiSnapshot = (state: FactionAiState): FactionAiSnapshot => ({
  ...saveFactionAiState(state), decisions: [...state.diagnostics.decisions], threat: { ...state.diagnostics.threat }
});

/** The setting of a map entry, with the faction's state when a script or the map gave it one. */
export const factionAiSettingOf = (
  authored: Readonly<ScenarioFactionAi>, state: FactionAiState | undefined
): FactionAiSetting => {
  const mode = state?.mode ?? authored.mode;
  return {
    level: state?.level ?? authored.level,
    mode,
    paused: state?.paused === true,
    style: mode === DEVELOP_MODE ? state?.style ?? authored.style : undefined
  };
};
