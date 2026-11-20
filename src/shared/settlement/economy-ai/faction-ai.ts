import { AI_POSTURES } from "@shared/catalog/ai/build-programs";

import { FACTION_AI_LEVELS, FACTION_AI_MODES, FACTION_AI_STYLES } from "../../world/constants";
import type {
  FactionAiLevel, FactionAiMode, FactionAiStyle, ScenarioFactionAi
} from "../../world/scenario-faction-ai";
import { scriptableFactionAi } from "../../world/scenario-faction-ai-script";
import { commanderPaceOf } from "../commander/commander-profile-source";
import { firstDueTick } from "../commander/director-clock";
import { markSeenCells } from "../faction-discovery";
import type { SettlementContext } from "../settlement-types";
import {
  DEVELOP_LAYER_TICKS, DEVELOP_MODE, FACTION_AI_CLOCK_SLOTS, FACTION_AI_LAYER_TICKS, FACTION_AI_LAYERS,
  FACTION_GOAL_LAYER, GROW_POSTURE
} from "./constants";
import { postureOf } from "./develop-goals";
import { factionProgram } from "./develop-strategy";
import {
  createDevelopQueries, decideDevelop, planDevelop, prepareDevelop, stepDevelopPlacement
} from "./faction-ai-develop";
import { runMaintainDecision } from "./faction-ai-maintain";
import { readKnownThreat } from "./faction-ai-perception";
import { reportFactionAiDecision } from "./faction-ai-probe";
import {
  createFactionAiState, factionAiSettingOf, factionAiSnapshot, restoreFactionAiState, runsEconomy, saveFactionAiState
} from "./faction-ai-state";
import type { FactionAiSave, FactionAiSetting, FactionAiSnapshot, FactionAiState } from "./faction-ai-types";
import {
  activeFactionGoal, copyFactionGoal, isFactionGoal, isMilitaryGoalActive, releaseFactionGoal, runFactionGoal
} from "./faction-goal";
import { runFactionStrategy } from "./faction-strategy";

const isOneOf = <Value>(values: readonly Value[], value: unknown): value is Value =>
  (values as readonly unknown[]).includes(value);
const isLevel = (value: unknown): value is FactionAiLevel => isOneOf(FACTION_AI_LEVELS, value);
const isMode = (value: unknown): value is FactionAiMode => isOneOf(FACTION_AI_MODES, value);
const isStyle = (value: unknown): value is FactionAiStyle => isOneOf(FACTION_AI_STYLES, value);
const isFlag = (value: unknown): value is boolean => typeof value === "boolean";

/** Whether the faction decides now: not paused and in `maintain` or `develop` (`develop` grows from P3 on). */
const decides = (state: FactionAiState) => !state.paused && state.mode !== "none";

/**
 * One due layer of a deciding faction: the strategic layer first reads what the faction knows of enemy soldiers (plan
 * §3.2); the military layer states the faction's own intents while no script goal states them (EAI4b); a `develop`
 * faction's own decisions (goal and survey, economy manager), then the `maintain` decision, which a `develop`
 * faction plays too (rebuild on ruins, repair, re-garrison). When maintaining placed nothing, a `develop` faction's
 * planner layer places for its committed goal (EAI3b).
 */
const decide = (context: SettlementContext, state: FactionAiState, layer: number, now: number) => {
  const name = FACTION_AI_LAYERS[layer]!;
  if (name === "strategic") readKnownThreat(context, state.faction, state.diagnostics.threat);
  if (name === "military" && !isMilitaryGoalActive(state.goal, now)) runFactionStrategy(context, state, now);
  if (state.mode === DEVELOP_MODE) decideDevelop(context, state, name, now);
  const placed = runMaintainDecision(context, state.faction, name, state.maintain, state.mode !== DEVELOP_MODE);
  if (!placed && name === "planner" && state.mode === DEVELOP_MODE) planDevelop(context, state, now);
};

