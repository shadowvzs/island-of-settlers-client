import {
  CAMPAIGN_DEFAULT_EXIT, CAMPAIGN_SOLDIER_TYPES
} from "../../../../island-of-settlers-shared/src/campaign/campaign-constants";
import { isCampaignExitId } from "../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type {
  CampaignMapRewards, CampaignSoldierAmount
} from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { FORMATS, isCurrentFormat } from "../../../../island-of-settlers-shared/src/formats";
import {
  isNonEmptyString, isPlainObject, isPositiveCount
} from "../../../../island-of-settlers-shared/src/validation/index";
import {
  appliedGrantsError, type CampaignGrantHolder, type CampaignGrantLedger, isGoodsRecord, pendingGrantsError
} from "./campaign-grants";
import type { CampaignVictoryShipment } from "./campaign-victory-reward";

/**
 * The campaign run's own save document (C2): a campaign map is never a filed island. The home archipelago keeps
 * only a `CampaignMarker`; the run's settlement and its campaign state live in the `campaignRuns` table under the
 * run key, and its command log uses that key too.
 */
export const CAMPAIGN_RUN_FORMAT = FORMATS.campaignRun.id;
export const CAMPAIGN_RUN_VERSION = FORMATS.campaignRun.current;
export const CAMPAIGN_RUN_STATUSES = ["running", "won", "given-up", "lost"] as const;
export type CampaignRunStatus = (typeof CAMPAIGN_RUN_STATUSES)[number];
/** The account's status of the map when the attempt started (trigger design §9.5); fixed for the attempt. */
export const CAMPAIGN_ATTEMPT_MAP_STATUSES = ["available", "completed"] as const;
export type CampaignAttemptMapStatus = (typeof CAMPAIGN_ATTEMPT_MAP_STATUSES)[number];

/** Command-log and storage key of one attempt on one campaign map. */
export type CampaignRunKey = `campaign-${string}-${number}`;

/**
 * Home-side record of a campaign run that exists (on screen or not). Later lanes add the shipped loads, the
 * soldiers and commander away and the pending home debits (C8, C10b).
 */
export interface CampaignMarker extends CampaignGrantLedger {
  attempt: number;
  campaignId: string;
  mapId: string;
  /** Game time (UTC ms) of the home island when the run was created. */
  runCreatedAt?: number;
}

/** Campaign state of the run on screen, saved with its settlement; the run's settlement is the save itself. */
export interface CampaignRunState extends CampaignGrantHolder {
  format: typeof CAMPAIGN_RUN_FORMAT;
  version: typeof CAMPAIGN_RUN_VERSION;
  attempt: number;
  campaignId: string;
  mapId: string;
  status: CampaignRunStatus;
  /**
   * The named exit the won map's script chose (BR2), from the simulation's outcome record; absent: the implicit
   * `victory` exit. The end report sends it, and the server decides the next map from it.
   */
  exit?: string;
  /** Story and quest triggers fired in this attempt (each fires once per attempt). */
  firedEvents: string[];
  /** Story beats the player has already seen. */
  seenBeats: string[];
  rewardClaimed: boolean;
  commanderReturned?: boolean;
  /** The server-issued attempt id (C9a); absent for guests and offline starts. */
  attemptId?: string;
  /** The map's account status at the attempt's start; absent = `available` (full home rewards). */
  mapStatus?: CampaignAttemptMapStatus;
  /** Soldiers the departure shipped (C8): only these may sail home again, never map-placed or Monument units. */
  shippedSoldiers?: CampaignSoldierAmount[];
  /** Settlers the departure shipped (C8): at most this many sail home again (owner Q3 follow-up). */
  shippedSettlers?: number;
  /** The map's victory reward table at departure (C12, plan item 348): a guest's claim pays from it. */
  rewards?: CampaignMapRewards;
  /** The paid victory reward's reward-ship load, kept once claimed (`rewardClaimed`) so a retry never pays twice. */
  victoryShipment?: CampaignVictoryShipment;
}

/** What a new attempt knows at its start besides its identity (C8 departure, C9a). */
export type CampaignRunStart =
  Pick<CampaignRunState, "attemptId" | "mapStatus" | "rewards" | "shippedSettlers" | "shippedSoldiers">;

export const campaignRunKey = ({ attempt, mapId }: Pick<CampaignMarker, "attempt" | "mapId">): CampaignRunKey =>
  `campaign-${mapId}-${attempt}`;

/** The map status the run's claims and quests read: fixed at the attempt's start (§9.5). */
export const campaignRunMapStatus = (run: Pick<CampaignRunState, "mapStatus">): CampaignAttemptMapStatus =>
  run.mapStatus ?? "available";

/** The marker of a run: the same identity fields. */
export const campaignRunMarker = ({ attempt, campaignId, mapId }: CampaignRunState): CampaignMarker =>
  ({ attempt, campaignId, mapId });

