import { mapScriptHash } from "../../../../island-of-settlers-shared/src/script/hash";
import type { MapScriptSnapshot } from "../../../../island-of-settlers-shared/src/script/snapshot";
import type { CampaignMapOutcome } from "../../shared/campaign/campaign-map-outcome";
import { reliefPaymentProblem } from "../../shared/progression/relief-payment-validation";
import type { ArchivedIslandProof } from "../../shared/settlement/archived-relief-journal";
import type { CommandLogInterval } from "../../shared/settlement/command-log";
import { type CommandLogMismatch, replayCommandLog } from "../../shared/settlement/command-log-replay";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { activeSaveKey } from "../../shared/settlement/game-save-rows";
import { hashSettlementState } from "../../shared/settlement/settlement-state-hash";
import type { RandomDraw } from "../../shared/settlement/simulation-random";
import type { WorldData } from "../../shared/world/world-data";
import type { SaveSnapshot } from "../save-store/save-api-client";
import { fromSaveSnapshot } from "../save-store/save-snapshot";
import { replayArchivedRelief } from "./archived-relief-replay";
import { stageGameSession } from "./game-session";
import { createHeadlessIsland } from "./headless-replay";
import {
  adoptRevisionProblem, serverCommandArgs, type ServerRulesByRevision, withServerBaseRules
} from "./verifier-rules";

/**
 * What a verified campaign run replay attests (campaign server part 2, C12 follow-up): the attempt the run's
 * baseline names, its map, and the map outcome the replay reached. `decided` is true only when the outcome was
 * decided inside the replayed ticks (the baseline had none), so an uploaded baseline cannot carry a ready victory.
 */
export interface CampaignRunEvidence {
  attempt: number;
  attemptId?: string;
  campaignId: string;
  decided: boolean;
  mapId: string;
  outcome?: CampaignMapOutcome;
}

/** What the server's replay of one upload's command logs found (D4.3). */
export interface CommandLogVerification {
  /** A verified chain of a campaign run (absent on islands). */
  campaignRun?: CampaignRunEvidence;
  /** Index of the interval that diverged. */
  interval?: number;
  island?: string;
  mismatch?: CommandLogMismatch;
  reason?: string;
  status: "mismatch" | "skipped" | "verified";
  /**
   * Script hashes the verified island runs (its start snapshot and its map header script), absent without a
   * script: the API refuses a verification whose script is not a server-published revision (trigger design §9.2).
   */
  scriptHashes?: string[];
  /** Ticks replayed. */
  ticks: number;
  /** The server's draw trail at the end of the diverged interval (diffed with the client's ring buffer). */
  trail?: RandomDraw[];
  trailTick?: number;
}

export interface CommandLogVerificationInput {
  /** Optional independent filed-island chain, anchored by the API rather than the client. */
  archivedProof?: ArchivedIslandProof;
  /** The stored upload is an administrator's development build (migration 0020); replay its debug commands. */
  allowDebug?: boolean;
  /** The stored snapshot of the first interval's base revision. */
  base: SaveSnapshot;
  /** The uploaded snapshot the intervals end at. */
  end: SaveSnapshot;
  intervals: CommandLogInterval[];
  /**
   * The server's copies of every game-rules revision the chain names (GS2), keyed by revision. Absent (tools,
   * older APIs): the snapshot's and the commands' own copies replay unchanged.
   */
  rules?: ServerRulesByRevision;
}

const skipped = (reason: string): CommandLogVerification => ({ reason, status: "skipped", ticks: 0 });

/** Why a chain cannot be replayed exactly; null when it can. */
const chainProblem = (intervals: readonly CommandLogInterval[], base: GameSaveV1 | null) => {
  const first = intervals[0];
  if (!first || first.baseRevision === null) return "The chain has no verified base snapshot";
  const gaps = intervals.flatMap(interval => interval.gaps ?? []);
  if (gaps.length) return gaps[0]!;
  if (intervals.some(interval => interval.island !== first.island)) return "The chain changes island";
  if (!base || activeSaveKey(base) !== first.island) return "The base snapshot shows another island";
  return null;
};

/** The settlement and world fingerprint of the uploaded end snapshot. */
const endStateHash = async (end: SaveSnapshot, island: string) => {
  const game = fromSaveSnapshot(end);
  if (!game || activeSaveKey(game) !== island) return null;
  const loaded = await stageGameSession(game);
  return hashSettlementState({ settlement: loaded.settlement, world: loaded.map.world });
};

