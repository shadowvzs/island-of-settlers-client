import type {
  ScriptActionRequest, ScriptActionResult
} from "../../../../../island-of-settlers-shared/src/script/engine/ports";
import { GOAL_POST_RADIUS } from "../../settlement/economy-ai/constants";
import {
  applyFactionAiChange, applyFactionGoal, type FactionAiChange
} from "../../settlement/faction-ai-script";
import { factionArg, regionCircle, regionOf, type ScriptActionHost, valueArg } from "./action-host";

/**
 * `setFactionAi` and `factionAiPause` (enemy economy AI plan §5.2, lane EAI2c): a map script switches a computer
 * faction's economy AI mode, style and level, or pauses its decisions. The change applies in the tick and the AI
 * reads it at its next due decision; `none` keeps everything standing and stops decisions. Refused for a faction
 * that is not on the map (so on every home map), a player group, an unknown value, a style without the develop
 * mode and a mode switch the map's own AI rules refuse (`applyFactionAiChange`).
 * `setFactionGoal` (lane EAI4c) overrides the faction's strategic posture for a time: refused for a faction that is
 * not on the map, an unknown goal or region, and a duration that is not more than 0 seconds (`applyFactionGoal`).
 */

const DONE: ScriptActionResult = { kind: "done" };
const REFUSED: ScriptActionResult = { kind: "failed", outcome: "refused" };

type Handler = (host: ScriptActionHost, request: ScriptActionRequest) => ScriptActionResult;

const apply = (host: ScriptActionHost, { args }: ScriptActionRequest, change: FactionAiChange) => {
  const faction = factionArg(args.faction);
  if (faction === null) return REFUSED;
  return applyFactionAiChange(host.context, faction, change) === null ? DONE : REFUSED;
};

/** An unset slot keeps the faction's value; a set one that evaluates to nothing is refused as unknown. */
const choiceArg = ({ args, scope }: ScriptActionRequest, name: string) => {
  const arg = args[name];
  return arg === undefined || arg === null ? undefined : valueArg(scope, arg);
};

const setFactionAi: Handler = (host, request) => {
  const change = {
    level: choiceArg(request, "level"), mode: choiceArg(request, "mode"), style: choiceArg(request, "style")
  };
  if (change.level === undefined && change.mode === undefined && change.style === undefined) return REFUSED;
  return apply(host, request, change);
};

const factionAiPause: Handler = (host, request) => {
  const paused = valueArg(request.scope, request.args.paused);
  return typeof paused === "boolean" ? apply(host, request, { paused }) : REFUSED;
};

const setFactionGoal: Handler = (host, request) => {
  const { args, scope } = request, faction = factionArg(args.faction);
  const region = regionOf(host, args.region);
  const named = args.region !== undefined && args.region !== null;
  if (faction === null || (named && !region)) return REFUSED;
  const goal = {
    area: region && regionCircle(region, GOAL_POST_RADIUS), goal: valueArg(scope, args.goal),
    seconds: choiceArg(request, "seconds")
  };
  return applyFactionGoal(host.context, faction, goal) === null ? DONE : REFUSED;
};

export const FACTION_AI_ACTIONS: Readonly<Record<string, Handler>> = {
  factionAiPause, setFactionAi, setFactionGoal
};
