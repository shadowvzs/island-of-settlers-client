import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import { isPlainObject } from "../../../../../island-of-settlers-shared/src/validation/index";
import { ACTION_STATE_LISTS as LIST_FIELDS } from "./constants";

/**
 * The saved state of the map script's presence and movement actions (TRG5a). Fades, story-controlled unit actions
 * (moves, clips, spyglass looks) and speech lines are timed on the script clock, so they freeze in catch-up and a
 * reload continues them identically. The story lock of a unit (§6.6) is its pending unit action: it starts with the
 * action and ends with its outcome or `release`. Hidden, invulnerable and looked-different units are uid lists.
 */

/** A unit fading in (shown) or out (then hidden or removed), on script ticks. */
export interface ScriptFade {
  actionId: number | null;
  actor: number;
  /** Fade out + keep: also drop the unit from every actor variable (owner 28). */
  clearVariables: boolean;
  direction: "in" | "out";
  endTick: number;
  startTick: number;
  then: "keep" | "remove";
}

/** A unit busy with a story action; `overridable: false` refuses player orders until the outcome. */
export interface ScriptUnitAction {
  actionId: number | null;
  actor: number;
  /** Clips and spyglass looks end here; moves end on arrival. */
  clip?: string;
  /** Guaranteed mode finishes a stuck move just before this script tick. */
  deadline: number | null;
  endTick?: number;
  generation: number;
  kind: "clip" | "move";
  overridable: boolean;
  /** Spyglass pitch (degrees; presentation). */
  pitch?: number;
  /** Move target: the region and its centre. */
  region?: string;
  target?: { x: number; z: number };
}

/** A spoken line (speech marker and speaker panel), until `endTick`. */
export interface ScriptSpeech {
  actionId: number | null;
  actor?: number;
  endTick: number;
  speaker?: string;
  startTick: number;
  text: QuestText;
}

export interface ScriptActionState {
  fades: ScriptFade[];
  hidden: number[];
  invulnerable: number[];
  /** Flat `[uid, nation]` pairs: units spawned with an explicit nation look (owner 19). */
  looks: (number | string)[];
  nextActionId: number;
  speech: ScriptSpeech[];
  units: ScriptUnitAction[];
}

export type SavedScriptActions = ScriptActionState;

export const createScriptActionState = (saved?: SavedScriptActions): ScriptActionState => saved
  ? structuredClone(saved)
  : { fades: [], hidden: [], invulnerable: [], looks: [], nextActionId: 1, speech: [], units: [] };

/** Nothing ever happened: the save omits the field, so earlier script saves stay byte-identical. */
export const isPristine = (state: ScriptActionState) =>
  state.nextActionId === 1 && LIST_FIELDS.every(field => state[field].length === 0);

/** Envelope check of the save field; the adapter owns the entries' meaning. */
export const validSavedActions = (value: unknown) => value === undefined || (isPlainObject(value) &&
  Number.isSafeInteger(value.nextActionId) && (value.nextActionId as number) >= 1 &&
  LIST_FIELDS.every(field => Array.isArray(value[field])));

/** Inserts or removes a uid in a sorted uid list. */
export const setMember = (list: number[], uid: number, member: boolean) => {
  const index = list.indexOf(uid);
  if (member && index < 0) {
    list.push(uid);
    list.sort((a, b) => a - b);
  }
  if (!member && index >= 0) list.splice(index, 1);
};
