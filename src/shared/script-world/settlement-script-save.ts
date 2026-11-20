import { FORMATS, formatVersionIssue } from "../../../../island-of-settlers-shared/src/formats";
import type { ScriptRunState } from "../../../../island-of-settlers-shared/src/script/types/run-state";
import { isPlainObject } from "../../../../island-of-settlers-shared/src/validation/index";
import { COUNTER_KEY_LENGTH } from "../quests/home-quest-save";
import { NATURE_SPACES, type SavedNatureGenerations } from "./nature/nature-actors";
import { type SavedScriptActions, validSavedActions } from "./actions/action-state";
import type { SavedActionCounters } from "./script-action-counters";
import { type SavedWorldEnvironment, validSavedWorldEnvironment } from "./world-environment-save";

/**
 * The saved form of an island's running map script (TRG3a): the engine run state without its script body (the
 * island save already carries the script snapshot), the reused-uid generations, the door watch's inside list and
 * the island's action counters (TRG4) and the generations of reused nature slots (TRG3b: animal pool slots,
 * respawned boulders, reappearing shells). The region watch saves nothing (it re-samples positions on load).
 */
export interface SavedSettlementScript extends SavedActionCounters {
  /** Presence/movement actions in progress, hidden and invulnerable units (TRG5a); absent while unused. */
  actions?: SavedScriptActions;
  /** Flat `[uid, building, garrison 0|1, …]` triples of people inside a building. */
  doors: number[];
  /** The world environment (ENV0); present only when the script reads or writes the hour or the weather. */
  environment?: SavedWorldEnvironment;
  /** Flat `[uid, generation, …]` pairs of reused unit shells. */
  generations: number[];
  /** Reused nature slots; absent while none was reused. */
  nature?: SavedNatureGenerations;
  state: Omit<ScriptRunState, "snapshot">;
}

const RECORD_FIELDS = ["actors", "firedCounts", "firesThisSecond", "multiboards", "quests", "timers", "values"];
const ARRAY_FIELDS = ["deferred", "disabledTriggers", "pendingHomeClaims", "presentationActors", "queued", "runs"];

const integers = (value: unknown, stride: number) => Array.isArray(value) && value.length % stride === 0 &&
  value.every(entry => Number.isSafeInteger(entry));

const nonNegative = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

const validCounters = (counters: unknown) => counters === undefined || (isPlainObject(counters) &&
  Object.entries(counters).every(([key, value]) => key.length <= COUNTER_KEY_LENGTH && nonNegative(value)));

const validNature = (nature: unknown) => nature === undefined || (isPlainObject(nature) &&
  Object.entries(nature).every(([space, pairs]) =>
    (NATURE_SPACES as readonly string[]).includes(space) && integers(pairs, 2)));

const stringList = (value: unknown) => Array.isArray(value) && value.every(entry => typeof entry === "string");

const validActiveCinematic = (active: unknown) => active === null || (isPlainObject(active) &&
  typeof active.sequenceId === "string" && typeof active.hold === "boolean" && typeof active.outcome === "boolean" &&
  nonNegative(active.startTick) && isPlainObject(active.actors) && stringList(active.applied) &&
  stringList(active.arrived) && Array.isArray(active.walks));

/** CIN4 sequence queue: absent until the first sequence was queued. */
const validCinematic = (cinematic: unknown) => cinematic === undefined || (isPlainObject(cinematic) &&
  validActiveCinematic(cinematic.active) && Array.isArray(cinematic.pending) && stringList(cinematic.seen));

const validRunState = (state: unknown) => {
  if (!isPlainObject(state) || "snapshot" in state) return false;
  if (formatVersionIssue(FORMATS.scriptRunState, state.version) !== null) return false;
  if (!nonNegative(state.scriptTick) || !nonNegative(state.nextRunId) || !nonNegative(state.rng)) return false;
  if (!validCinematic(state.cinematic)) return false;
  return RECORD_FIELDS.every(key => isPlainObject(state[key])) && ARRAY_FIELDS.every(key => Array.isArray(state[key]));
};

/** Save validation: absent (no script) or a well-formed envelope; the engine owns the run state's meaning. */
export const savedSettlementScriptProblem = (value: unknown): string | null => {
  if (value === undefined) return null;
  if (!isPlainObject(value)) return "Invalid script run state";
  if (!integers(value.doors, 3) || !integers(value.generations, 2) || !validCounters(value.counters) ||
    !validNature(value.nature) || !validSavedActions(value.actions) ||
    !(value.environment === undefined || validSavedWorldEnvironment(value.environment)))
    return "Invalid script run state";
  return validRunState(value.state) ? null : "Invalid script run state";
};
