import type {
  ScriptActionRequest, ScriptActionResult
} from "../../../../../island-of-settlers-shared/src/script/engine/ports";
import { findUnit } from "../script-actors";
import { finishRecord, type ScriptActionHost, scriptTickOf } from "./action-host";
import {
  createScriptActionState, isPristine, type SavedScriptActions, type ScriptActionState
} from "./action-state";
import { COMMANDER_ACTIONS } from "./commander";
import { ENVIRONMENT_ACTIONS } from "./environment";
import { FACTION_AI_ACTIONS } from "./faction-ai";
import { MAP_END_ACTIONS } from "./map-end";
import { MOVEMENT_ACTIONS, updateUnitActions } from "./movement";
import { finishFadeOut, PRESENCE_ACTIONS, startAuthoredActors } from "./presence";

/**
 * The map script's presence and movement actions on a settlement (TRG5a), the world environment actions
 * (ENV0), `endMap` (C9a), `setCommanderLevel` (A14-5) and the faction AI actions (EAI2c): the world port's
 * `performAction` for these ops, their per-tick progress (fades, moves, clips, speech), the story lock of units (§6.6) and what the renderer shows
 * (fade opacity, clips, spoken lines). Other ops stay `refused` until their lanes.
 */

export type StoryLock = "free" | "overridable" | "locked";

/** What the renderer reads: opacity of fading units, clips of scripted units, the lines being spoken. */
export interface ScriptPresentation {
  clips: { actor: number; clip: string; pitch?: number }[];
  fades: { actor: number; opacity: number }[];
  speech: ScriptActionState["speech"];
}

const HANDLERS = {
  ...PRESENCE_ACTIONS, ...MOVEMENT_ACTIONS, ...ENVIRONMENT_ACTIONS, ...MAP_END_ACTIONS, ...COMMANDER_ACTIONS,
  ...FACTION_AI_ACTIONS
};
const REFUSED: ScriptActionResult = { kind: "failed", outcome: "refused" };
const EMPTY_PRESENTATION: ScriptPresentation = Object.freeze({ clips: [], fades: [], speech: [] });

const updateFades = (host: ScriptActionHost) => {
  const tick = scriptTickOf(host);
  for (const fade of [...host.state.fades]) {
    if (!findUnit(host.context, fade.actor)) {
      finishRecord(host, host.state.fades, fade, "actorGone");
      continue;
    }
    if (tick < fade.endTick) continue;
    finishRecord(host, host.state.fades, fade, "done");
    if (fade.direction === "out") finishFadeOut(host, fade.actor, fade.then, fade.clearVariables);
  }
};

/** Hidden units stay invisible whatever their own routine does (re-asserted after each tick). */
const keepHidden = (host: ScriptActionHost) => {
  for (const uid of host.state.hidden) {
    const actor = findUnit(host.context, uid);
    if (actor) actor.visible = false;
  }
  host.state.hidden = host.state.hidden.filter(uid => findUnit(host.context, uid));
};

/** Looks of units that left the world are dropped. */
const pruneLooks = (host: ScriptActionHost) => {
  const { looks } = host.state, kept: (number | string)[] = [];
  for (let index = 0; index + 1 < looks.length; index += 2) {
    if (findUnit(host.context, looks[index] as number)) kept.push(looks[index]!, looks[index + 1]!);
  }
  host.state.looks = kept;
};

const opacityOf = (fade: ScriptActionState["fades"][number], tick: number) => {
  const share = Math.min(1, Math.max(0, (tick - fade.startTick) / Math.max(1, fade.endTick - fade.startTick)));
  return fade.direction === "in" ? share : 1 - share;
};

export const createScriptActions = (host: Omit<ScriptActionHost, "state">, saved?: SavedScriptActions) => {
  const state = createScriptActionState(saved);
  const full: ScriptActionHost = { ...host, state };
  const lockOf = (uid: number): StoryLock => {
    const record = state.units.find(entry => entry.actor === uid);
    if (!record) return "free";
    return record.overridable ? "overridable" : "locked";
  };
  return {
    /** Player orders: overridable story actions end `interrupted`; locked units are left out. */
    admitPlayerOrder: (ids: readonly number[]) => ids.filter(uid => {
      const record = state.units.find(entry => entry.actor === uid);
      if (!record) return true;
      if (!record.overridable) return false;
      finishRecord(full, state.units, record, "interrupted");
      return true;
    }),
    isHidden: (uid: number) => state.hidden.includes(uid),
    isInvulnerable: (uid: number) => state.invulnerable.includes(uid),
    lockOf,
    /** The nation a unit was spawned to look like (owner 19), if any. */
    lookOf: (uid: number) => {
      const index = state.looks.indexOf(uid);
      return index >= 0 && index % 2 === 0 ? state.looks[index + 1] as string : undefined;
    },
    perform: (request: ScriptActionRequest): ScriptActionResult => HANDLERS[request.op]?.(full, request) ?? REFUSED,
    /** `tickFraction` (0..1 of the next tick) smooths the fades between simulation ticks. */
    presentation: (tickFraction = 0): ScriptPresentation => {
      if (!state.fades.length && !state.units.length && !state.speech.length) return EMPTY_PRESENTATION;
      const tick = scriptTickOf(full) + tickFraction;
      return {
        clips: state.units.flatMap(entry => entry.clip ? [{ actor: entry.actor, clip: entry.clip,
          ...(entry.pitch === undefined ? {} : { pitch: entry.pitch }) }] : []),
        fades: state.fades.map(fade => ({ actor: fade.actor, opacity: opacityOf(fade, tick) })),
        speech: state.speech
      };
    },
    save: (): { actions?: SavedScriptActions } => isPristine(state) ? {} : { actions: structuredClone(state) },
    /** End of each live tick, before the watches and the engine. */
    update: () => {
      updateFades(full);
      updateUnitActions(full);
      if (state.hidden.length) keepHidden(full);
      if (state.looks.length) pruneLooks(full);
    },
    /** Map start: hidden placed actors are hidden, `spawnAtStart` actors appear (as if at tick 0). */
    startMap: () => startAuthoredActors(full)
  };
};

export type ScriptActions = ReturnType<typeof createScriptActions>;
