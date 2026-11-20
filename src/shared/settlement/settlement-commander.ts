import { commanderEntries, type CommanderEntry, commanderEntry } from "@shared/catalog";

import { isNation } from "../../../../island-of-settlers-shared/src/nations";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { MILITARY_PROFILES } from "../balance/military";
import { deterministicPow } from "../math/deterministic-math";
import { type CommanderOperationId, isCommanderOperationId } from "./commander-operation-id";
import type { Goods } from "./settlement-types";

/**
 * Player commander rules (COMMANDER-SYSTEM-01 bounded slice). One commander per island is represented
 * as a mounted military soldier with a stable id; the ordinary cavalry profile supplies only the base
 * mounting silhouette, never an ordinary promotion/rank multiplier.
 *
 * Source: docs/plans/mounted-commanders-and-horse-retirement-plan-2026-10-27.md (CMD-08..19,33..36).
 * This module is worker-safe and owns no live state.
 */
export const COMMANDER_MAX_LEVEL = 3;
/** Cumulative XP thresholds for levels 1..3. */
export const COMMANDER_XP_THRESHOLDS: readonly number[] = Object.freeze([0, 30, 100]);
/** Six world tiles, adopted initial aura range (CMD-09). */
export const COMMANDER_AURA_RADIUS = 6;
/** Living resting recovery heals 1% of maximum HP per eligible game minute. */
export const COMMANDER_HEAL_SECONDS = 60;
/** Incapacitation or a failed participating expedition locks outward deployment for 30 minutes. */
export const COMMANDER_RECOVERY_SECONDS = 30 * 60;
/** New colony/adventure deployments require at least half of the current maximum HP. */
export const COMMANDER_DEPLOY_HP_FRACTION = .5;
/** Level 1 commander maximum HP is three times the fixed cavalry reference profile. */
export const COMMANDER_HP_MULTIPLIER = 3;
/** Each level compounds +40% maximum HP and +30% personal damage. */
export const COMMANDER_LEVEL_HP_FACTOR = 1.4;
export const COMMANDER_LEVEL_DAMAGE_FACTOR = 1.3;
export type CommanderLevel = 1 | 2 | 3;
export type CommanderRole = "defensive" | "offensive";
export type CommanderStyle = "melee" | "ranged";
export type CommanderLoadout = "axe" | "bow" | "sword";
export type CommanderLocation = "aboard" | "assigned" | "awaiting-evacuation" | "awaiting-home" |
  "away" | "field" | "incapacitated" | "lodge" | "muster" | "recovering" | "reserved" |
  "returning" | "travelling" | "waiting";
export type CommanderAuraKind = "bowDamage" | "meleeDamage" | "arrowReduction" | "meleeDodge";
export type CommanderBlockReason = "assigned" | "away" | "awaiting-evacuation" | "awaiting-home" |
  "incapacitated" | "missing-home" | "recovering" | "too-injured";
export type CommanderTransportPhase =
  | "aboard" | "awaiting-evacuation" | "deployed" | "muster" | "reserved" | "returning" | "waiting";

/** Where the commander is between its lodge and a destination. */
export interface CommanderTransport {
  destinationName: string;
  operationId: CommanderOperationId;
  phase: CommanderTransportPhase;
}

export interface CommanderAura {
  factor: number;
  kind: CommanderAuraKind;
  radius: number;
}

export interface CommanderDefinition {
  aura: CommanderAura;
  id: string;
  icon: string;
  loadout: CommanderLoadout;
  recruitCost: Readonly<Goods>;
  role: CommanderRole;
  style: CommanderStyle;
}

/** `icon` is the commander's nation: its portrait comes from the catalog entry (`commanderPortrait`). */
const toDefinition = ({ commander, key }: CommanderEntry): CommanderDefinition => Object.freeze({
  aura: Object.freeze({ ...commander.aura, radius: COMMANDER_AURA_RADIUS }),
  icon: key,
  id: commander.definition,
  loadout: commander.loadout,
  recruitCost: commander.recruitCost,
  role: commander.role,
  style: commander.style
});

/** Recruitment catalog (content catalog `commander:<nation>`): one definition per nation. Capacity stays one. */
export const COMMANDER_CATALOG: Readonly<Record<WorkerNation, readonly CommanderDefinition[]>> = Object.freeze(
  Object.fromEntries(commanderEntries().map(entry => [entry.key, Object.freeze([toDefinition(entry)])])) as
    Record<WorkerNation, readonly CommanderDefinition[]>
);