/** The scripts an island runs (snapshot and map header), sorted and unique; nothing for an unscripted island. */
const islandScripts = (snapshot: MapScriptSnapshot | undefined, world: WorldData) => {
  const hashes = new Set<string>();
  if (snapshot) hashes.add(snapshot.scriptHash);
  if (world.script) hashes.add(mapScriptHash(world.script));
  return hashes.size ? { scriptHashes: [...hashes].sort() } : {};
};

/** The run evidence of a verified chain whose baseline shows a campaign run; nothing on an island. */
const campaignEvidence = (base: GameSaveV1, outcome: CampaignMapOutcome | undefined) => {
  const run = base.campaignRun;
  if (!run) return {};
  const decided = Boolean(outcome) && !base.settlement.campaignMap?.outcome;
  const evidence: CampaignRunEvidence = { attempt: run.attempt, campaignId: run.campaignId, decided,
    mapId: run.mapId, ...(run.attemptId ? { attemptId: run.attemptId } : {}), ...(outcome ? { outcome } : {}) };
  return { campaignRun: evidence };
};

/** The replayed island's command check: relief payments, and (server rules) the adopted revisions. */
const commandProblem = (
  island: Awaited<ReturnType<typeof createHeadlessIsland>>, rules: ServerRulesByRevision | undefined
) => (entry: CommandLogInterval["entries"][number]) => {
  if (entry.command.name === "requestReliefCollection")
    return reliefPaymentProblem(island.runtimeState().player, entry.command.args[0],
      island.simulation.reliefCollections());
  return rules ? adoptRevisionProblem(entry, rules) : undefined;
};

/** The base game under the server's rules copy; the stored game unchanged without server rules. */
const serverBase = (base: GameSaveV1, rules: ServerRulesByRevision | undefined) =>
  rules ? withServerBaseRules(base, rules) : base;

/**
 * Replays an upload's command log chain from its base snapshot in Node and compares every counter checksum, then
 * the replayed island with the uploaded snapshot (a forged command or an edited stock both show).
 */
export const verifyCommandLogs = async (
  { allowDebug = false, archivedProof, base, end, intervals, rules }: CommandLogVerificationInput
): Promise<CommandLogVerification> => {
  if (archivedProof) return replayArchivedRelief(base, end, archivedProof, allowDebug);
  const storedBase = fromSaveSnapshot(base);
  const problem = chainProblem(intervals, storedBase);
  if (problem) return skipped(problem);
  const baseGame = serverBase(storedBase!, rules);
  if (typeof baseGame === "string")
    return { island: intervals[0]!.island, mismatch: { kind: "base", reason: baseGame, tick: intervals[0]!.baseTick },
      reason: baseGame, status: "mismatch", ticks: 0 };
  const island = await createHeadlessIsland(baseGame, false, allowDebug);
  const { simulation } = island;
  const startTick = simulation.gameTick();
  for (const [index, interval] of intervals.entries()) {
    // The client reloaded each uploaded snapshot in place before the next interval.
    if (index > 0 && !simulation.reloadSnapshot(simulation.saveState(), true).ok)
      return skipped("The island could not reload its own snapshot");
    const result = replayCommandLog(simulation, interval, { rejectDebug: !allowDebug, untilEnd: true,
      ...(rules ? { argsOf: entry => serverCommandArgs(entry, rules) } : {}),
      validateCommand: commandProblem(island, rules) });
    if (!result.ok) return { interval: index, island: interval.island, mismatch: result.mismatch, status: "mismatch",
      ticks: simulation.gameTick() - startTick, trail: simulation.randomAudit().draws(), trailTick: interval.endTick };
  }
  const ticks = simulation.gameTick() - startTick, last = intervals.at(-1)!;
  const expected = await endStateHash(end, last.island);
  if (expected === null) return { ...skipped("The end snapshot shows another island"), ticks };
  const actual = hashSettlementState({ settlement: simulation.saveState(), world: island.world });
  if (actual === expected)
    return { ...islandScripts(simulation.scriptSnapshot(), island.world),
      ...campaignEvidence(baseGame, simulation.campaignOutcome()?.kind), status: "verified", ticks };
  return { interval: intervals.length - 1, island: last.island, status: "mismatch", ticks,
    mismatch: { actual, expected, kind: "snapshot", tick: simulation.gameTick() } };
};