/**
 * Each layer's interval: a `develop` faction's at the pace of its level now (plan §5.1, EAI5a), every other mode's
 * at §3.3's (a level only applies to `develop`).
 */
const layerTicksOf = (context: SettlementContext, state: FactionAiState) =>
  (state.mode === DEVELOP_MODE ? DEVELOP_LAYER_TICKS[commanderPaceOf(context, state.faction)] : FACTION_AI_LAYER_TICKS);

/**
 * The layer's next due tick: one interval (the level-scaled one, EAI5a) after the slot it was due on. A layer overdue by
 * a whole interval (the first live tick after a frozen catch-up, plan §5.3) goes back to its faction's slot, so factions
 * stay staggered.
 */
const followingDueTick = (faction: number, due: number, now: number, period: number) =>
  due + period > now ? due + period : firstDueTick(faction, now, period, FACTION_AI_CLOCK_SLOTS);

/**
 * Runs every layer of the faction that is due at `now`; a layer's clock advances even while it is not deciding. A
 * timed script goal ends at its own tick (EAI4-FOLLOWUP), not at the next military layer, so a faction with nothing
 * to decide never keeps an expired goal in its save.
 */
const updateFaction = (context: SettlementContext, state: FactionAiState, now: number) => {
  if (state.goal && !activeFactionGoal(state.goal, now)) runFactionGoal(context, state, now, false);
  if (state.planner.pending && decides(state)) stepDevelopPlacement(context, state, now);
  let intervals: readonly number[] | undefined;
  for (let layer = 0; layer < FACTION_AI_LAYER_TICKS.length; layer++) {
    const due = state.due[layer]!;
    if (due > now) continue;
    intervals ??= layerTicksOf(context, state);
    state.due[layer] = followingDueTick(state.faction, due, now, intervals[layer]!);
    if (layer === FACTION_GOAL_LAYER) runFactionGoal(context, state, now, decides(state));
    if (!decides(state)) continue;
    state.diagnostics.decisions[layer]!++;
    reportFactionAiDecision(state.faction, layer, now);
    decide(context, state, layer, now);
  }
};

/** The first tick `update` changes the faction on: its earliest due layer, or `now` while a placement is pending. */
const factionActionTick = (state: FactionAiState, now: number) => {
  if (state.planner.pending && decides(state)) return now;
  // A timed script goal ends on its own tick (EAI4-FOLLOWUP): a skip stops before it, as before a due layer.
  let next = state.goal?.until ?? Infinity;
  for (const due of state.due) if (due < next) next = due;
  return next;
};

/**
 * A frozen faction's discovered cells take no stamps (each catch-up mode moves different people, so its AI state
 * stays the same in all of them); thawing marks what the faction sees now, as a load's vision rebuild does.
 */
const trackDiscoveryWhile = (context: SettlementContext, state: FactionAiState, frozen: boolean) => {
  const bits = frozen ? undefined : state.develop.discovered;
  if (bits) markSeenCells(bits, context.factionVision?.layer(state.faction));
  context.factionVision?.trackDiscovery(state.faction, bits);
};

const byFaction = (first: { faction: number }, second: { faction: number }) => first.faction - second.faction;

/**
 * The computer economies a script added to the map's (EAI2b): every faction whose state runs one, ascending; undefined
 * while it equals the map's set, so every island without a woken faction keeps the map's lists (and its hashes).
 */
const wokenEconomies = (states: readonly FactionAiState[]) => {
  if (!states.some(state => state.economy && !runsEconomy(state.authored.mode))) return undefined;
  return states.filter(state => state.economy).map(state => state.faction);
};