/** Primary definitions remain the defaults for format-1 saves predating catalog selection. */
export const COMMANDER_DEFINITIONS: Readonly<Record<WorkerNation, CommanderDefinition>> = Object.freeze(
  Object.fromEntries(Object.entries(COMMANDER_CATALOG).map(([nation, definitions]) =>
    [nation, definitions[0]!])) as Record<WorkerNation, CommanderDefinition>
);

/** Stable display name chosen from the island seed; the id remains the authoritative identity. */
export const commanderName = (nation: WorkerNation, seed: number) => {
  const names = commanderEntry(nation)!.commander.names;
  return names[Math.abs(Math.trunc(seed)) % names.length]!;
};

export const commanderRecruitCatalog = (nation: WorkerNation) => COMMANDER_CATALOG[nation];
export const commanderDefinition = (nation: WorkerNation, id?: string) =>
  commanderRecruitCatalog(nation).find(definition => definition.id === id) ?? COMMANDER_DEFINITIONS[nation];
export const commanderRecruitCost = (nation: WorkerNation, id?: string) => commanderDefinition(nation, id).recruitCost;

export const commanderLevelForXp = (xp: number): CommanderLevel => {
  if (!Number.isFinite(xp) || xp < COMMANDER_XP_THRESHOLDS[1]!) return 1;
  return xp < COMMANDER_XP_THRESHOLDS[2]! ? 2 : 3;
};

export const commanderNextThreshold = (level: CommanderLevel) =>
  level >= COMMANDER_MAX_LEVEL ? null : COMMANDER_XP_THRESHOLDS[level]!;

/** Level-1 HP is exactly 3x the fixed cavalry reference; levels 2/3 compound +40%. */
export const commanderMaximumHealth = (level: CommanderLevel) =>
  MILITARY_PROFILES.cavalry.hp * COMMANDER_HP_MULTIPLIER *
  deterministicPow(COMMANDER_LEVEL_HP_FACTOR, level - 1);

/** Personal damage growth only; the ordinary rank/talent pipeline still applies once afterwards. */
export const commanderDamageFactor = (level: CommanderLevel) =>
  deterministicPow(COMMANDER_LEVEL_DAMAGE_FACTOR, level - 1);

export const commanderHealthReady = (hp: number, maximum: number) =>
  Number.isFinite(hp) && Number.isFinite(maximum) && maximum > 0 &&
  hp > 0 && hp >= maximum * COMMANDER_DEPLOY_HP_FRACTION;

export interface CommanderState {
  /** Stable player/roster identity; never derived from a rendered actor. */
  id: string;
  name: string;
  nation: WorkerNation;
  definitionId?: string;
  xp: number;
  level: CommanderLevel;
  homeLodgeUid: number;
  /** Seed of the island that recruited this commander; the roster identity is player-wide. */
  homeIslandSeed?: number;
  location: CommanderLocation;
  /** Remaining eligible recovery seconds; zero when no failure cycle is pending. */
  recoverySeconds: number;
  /** Seconds toward the next 1%-of-maximum healing step; always below one game minute. */
  healingSeconds: number;
  /** Last applied victory identity, bounded to one value for idempotent XP. */
  lastXpResult?: string;
  /** Deduplicates one expedition failure/incapacitation cycle. */
  failureId?: string;
  /** Real HP while no live soldier exists at home (reserved/aboard/away/returning). */
  awayHp?: number;
  /** Current outward/return operation id, bounded to the one deployment allowance. */
  operationId?: CommanderOperationId;
  /** Player-facing destination of the current operation. */
  destinationName?: string;
  /** Explicit outward/return transport phase; absent while resting at home. */
  transport?: CommanderTransport;
}

export interface CommanderSave extends CommanderState {}

export interface CommanderSnapshot extends CommanderState {
  aura: CommanderAura;
  definition: CommanderDefinition;
  maximumHp: number;
  hp: number;
  hpFraction: number;
  nextThreshold: number | null;
  healthReady: boolean;
  recoveryComplete: boolean;
  ready: boolean;
  blockReason: CommanderBlockReason | null;
  /** A clearer transport/availability detail for the disabled planner card and lodge heading. */
  blockDetail: string | null;
  developmentAllowed: boolean;
  /** Ship deck places the commander (rider plus mount) consumes. */
  deckSlots: number;
  /** The commander is physically deployed and can request a real return/evacuation. */
  canReturn: boolean;
}

