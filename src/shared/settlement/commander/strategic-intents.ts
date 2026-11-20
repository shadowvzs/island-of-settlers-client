import { MAX_INTENTS } from "../../balance/commander-director";
import { isOrdinaryTroopType, type OrdinaryTroopType } from "../military-combat-rules";
import { isSaveObject } from "../save-validation";
import type { DirectorMacro, DirectorTarget } from "./director-types";

/**
 * The strategic contract between the enemy economy AI and the military director (A14 plan §5.4, economy plan
 * §3.7, lane A14-4c). The economy states what it wants (intents) and funds soldiers; the director owns every
 * field decision and reports back through receipts, statuses and army requests.
 * Strengths are the director's integer strength points: 100 (`REFERENCE_SOLDIER`) is one full-health rank-0
 * swordsman (`DirectorForceStatus.strength` uses the same unit).
 * Without an economy AI no intents are set and the director acts on its defaults, exactly as before the
 * contract: a colony's counterattack permits become its forces, adventure camps hold (camp stance, no force) and
 * a campaign's scripted waves strike their goals. `status` then reports those forces as default intents.
 */
export interface AreaRef { x: number; z: number; radius: number }

export type KnownTargetRef = { kind: "site"; uid: number } | { kind: "area"; area: AreaRef };

export type StrategicIntent =
  | { kind: "defend"; area: AreaRef; priority: number }
  | { kind: "hold"; area: AreaRef }
  | { kind: "attack"; target: KnownTargetRef; minStrength: number }
  | { kind: "raid"; target: KnownTargetRef }
  | { kind: "scout"; area?: AreaRef }
  | { kind: "retreat" };

export type IntentKind = StrategicIntent["kind"];

export type IntentStatusKind = "accepted" | "rejectedUnknownTarget" | "forming" | "underway" | "done" | "failed";
const INTENT_STATUS_KINDS: readonly IntentStatusKind[] =
  ["accepted", "rejectedUnknownTarget", "forming", "underway", "done", "failed"];

/** The answer to one intent of a `setIntents` call (same index as the intent). */
export interface IntentReceipt { index: number; status: IntentStatusKind }

/** One intent's progress; `strength` is what the director has committed to it (strength points). */
export interface IntentStatus {
  index: number;
  kind: IntentKind;
  status: IntentStatusKind;
  strength: number;
  /** The director's force carrying the intent out (absent: none yet, or none needed). */
  force?: number;
}

export type ArmyRequestReason = "intentShortfall" | "counterComposition" | "lossReplacement";
const ARMY_REQUEST_REASONS: readonly ArmyRequestReason[] =
  ["intentShortfall", "counterComposition", "lossReplacement"];

/**
 * Soldiers the army wants built; a larger `priority` is more urgent. The economy decides whether to fund it.
 * Ordinary cavalry is retired (HORSE-RETIREMENT-01), so only foot types are ever requested.
 */
export interface ArmyRequest {
  type: OrdinaryTroopType;
  count: number;
  priority: number;
  reason: ArmyRequestReason;
}

export interface CommanderStrategicApi {
  /** Replaces the faction's intents (≤ 4, in priority order); read at the next director decision. */
  setIntents: (faction: number, intents: readonly StrategicIntent[]) => readonly IntentReceipt[];
  /** Per intent its status and committed strength; without intents, the director's own (default) forces. */
  status: (faction: number) => readonly IntentStatus[];
  /** What the army wants built (≤ 8 soldiers in all), recomputed at each director decision of the faction. */
  armyRequests: (faction: number) => readonly ArmyRequest[];
  /**
   * The enemy buildings the faction knows and may attack now, most urgent first (EAI4c): what an attack or raid
   * intent may name without being rejected and scouted.
   */
  knownTargets: (faction: number) => readonly DirectorTarget[];
  /** Soldiers the economy may garrison or release (not committed to a force), ascending uids. */
  uncommitted: (faction: number) => readonly number[];
  /**
   * Strength points of the faction's uncommitted soldiers standing in the field: what a new intent's force could
   * be formed from now (EAI4b weighs its attacks by it; soldiers inside buildings are the economy's to release).
   */
  fieldStrength: (faction: number) => number;
}

/** An intent as the director keeps it (saved): its status, committed strength and force. */
export interface IntentState {
  intent: StrategicIntent;
  status: IntentStatusKind;
  strength: number;
  force?: number;
  /** The site target was known at some decision (a known target that disappears has fallen). */
  known?: boolean;
  /** An attack or raid whose force has set out once (EAI4c `factionAttackLaunched` fires once per intent). */
  launched?: true;
}

