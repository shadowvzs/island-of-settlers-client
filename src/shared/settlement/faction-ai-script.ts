import { secondsToTicks } from "../../../../island-of-settlers-shared/src/time/constants";
import { FACTION_AI_GOALS, FACTION_AI_LEVELS, FACTION_AI_MODES, FACTION_AI_STYLES } from "../world/constants";
import type { FactionAiMode, ScenarioFactionAi } from "../world/scenario-faction-ai";
import { checkFactionAi, type FactionAiIssueCode } from "../world/scenario-faction-ai-issues";
import { scriptableFactionAi } from "../world/scenario-faction-ai-script";
import type { AreaRef } from "./commander/strategic-intents";
import { DEVELOP_MODE } from "./economy-ai/constants";
import type { FactionAi } from "./economy-ai/faction-ai";
import type { FactionAiSetting } from "./economy-ai/faction-ai-types";
import { baseArea } from "./economy-ai/faction-base";
import type { SettlementContext } from "./settlement-types";

/**
 * What a map script changes of a computer faction's economy AI (`setFactionAi`, `factionAiPause`; enemy economy AI
 * plan §5.2, lane EAI2c; `setFactionGoal`, lane EAI4c): the map's rules are checked here, then the change goes to
 * the economy AI's own state (`economy-ai/faction-ai.ts`, EAI2a), the one source of the faction's live mode, style,
 * level, pause and goal.
 */

/** What one action asks for; absent fields keep their value. Values come from script arguments unchecked. */
export interface FactionAiChange {
  level?: unknown;
  mode?: unknown;
  paused?: boolean;
  style?: unknown;
}

const isOneOf = <Value extends string>(values: readonly Value[], value: unknown): value is Value =>
  (values as readonly unknown[]).includes(value);

const mapEntries = (context: SettlementContext) => scriptableFactionAi(context.options.world.scenario);

/**
 * A computer faction's AI as it plays now, or undefined for a faction that is not on the map (no AI entry, no
 * authored unit or building). The economy AI reads it at its next due decision (plan §5.2).
 */
export const factionAiSetting = (context: SettlementContext, faction: number): FactionAiSetting | undefined =>
  context.factionAi?.setting(faction);

const knownChange = ({ level, mode, style }: FactionAiChange) =>
  (level === undefined || isOneOf(FACTION_AI_LEVELS, level)) &&
  (mode === undefined || isOneOf(FACTION_AI_MODES, mode)) &&
  (style === undefined || isOneOf(FACTION_AI_STYLES, style));

/** Why a script's change is refused: EAI0a's issue codes, or a faction that is not on the map. */
export type FactionAiRefusal = FactionAiIssueCode | "factionNotOnMap";

/** The map's entries as they would play with `faction` at `mode` (a style stays with the develop mode only). */
const entriesWith = (context: SettlementContext, ai: FactionAi, faction: number, mode: FactionAiMode) =>
  mapEntries(context).map((entry): ScenarioFactionAi => {
    const { style, ...rest } = entry;
    const played = entry.faction === faction ? mode : ai.setting(entry.faction)?.mode ?? entry.mode;
    return played === DEVELOP_MODE && style ? { ...rest, mode: played, style } : { ...rest, mode: played };
  });

/**
 * EAI0a's Ready rules on the island as it would play after a mode switch: the develop and maintain entry rules
 * (start settlers, a faction that could never act), one develop faction per map and the island's people target.
 */
const switchRefusal = (
  context: SettlementContext, ai: FactionAi, faction: number, mode: FactionAiMode
): FactionAiRefusal | null => {
  const { cellsX, cellsZ, scenario } = context.options.world;
  const played = { ...scenario, factionAi: entriesWith(context, ai, faction, mode) };
  return checkFactionAi(played, { cellsX, cellsZ }).find(issue => issue.severity === "error")?.code ?? null;
};

/** Why the change is refused, or null. Only a mode switch re-checks the map's rules. */
const changeRefusal = (
  context: SettlementContext, ai: FactionAi, faction: number, change: FactionAiChange
): FactionAiRefusal | null => {
  const setting = ai.setting(faction);
  if (!setting) return "factionNotOnMap";
  if (!knownChange(change)) return "invalidField";
  const mode = (change.mode ?? setting.mode) as FactionAiMode;
  if (change.style !== undefined && mode !== DEVELOP_MODE) return "styleWithoutDevelop";
  return change.mode === undefined ? null : switchRefusal(context, ai, faction, mode);
};

/** Writes an accepted change through the economy AI's setters (mode first: a style leaves with develop). */
const commitFactionAiChange = (ai: FactionAi, faction: number, { level, mode, paused, style }: FactionAiChange) => {
  if (mode !== undefined) ai.setMode(faction, mode);
  if (style !== undefined) ai.setStyle(faction, style);
  if (level !== undefined) ai.setLevel(faction, level);
  if (paused !== undefined) ai.setPaused(faction, paused);
};

/**
 * Applies a script's change in the tick. Null when it is applied, else why it is refused (nothing changes). A
 * changed level also moves the faction's commander (A14 plan §7 step 1), so its cached weights are dropped.
 */
export const applyFactionAiChange = (
  context: SettlementContext, faction: number, change: FactionAiChange
): FactionAiRefusal | null => {
  const ai = context.factionAi;
  if (!ai) return "factionNotOnMap";
  const refusal = changeRefusal(context, ai, faction, change);
  if (refusal) return refusal;
  commitFactionAiChange(ai, faction, change);
  if (change.level !== undefined) context.commanderLevels?.invalidate();
  return null;
};

/** What `setFactionGoal` asks for; `goal` and `seconds` come from script arguments unchecked. */
export interface FactionGoalRequest {
  /** The step's region as a circle; absent: anywhere (attack, expand) or the faction's own base (defend, hold). */
  area?: AreaRef;
  goal: unknown;
  /** How long the goal runs; absent: until the next goal. */
  seconds?: unknown;
}

export type FactionGoalRefusal = "factionNotOnMap" | "goalWithoutPost" | "invalidField";

const isPostGoal = (goal: string) => goal === "defend" || goal === "hold";

/**
 * Applies a script's goal in the tick (`setFactionGoal`, EAI4c). Null when it is set, else why it is refused
 * (nothing changes): a faction that is not on the map, an unknown goal, a duration that is not more than 0 seconds,
 * or a `defend` / `hold` without a region for a faction that owns no building. The goal is kept for a faction whose
 * AI takes no decisions (`none`, paused) and acts once it decides; the AI reads it at its next military decision.
 */
export const applyFactionGoal = (
  context: SettlementContext, faction: number, { area, goal, seconds }: FactionGoalRequest
): FactionGoalRefusal | null => {
  const ai = context.factionAi;
  if (!ai?.setting(faction)) return "factionNotOnMap";
  const timed = seconds !== undefined;
  if (!isOneOf(FACTION_AI_GOALS, goal)) return "invalidField";
  if (timed && !(typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0)) return "invalidField";
  const where = area ?? (isPostGoal(goal) ? baseArea(context, faction) : undefined);
  if (isPostGoal(goal) && !where) return "goalWithoutPost";
  const now = context.clock?.tick() ?? 0;
  const until = timed ? { until: now + Math.max(1, secondsToTicks(seconds)) } : {};
  return ai.setGoal(faction, { ...(where ? { area: where } : {}), goal, ...until }) ? null : "invalidField";
};
