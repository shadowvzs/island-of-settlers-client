import { CAMPAIGN_DEFAULT_EXIT } from "../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import { isCampaignExitId } from "../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import { TICK_HZ } from "../../../../island-of-settlers-shared/src/time/constants";
import { findAuthoredObjectHandle } from "../settlement/authored-object-uids";
import { isGameTick } from "../settlement/game-clock";
import type { MilitaryDoor } from "../settlement/military-combat-rules";
import { isSaveInteger, isSaveObject } from "../settlement/save-validation";
import { getBuilding } from "../settlement/settlement-building-index";
import { islandPeople } from "../settlement/settlement-population";
import type { SettlementSoldier } from "../settlement/settlement-military";
import type { SettlementActor, SettlementBuilding, SettlementContext } from "../settlement/settlement-types";
import {
  campaignHoldsArea, campaignRuleMet, type CampaignVictoryCheck, type CampaignVictoryWorld, isCampaignVictoryCheck
} from "./campaign-victory";

/**
 * The outcome of a campaign map on its own island (C9a): the landing harbour is the key building (its loss is a
 * defeat, R18), the map script's `endMap` decides victory or defeat, and the first outcome is final. Defeat comes
 * first within a tick (R19): the harbour check runs in the fixed tick, before the script's end-of-tick step. Only
 * campaign maps carry this state, so every other save and replay stays unchanged.
 * A script victory may name one of the map's exits (BR2, campaign branching §7): the simulation only records the
 * id; which map it opens is decided outside it, from the campaign graph.
 */

export const CAMPAIGN_MAP_OUTCOMES = ["victory", "defeat"] as const;
export type CampaignMapOutcome = (typeof CAMPAIGN_MAP_OUTCOMES)[number];
/** `rule`: the map's built-in victory rule (C9b). */
export const CAMPAIGN_OUTCOME_REASONS = ["script", "harbourLost", "rule"] as const;
export type CampaignOutcomeReason = (typeof CAMPAIGN_OUTCOME_REASONS)[number];

export interface CampaignOutcomeRecord {
  /** The named exit a script victory chose; absent: the implicit `victory` exit (built-in rules, plain `endMap`). */
  exit?: string;
  kind: CampaignMapOutcome;
  reason: CampaignOutcomeReason;
  /** Game tick the outcome was decided on. */
  tick: number;
}

/** Saved with the campaign map's settlement. */
export interface CampaignMapProgress {
  /** Uid of the landing harbour (the key building). */
  harbour: number;
  outcome?: CampaignOutcomeRecord;
  /** The built-in victory rule (C9b); absent: only the script decides victory. */
  victory?: CampaignVictoryCheck;
  /** `hold` rules: whole seconds the area has been held without a break. */
  heldSeconds?: number;
}

/** The landing harbour of a fresh campaign start: the campaign map's home building at its harbour plot. */
export const startCampaignMapProgress = (
  context: SettlementContext, home: SettlementBuilding | undefined
): CampaignMapProgress | undefined => {
  if (context.options.world.scenario?.kind !== "campaign" || !home?.colonyHome) return undefined;
  const victory = context.options.campaignVictory;
  return victory ? { harbour: home.uid, victory: structuredClone(victory) } : { harbour: home.uid };
};

/** The exit an outcome record keeps: only a victory has one, and the implicit exit is stored as absent. */
const recordedExit = (kind: CampaignMapOutcome, exit: string | undefined) =>
  kind === "victory" && exit !== undefined && exit !== CAMPAIGN_DEFAULT_EXIT ? { exit } : {};

/**
 * Records the map's outcome once; a later outcome (or a second `endMap`, also with another exit) is refused, and
 * so is a malformed exit or an exit on a defeat. The map has ended, so every waiting script run and queued firing
 * is dropped (trigger design §11); a running `endMap` step stops there.
 */
export const endCampaignMap = (
  context: SettlementContext, kind: CampaignMapOutcome, reason: CampaignOutcomeReason, exit?: string
) => {
  const progress = context.campaignMap;
  if (!progress || progress.outcome) return false;
  if (exit !== undefined && (kind !== "victory" || !isCampaignExitId(exit))) return false;
  progress.outcome = { kind, reason, tick: context.clock?.tick() ?? 0, ...recordedExit(kind, exit) };
  context.script?.engine.dropAllRuns();
  context.options.onCampaignOutcome?.(progress.outcome);
  return true;
};

/** What the outcome checks read from the island's combat: its soldiers and the walls of its buildings. */
export interface CampaignOutcomeCombat {
  combat: { doors: () => readonly MilitaryDoor[] };
  soldiers: () => readonly SettlementSoldier[];
}