/** A fresh attempt's campaign state (C8 creates it at departure). */
export const createCampaignRunState = (
  { attempt, campaignId, mapId }: Pick<CampaignMarker, "attempt" | "campaignId" | "mapId">,
  start: CampaignRunStart = {}
): CampaignRunState => ({ attempt, campaignId, firedEvents: [], format: CAMPAIGN_RUN_FORMAT, mapId,
  rewardClaimed: false, seenBeats: [], status: "running", version: CAMPAIGN_RUN_VERSION,
  ...(start.attemptId === undefined ? {} : { attemptId: start.attemptId }),
  ...(start.mapStatus === undefined ? {} : { mapStatus: start.mapStatus }),
  ...(start.shippedSoldiers === undefined ? {} : { shippedSoldiers: structuredClone(start.shippedSoldiers) }),
  ...(start.shippedSettlers === undefined ? {} : { shippedSettlers: start.shippedSettlers }),
  ...(start.rewards === undefined ? {} : { rewards: structuredClone(start.rewards) }) });

const isStringList = (value: unknown) => Array.isArray(value) && value.every(entry => typeof entry === "string");
const STATUSES = new Set<unknown>(CAMPAIGN_RUN_STATUSES);
const MAP_STATUSES = new Set<unknown>(CAMPAIGN_ATTEMPT_MAP_STATUSES);
const SOLDIER_TYPES = new Set<unknown>(CAMPAIGN_SOLDIER_TYPES);

const isSoldierList = (value: unknown) => Array.isArray(value) && value.every(line =>
  isPlainObject(line) && isPositiveCount(line.amount) && SOLDIER_TYPES.has(line.type));

const isTroop = (value: unknown) => isPlainObject(value) && Number.isFinite(value.hp) &&
  Number.isSafeInteger(value.rank) && typeof value.type === "string";
const isShipment = (value: unknown) => isPlainObject(value) && isGoodsRecord(value.goods) &&
  Number.isSafeInteger(value.settlers) && (value.settlers as number) >= 0 &&
  Array.isArray(value.soldiers) && value.soldiers.every(isTroop);

/** The attempt fields of a stored run (C9a); null when they are valid or absent. */
const attemptFieldsError = (value: Record<string, unknown>) => {
  if (value.attemptId !== undefined && !isNonEmptyString(value.attemptId)) return "Invalid campaign run";
  if (value.mapStatus !== undefined && !MAP_STATUSES.has(value.mapStatus)) return "Invalid campaign run";
  if (value.shippedSoldiers !== undefined && !isSoldierList(value.shippedSoldiers)) return "Invalid campaign run";
  if (value.shippedSettlers !== undefined && !isPositiveCount(value.shippedSettlers)) return "Invalid campaign run";
  if (value.rewards !== undefined && !isPlainObject(value.rewards)) return "Invalid campaign run";
  return value.victoryShipment === undefined || isShipment(value.victoryShipment) ? null : "Invalid campaign run";
};

/** A stored exit: absent, or the named exit of a won run (the implicit exit is never stored). */
const isRunExit = (value: Record<string, unknown>) => value.exit === undefined ||
  (value.status === "won" && isCampaignExitId(value.exit) && value.exit !== CAMPAIGN_DEFAULT_EXIT);

/** Why a stored marker is invalid; null when it is valid or absent. */
export const campaignMarkerError = (value: unknown) => {
  if (value === undefined) return null;
  if (!isPlainObject(value) || !isNonEmptyString(value.campaignId) || !isNonEmptyString(value.mapId) ||
    !isPositiveCount(value.attempt))
    return "Invalid campaign marker";
  if (value.runCreatedAt !== undefined && !Number.isFinite(value.runCreatedAt)) return "Invalid campaign marker";
  return appliedGrantsError(value.appliedGrants);
};

/** Why a run's stored campaign state is invalid; null when it is valid. */
export const campaignRunStateError = (value: unknown) => {
  if (!isCurrentFormat(value, FORMATS.campaignRun)) return "Unsupported campaign run";
  if (!isNonEmptyString(value.campaignId) || !isNonEmptyString(value.mapId) || !isPositiveCount(value.attempt) ||
    !STATUSES.has(value.status))
    return "Invalid campaign run";
  if (!isStringList(value.firedEvents) || !isStringList(value.seenBeats) || typeof value.rewardClaimed !== "boolean")
    return "Invalid campaign run";
  if (value.commanderReturned !== undefined && typeof value.commanderReturned !== "boolean")
    return "Invalid campaign run";
  if (!isRunExit(value)) return "Invalid campaign run";
  return attemptFieldsError(value) ?? pendingGrantsError(value.pendingGrants);
};

/** The run on screen belongs to the archipelago's marker (same campaign, map and attempt). */
export const runMatchesMarker = (run: CampaignRunState, marker: CampaignMarker | undefined) =>
  Boolean(marker) && marker!.campaignId === run.campaignId && campaignRunKey(marker!) === campaignRunKey(run);