const MAP_LIMIT = 2048;
const isCoordinate = (value: unknown) => typeof value === "number" && Number.isFinite(value) &&
  Math.abs(value) <= MAP_LIMIT;
const isCount = (value: unknown) => Number.isSafeInteger(value) && (value as number) >= 0;

const isArea = (value: unknown) => isSaveObject(value) && isCoordinate(value.x) && isCoordinate(value.z) &&
  isCoordinate(value.radius) && Number(value.radius) >= 0;

const isTarget = (value: unknown) => {
  if (!isSaveObject(value)) return false;
  return value.kind === "site" ? isCount(value.uid) : value.kind === "area" && isArea(value.area);
};

/** A well-formed intent (the economy AI, a script or a save may hand in anything). */
export const isStrategicIntent = (value: unknown): value is StrategicIntent => {
  if (!isSaveObject(value)) return false;
  switch (value.kind) {
    case "defend": return isArea(value.area) && isCount(value.priority);
    case "hold": return isArea(value.area);
    case "attack": return isTarget(value.target) && isCount(value.minStrength);
    case "raid": return isTarget(value.target);
    case "scout": return value.area === undefined || isArea(value.area);
    default: return value.kind === "retreat";
  }
};

const sameArea = (first: AreaRef | undefined, second: AreaRef | undefined) =>
  first === second || (first !== undefined && second !== undefined && first.x === second.x &&
    first.z === second.z && first.radius === second.radius);

const sameTarget = (first: KnownTargetRef, second: KnownTargetRef) => {
  if (first.kind === "site") return second.kind === "site" && first.uid === second.uid;
  return second.kind === "area" && sameArea(first.area, second.area);
};

/** The same order restated (a repeated `setIntents` keeps its force and status; a strength goal may change). */
export const sameIntent = (first: StrategicIntent, second: StrategicIntent) => {
  if (first.kind === "attack" || first.kind === "raid")
    return second.kind === first.kind && sameTarget(first.target, second.target);
  if (first.kind === "retreat") return second.kind === "retreat";
  return second.kind === first.kind && sameArea(first.area, second.area);
};

/** A plain copy of a valid intent (no caller object is kept). */
export const copyIntent = (intent: StrategicIntent): StrategicIntent => structuredClone(intent);

/** The site an attack or raid names, if it names one. */
export const intentSite = (intent: StrategicIntent) =>
  (intent.kind === "attack" || intent.kind === "raid") && intent.target.kind === "site"
    ? intent.target.uid : undefined;

/** The area an intent names: a post (defend, hold), a destination (attack, raid) or a scout goal. */
export const intentArea = (intent: StrategicIntent): AreaRef | undefined => {
  if (intent.kind === "attack" || intent.kind === "raid")
    return intent.target.kind === "area" ? intent.target.area : undefined;
  return intent.kind === "retreat" ? undefined : intent.area;
};

export const isFinished = (status: IntentStatusKind) => status === "done" || status === "failed";

/** Plan §5.4: defend → defend, hold → hold, attack → strike, raid → raid, scout → scout, retreat → withdraw. */
export const INTENT_MACROS: Readonly<Record<IntentKind, DirectorMacro>> = Object.freeze({
  attack: "strike", defend: "defend", hold: "hold", raid: "raid", retreat: "withdraw", scout: "scout"
});

/** The intent a macro stands for when the director acts on its own defaults (no economy AI). */
export const MACRO_INTENTS: Readonly<Record<DirectorMacro, IntentKind>> = Object.freeze({
  defend: "defend", hold: "hold", raid: "raid", regroup: "hold", scout: "scout", strike: "attack",
  withdraw: "retreat"
});

const isRequest = (value: unknown) => isSaveObject(value) && isOrdinaryTroopType(value.type) &&
  isCount(value.count) && Number(value.count) > 0 && isCount(value.priority) &&
  ARMY_REQUEST_REASONS.includes(value.reason as never);

const isIntentState = (value: unknown) => isSaveObject(value) && isStrategicIntent(value.intent) &&
  INTENT_STATUS_KINDS.includes(value.status as never) && isCount(value.strength) &&
  (value.force === undefined || isCount(value.force)) && (value.known === undefined || value.known === true) &&
  (value.launched === undefined || value.launched === true);

/** Null when a faction's saved intents and army requests are well formed. */
export const intentsSaveError = (intents: unknown, requests: unknown) => {
  if (intents === undefined) return requests === undefined ? null : "Army requests without intents";
  if (!Array.isArray(intents) || intents.length > MAX_INTENTS || !intents.every(isIntentState))
    return "Invalid strategic intents";
  if (requests !== undefined && (!Array.isArray(requests) || !requests.length || !requests.every(isRequest)))
    return "Invalid army requests";
  return null;
};