/** Present and not fallen: a building counts as destroyed at its fall (structure HP 0, R17), not at ruin removal. */
const standingIn = (context: SettlementContext, doors: readonly MilitaryDoor[]) => (uid: number) => {
  if (!getBuilding(context, uid)) return false;
  const structure = doors.find(door => door.building === uid)?.structure;
  return !structure || structure.hp > 0;
};

const victoryWorld = (
  context: SettlementContext, military: CampaignOutcomeCombat, tick: number
): CampaignVictoryWorld => {
  const actors = new Map<number, SettlementActor>();
  for (const actor of context.actors) actors.set(actor.uid, actor);
  const soldiers = military.soldiers().filter(soldier => (soldier.combat?.hp ?? 1) > 0)
    .map(soldier => ({ actor: soldier.actor, faction: soldier.combat?.faction ?? 0 }));
  const target = (buildingId: number) => {
    const handle = findAuthoredObjectHandle(context, buildingId);
    return handle?.space === "building" ? handle.uid : undefined;
  };
  return { actor: uid => actors.get(uid), seconds: Math.floor(tick / TICK_HZ),
    soldiers, standing: standingIn(context, military.combat.doors()), targetUid: target };
};

/**
 * Once per game second from the first full second on: the built-in rule; a hold counts whole held seconds and
 * restarts after a break.
 */
const updateVictoryRule = (
  context: SettlementContext, progress: CampaignMapProgress, military: CampaignOutcomeCombat, tick: number
) => {
  const check = progress.victory;
  if (!check || check.kind === "scripted" || tick === 0 || tick % TICK_HZ !== 0) return;
  const world = victoryWorld(context, military, tick);
  if (check.kind !== "hold") {
    if (campaignRuleMet(check, context, world)) endCampaignMap(context, "victory", "rule");
    return;
  }
  const held = campaignHoldsArea(check, world, getBuilding(context, progress.harbour));
  progress.heldSeconds = held ? (progress.heldSeconds ?? 0) + 1 : 0;
  if (progress.heldSeconds >= check.seconds) endCampaignMap(context, "victory", "rule");
};

/**
 * Once per fixed tick, after combat: a landing harbour that left the world or fell (structure HP 0) loses the map;
 * defeat is checked before the built-in victory rule, so a same-tick victory never wins (R19). The general
 * building HP of BD1/BD3 does not exist yet: today only buildings with walls can fall.
 */
export const updateCampaignMapOutcome = (context: SettlementContext, military: CampaignOutcomeCombat) => {
  const progress = context.campaignMap;
  if (!progress || progress.outcome) return;
  if (!standingIn(context, military.combat.doors())(progress.harbour)) {
    endCampaignMap(context, "defeat", "harbourLost");
    return;
  }
  updateVictoryRule(context, progress, military, context.clock?.tick() ?? 0);
};

/** The island's people without the player's living soldiers: idle settlers and civilians on duty. */
export const campaignSettlerCount = (context: SettlementContext, soldiers: Iterable<SettlementSoldier>) => {
  let ownSoldiers = 0;
  for (const soldier of soldiers) if ((soldier.combat?.faction ?? 0) === 0) ownSoldiers++;
  return Math.max(0, islandPeople(context) - ownSoldiers);
};

/** A saved exit: absent, or a named exit of a script victory (the implicit exit is never stored). */
const isRecordedExit = (value: Record<string, unknown>) => value.exit === undefined ||
  (value.kind === "victory" && value.reason === "script" && isCampaignExitId(value.exit) &&
    value.exit !== CAMPAIGN_DEFAULT_EXIT);

const isOutcomeRecord = (value: unknown): value is CampaignOutcomeRecord =>
  isSaveObject(value) && CAMPAIGN_MAP_OUTCOMES.includes(value.kind as CampaignMapOutcome) &&
  CAMPAIGN_OUTCOME_REASONS.includes(value.reason as CampaignOutcomeReason) && isGameTick(value.tick) &&
  isRecordedExit(value);

/** Why a saved campaign map progress is invalid; null when it is valid or absent. */
export const campaignMapProgressError = (value: unknown) => {
  if (value === undefined) return null;
  if (!isSaveObject(value) || !isSaveInteger(value.harbour))
    return "Invalid campaign map progress";
  if (value.outcome !== undefined && !isOutcomeRecord(value.outcome)) return "Invalid campaign map progress";
  if (value.victory !== undefined && !isCampaignVictoryCheck(value.victory)) return "Invalid campaign map progress";
  if (value.heldSeconds !== undefined && !isSaveInteger(value.heldSeconds)) return "Invalid campaign map progress";
  return null;
};