/**
 * The enemy economy AI of an island (plan §3, P2 skeleton): one state per computer faction that plays an AI, factions
 * ascending. The map's `maintain`/`develop` factions have one from the start; a faction a script addresses
 * (`scriptableFactionAi`: a `none` entry, or one that only owns authored units or buildings) gets one at its first
 * change. Each layer decides on its own cadence on absolute game ticks, staggered per faction, so the decisions are
 * the same at any frame rate and across a save. A map without AI has no state: `update` returns at once and nothing
 * is saved, so its hashes stay as before.
 */
export const createFactionAi = (context: SettlementContext) => {
  const tick = () => context.clock?.tick() ?? 0;
  const entries = [...scriptableFactionAi(context.options.world.scenario)].sort(byFaction);
  const entryOf = (faction: number) => entries.find(entry => entry.faction === faction);
  const states: FactionAiState[] = [];
  /** Offline catch-up (plan §5.3 v1): no decision, placement or clock moves; never saved. */
  let frozen = false;
  /** The live economy set when a script woke a faction (a new array on every change: lists memoise by it). */
  let economies: readonly number[] | undefined;
  const refreshEconomies = () => {
    const next = wokenEconomies(states);
    if (next?.join() !== economies?.join()) economies = next;
  };
  const startStates = (now = tick()) => {
    for (const state of states) context.factionVision?.trackDiscovery(state.faction, undefined);
    states.length = 0;
    for (const entry of entries) if (entry.mode !== "none") states.push(createFactionAiState(entry, now));
    for (const state of states) prepareDevelop(context, state, false);
  };
  startStates();
  const stateOf = (faction: number) => states.find(state => state.faction === faction);
  /** The faction's state, created with fresh clocks for a scriptable faction that has none yet. */
  const changeableState = (faction: number) => {
    const existing = stateOf(faction);
    const entry = existing ? undefined : entryOf(faction);
    if (existing || !entry) return existing;
    const created = createFactionAiState(entry, tick());
    states.push(created);
    states.sort(byFaction);
    return created;
  };
  /** Applies `apply` to the faction's state; false for a faction no script may address or a refused value. */
  const change = <Value>(faction: number, value: unknown, valid: (value: unknown) => value is Value,
    apply: (state: FactionAiState, value: Value) => void) => {
    if (!valid(value)) return false;
    const state = changeableState(faction);
    if (!state) return false;
    apply(state, value);
    prepareDevelop(context, state, true);
    if (frozen) trackDiscoveryWhile(context, state, frozen);
    return true;
  };
  const restoreSaved = (entry: Readonly<ScenarioFactionAi>, saved: FactionAiSave, now: number) => {
    const state = createFactionAiState(entry, now);
    restoreFactionAiState(state, saved);
    states.push(state);
  };
  /** A deciding `develop` faction's state; undefined for every other faction. */
  /** Scratch of `posture`: the decisions keep their own summary in the faction's diagnostics. */
  const postureThreat = { health: 0, soldiers: 0 };
  const developing = (faction: number) => {
    const state = stateOf(faction);
    return state && decides(state) && state.mode === DEVELOP_MODE ? state : undefined;
  };
  return {
    ...createDevelopQueries(context, developing, stateOf, tick),
    /** Plain copies of every faction's state for the dev overlay; reads nothing the decisions use. */
    diagnostics: (): FactionAiSnapshot[] => states.map(factionAiSnapshot),
    /**
     * A load: the saved states, or the map's choice with fresh clocks from the save's tick `now` when the save has
     * none (format ≤ 16). It runs before the stock pools are restored, which ask for the economy set.
     */
    restore: (saved: readonly FactionAiSave[] | undefined, now: number) => {
      startStates(now);
      for (const entry of saved ?? []) {
        const state = stateOf(entry.faction);
        if (state) restoreFactionAiState(state, entry); else restoreSaved(entryOf(entry.faction)!, entry, now);
      }
      states.sort(byFaction);
      for (const state of states) prepareDevelop(context, state, false);
      refreshEconomies();
    },
    /** The computer economies when a script woke one (map ∪ woken, ascending); undefined: the map's set. */
    liveEconomies: () => economies,
    /**
     * The first game tick `update` acts on (EAI5b): the skip paths stop before it, so a skipped tick never holds an
     * AI decision. Infinity while frozen or without AI factions.
     */
    nextActionTick: () => {
      if (frozen) return Infinity;
      const now = tick();
      let next = Infinity;
      for (const state of states) next = Math.min(next, factionActionTick(state, now));
      return next;
    },
    /** Undefined on every island without AI, so its save and state hash are unchanged. */
    save: (): FactionAiSave[] | undefined => states.length ? states.map(saveFactionAiState) : undefined,
    /**
     * What a deciding faction plays for (the script function `factionPosture`): its running script goal, else its
     * own posture from what it knows of enemy soldiers now (A13 knowledge, read like the strategic layer's).
     */
    posture: (faction: number) => {
      const state = stateOf(faction);
      if (!state || !decides(state)) return undefined;
      const goal = activeFactionGoal(state.goal, tick());
      if (goal) return goal.goal;
      readKnownThreat(context, faction, postureThreat);
      const calm = state.mode === DEVELOP_MODE ? factionProgram(context, state).calmPosture : GROW_POSTURE;
      return AI_POSTURES[postureOf(postureThreat.soldiers, calm)];
    },
    /** The level a script set for the faction (the commander's script source, after `setCommanderLevel`). */
    scriptLevel: (faction: number) => stateOf(faction)?.level,
    /*
     * The script-facing controls (EAI2c `setFactionAi`, `factionAiPause` through `faction-ai-script.ts`, which
     * checks the map's rules first): each acts in the tick that calls it and the AI reads it at its next due
     * decision. Downgrading to `none` keeps everything standing and stops the decisions; the style leaves with
     * the develop mode.
     */
    /**
     * `setFactionGoal` (EAI4c): the goal replaces the faction's running one; the military layer carries it out
     * from its next decision. A military goal that gives way to `expand` hands its soldiers back at once.
     */
    setGoal: (faction: number, goal: unknown) => change(faction, goal, isFactionGoal, (state, value) => {
      if (value.goal === "expand") releaseFactionGoal(context, faction, state.goal);
      state.goal = copyFactionGoal(value);
    }),
    setLevel: (faction: number, level: unknown) =>
      change(faction, level, isLevel, (state, value) => { state.level = value; }),
    setMode: (faction: number, mode: unknown) => change(faction, mode, isMode, (state, value) => {
      state.mode = value;
      if (value !== DEVELOP_MODE) state.style = undefined;
      if (!runsEconomy(value)) return;
      state.economy = true;
      refreshEconomies();
    }),
    /**
     * Offline catch-up freezes the AI (plan §5.3 v1): no new site, order, goal expiry, discovery stamp or clock step.
     * Its buildings keep producing through the shared economy. The clocks stay where the save left them, so every
     * layer that came due decides once on the first live tick, then returns to its faction's slot.
     */
    setFrozen: (value: boolean) => {
      if (value === frozen) return;
      frozen = value;
      for (const state of states) trackDiscoveryWhile(context, state, frozen);
    },
    setPaused: (faction: number, paused: unknown) =>
      change(faction, paused, isFlag, (state, value) => { state.paused = value; }),
    setStyle: (faction: number, style: unknown) =>
      change(faction, style, isStyle, (state, value) => { state.style = value; }),
    /** The faction's AI as it plays now; undefined for a faction that is not on the map. */
    setting: (faction: number): FactionAiSetting | undefined => {
      const entry = entryOf(faction);
      return entry && factionAiSettingOf(entry, stateOf(faction));
    },
    /** The economy AI tick phase: after the military update, before the half-second scheduler (plan §3.1). */
    update: () => {
      if (frozen || !states.length) return;
      const now = tick();
      for (const state of states) updateFaction(context, state, now);
    }
  };
};

export type FactionAi = ReturnType<typeof createFactionAi>;
