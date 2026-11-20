import { COMMAND_LOG_LIMITS } from "../../../../island-of-settlers-shared/src/commands/command-limits";
import { FORMATS, isFormat } from "../../../../island-of-settlers-shared/src/formats";
import { ARCHIVED_ISLAND_KEY_PATTERN } from "../../../../island-of-settlers-shared/src/island-key";
import { isFiniteNumber, isPlainObject, isTick } from "../../../../island-of-settlers-shared/src/validation/guards";
import { type ColonyNativeEconomy, validColonyNativeEconomy } from "./colony-native-economy";
import type { CommandLogInterval } from "./command-log";
import type { GameSaveV1 } from "./game-save";
import type { IslandKey } from "./game-save-rows";

export interface ArchivedIslandProof {
  version: 1;
  island: IslandKey;
  intervals: CommandLogInterval[];
  /** Actual native island clock coverage; a zero-tick payment interval may have equal endpoints. */
  coverage: { from: number; to: number };
  /** Frozen client context; account verification must match a server-owned verified revision. */
  contexts?: { baseTick: number; endTick: number; player: PlayerProgress; questClock: number; revision?: number;
    colonyCursor?: ArchivedColonyCursor }[];
}
export interface ArchivedColonyCursor {
  expeditionId: number;
  conqueredAt?: number;
  beforeNextOreShipAt?: number;
  afterNextOreShipAt?: number;
  beforeNativeEconomy?: ColonyNativeEconomy;
  afterNativeEconomy?: ColonyNativeEconomy;
}
export const ARCHIVED_RELIEF_PROOF_KEY = "archivedReliefProof";
/** A proof is one upload's chain of intervals: the server checks it with the command-log upload bounds. */
export const MAX_ARCHIVED_PROOF_INTERVALS = COMMAND_LOG_LIMITS.intervalsPerUpload;
export const MAX_ARCHIVED_PROOF_BYTES = COMMAND_LOG_LIMITS.logBytes;

const object = isPlainObject;
const clock = (value: unknown): value is number => isFiniteNumber(value) && value >= 0;
const tick = isTick;
/** Relief intervals are recorded before direct inputs exist: only version 1 command logs belong in a proof. */
const RELIEF_INTERVAL_VERSION = 1;
const rawProof = (save: GameSaveV1) => object(save.runtime) ? save.runtime[ARCHIVED_RELIEF_PROOF_KEY] : undefined;
const validCursor = (cursor: unknown) => cursor === undefined || object(cursor) && tick(cursor.expeditionId) &&
  validColonyNativeEconomy(cursor.beforeNativeEconomy) && validColonyNativeEconomy(cursor.afterNativeEconomy) &&
  ["conqueredAt", "beforeNextOreShipAt", "afterNextOreShipAt"].every(key => cursor[key] === undefined || clock(cursor[key]));

/** Invalid metadata never permits dropping a paid job's existing history. */
export const archivedIslandProofProblem = (save: GameSaveV1): string | undefined => {
  const proof = rawProof(save);
  if (proof === undefined) return undefined;
  const invalid = "The archived relief journal is invalid; paid custody is retained until its proof is repaired";
  if (!isFormat(proof, FORMATS.archivedReliefProof) || typeof proof.island !== "string" ||
    !ARCHIVED_ISLAND_KEY_PATTERN.test(proof.island) || !object(proof.coverage) ||
    !clock(proof.coverage.from) || !clock(proof.coverage.to) || proof.coverage.to < proof.coverage.from ||
    !Array.isArray(proof.intervals) || !proof.intervals.length || proof.intervals.length > MAX_ARCHIVED_PROOF_INTERVALS)
    return invalid;
  const intervals = proof.intervals;
  if (intervals.some(interval => !isFormat(interval, FORMATS.commandLog) ||
    interval.version !== RELIEF_INTERVAL_VERSION || !tick(interval.baseTick) || !tick(interval.endTick) ||
    interval.endTick < interval.baseTick || typeof interval.sourceVersion !== "string" ||
    typeof interval.baseChecksum !== "string" || typeof interval.endChecksum !== "string" ||
    !Array.isArray(interval.entries) || !Array.isArray(interval.checksums) || !Array.isArray(interval.randomStates))) return invalid;
  if (proof.contexts !== undefined && (!Array.isArray(proof.contexts) || proof.contexts.length !== intervals.length ||
    proof.contexts.some((context, index) => !object(context) || !tick(context.baseTick) || !tick(context.endTick) ||
      context.baseTick !== intervals[index].baseTick || context.endTick !== intervals[index].endTick ||
      !clock(context.questClock) || !object(context.player) || !Array.isArray(context.player.quests) ||
      (context.revision !== undefined && (!tick(context.revision) || context.revision < 1)) || !validCursor(context.colonyCursor)))) return invalid;
  try { if (JSON.stringify(proof).length > MAX_ARCHIVED_PROOF_BYTES) return invalid; }
  catch { return invalid; }
  return undefined;
};

/** Client custody only: the server independently verifies every interval from its own trusted anchor. */
export const archivedIslandProof = (save: GameSaveV1): ArchivedIslandProof | undefined => {
  return archivedIslandProofProblem(save) ? undefined : rawProof(save) as ArchivedIslandProof | undefined;
};
export const withArchivedIslandProof = (save: GameSaveV1, proof: ArchivedIslandProof): GameSaveV1 => ({ ...save,
  runtime: { ...(save.runtime && typeof save.runtime === "object" ? save.runtime : {}), [ARCHIVED_RELIEF_PROOF_KEY]: proof }
});
export const appendArchivedIslandProof = (baseline: GameSaveV1, end: GameSaveV1,
  island: IslandKey, interval: CommandLogInterval, questClock = baseline.savedAt,
  colonyCursor?: ArchivedColonyCursor): ArchivedIslandProof => {
  const problem = archivedIslandProofProblem(baseline);
  if (problem) throw new Error(problem);
  const previous = archivedIslandProof(baseline);
  if (previous && (previous.island !== island || previous.coverage.to !== baseline.savedAt))
    throw new Error("The archived relief proof has a chronology gap");
  const proof: ArchivedIslandProof = { version: 1, island, intervals: [...previous?.intervals ?? [], interval],
    coverage: { from: previous?.coverage.from ?? baseline.savedAt, to: end.savedAt },
    contexts: [...previous?.contexts ?? [], ...(baseline.player ? [{ baseTick: interval.baseTick,
      endTick: interval.endTick, player: structuredClone(baseline.player), questClock, colonyCursor }] : [])] };
  if (proof.intervals.length > MAX_ARCHIVED_PROOF_INTERVALS || JSON.stringify(proof).length > MAX_ARCHIVED_PROOF_BYTES)
    throw new Error("The archived relief proof must be verified before more work continues");
  return proof;
};
import type { PlayerProgress } from "../progression/player-progress";