export interface CommanderRecruitAvailability {
  available: boolean;
  reason: string | null;
  missing: Record<string, number>;
  idleSettlers: number;
  hasCommander: boolean;
  cost: Readonly<Goods>;
  canRecruitMore?: boolean;
  choices?: readonly (Omit<CommanderRecruitAvailability, "choices"> & { definitionId: string })[];
}

const COMMANDER_LOCATIONS: readonly CommanderLocation[] = ["aboard", "assigned", "awaiting-evacuation",
  "awaiting-home", "away", "field", "incapacitated", "lodge", "muster", "recovering", "reserved",
  "returning", "travelling", "waiting"];
const TRANSPORT_PHASES: readonly CommanderTransportPhase[] = ["aboard", "awaiting-evacuation", "deployed",
  "muster", "reserved", "returning", "waiting"];
const optionalCount = (value: unknown, maximum: number) =>
  value === undefined || (Number.isFinite(value) && (value as number) >= 0 && (value as number) <= maximum);

const validCommanderIdentity = (state: CommanderState) => {
  return typeof state.id === "string" && state.id.length > 0 && state.id.length <= 120 &&
    typeof state.name === "string" && state.name.length > 0 && state.name.length <= 120 &&
    isNation(state.nation) &&
    (state.definitionId === undefined || commanderRecruitCatalog(state.nation).some(definition => definition.id === state.definitionId));
};

const validCommanderTransport = (state: CommanderState) => (state.transport === undefined || (Boolean(state.transport) &&
      TRANSPORT_PHASES.includes(state.transport.phase) &&
      isCommanderOperationId(state.transport.operationId) &&
      typeof state.transport.destinationName === "string" && state.transport.destinationName.length <= 80));

export const isCommanderState = (value: unknown): value is CommanderState => {
  if (!value || typeof value !== "object") return false;
  const state = value as CommanderState;
  return validCommanderIdentity(state) &&
    Number.isSafeInteger(state.xp) && state.xp >= 0 && state.xp <= COMMANDER_XP_THRESHOLDS[2]! &&
    Number.isSafeInteger(state.level) && state.level >= 1 && state.level <= COMMANDER_MAX_LEVEL &&
    state.level === commanderLevelForXp(state.xp) &&
    Number.isSafeInteger(state.homeLodgeUid) && state.homeLodgeUid >= -1 &&
    (state.homeIslandSeed === undefined || (Number.isSafeInteger(state.homeIslandSeed) && state.homeIslandSeed >= 0)) &&
    COMMANDER_LOCATIONS.includes(state.location) &&
    Number.isFinite(state.recoverySeconds) && state.recoverySeconds >= 0 &&
    state.recoverySeconds <= COMMANDER_RECOVERY_SECONDS &&
    Number.isFinite(state.healingSeconds) && state.healingSeconds >= 0 &&
    state.healingSeconds < COMMANDER_HEAL_SECONDS &&
    optionalCount(state.awayHp, commanderMaximumHealth(COMMANDER_MAX_LEVEL)) &&
    (state.operationId === undefined || isCommanderOperationId(state.operationId)) &&
    (state.destinationName === undefined ||
      (typeof state.destinationName === "string" && state.destinationName.length <= 80)) &&
    validCommanderTransport(state) &&
    (state.lastXpResult === undefined || (typeof state.lastXpResult === "string" && state.lastXpResult.length <= 160)) &&
    (state.failureId === undefined || (typeof state.failureId === "string" && state.failureId.length <= 160));
};

/** One bounded recovery/XP receipt per save; no unbounded event history. */
export const copyCommanderState = (state: CommanderState): CommanderSave => ({
  ...state,
  ...(state.transport ? { transport: { ...state.transport } } : {})
});

export const commanderBlockReason = (
  state: CommanderState, hp: number, maximum: number
): CommanderBlockReason | null => {
  if (state.location === "incapacitated") return "incapacitated";
  if (state.location === "awaiting-evacuation") return "awaiting-evacuation";
  if (state.location === "awaiting-home") return "awaiting-home";
  if (state.location === "away" || state.location === "aboard" || state.location === "returning")
    return "away";
  if (state.location === "reserved" || state.location === "assigned" || state.location === "muster" ||
    state.location === "waiting") return "assigned";
  if (state.location === "travelling" || state.location === "field") return "away";
  if (state.recoverySeconds > 0) return "recovering";
  if (!commanderHealthReady(hp, maximum)) return "too-injured";
  return null;
};

export const canDeployCommander = (state: CommanderState, hp: number, maximum: number) =>
  commanderBlockReason(state, hp, maximum) === null;
