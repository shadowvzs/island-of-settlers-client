import type { CampaignOutcomeRecord } from "../../shared/campaign/campaign-map-outcome";
import { campaignRunMapStatus, type CampaignRunState } from "../../shared/campaign/campaign-run";
import {
  type CampaignRunEnd, campaignRunEndExit, campaignRunEndOf, campaignRunSettlers, campaignRunSurvivors,
  campaignRunWithOutcome, endCampaignRunGroup
} from "../../shared/campaign/campaign-run-end";
import type { CampaignVictoryShipment } from "../../shared/campaign/campaign-victory-reward";
import { homelessRunEndProgress } from "../../shared/campaign/homeless-run";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import { type Archipelago, colonySurvivors } from "../../shared/settlement/archipelago";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementOptions } from "../../shared/settlement/settlement-types";
import type { CampaignEndReport } from "../cloud/economy-client";
import { type SessionToken, SessionTransitionCancelled } from "../session-lifecycle";

/** What a run without a home leaves for the landing (GS3b): the run's end and the progress before it. */
export interface HomelessRunEnd {
  before: PlayerProgress;
  run: Pick<CampaignRunState, "campaignId" | "status">;
}

interface CampaignRunEndOptions {
  /**
   * The server stored the run's victory: held home claims are offered again (a replay pays its third only once won,
   * C9b) and their grants join the group before the run leaves.
   */
  afterVictory?(): Promise<void>;
  /**
   * The won run's victory reward (C12): credits the player's part and answers the reward ship's load, or the
   * refusal; throws when the server was not reached. Undefined: rewards are off (plan §9.3), nothing sails.
   * Absent: no reward (headless tools).
   */
  claimVictory?(run: CampaignRunState): Promise<CampaignVictoryShipment | string | undefined>;
  /** Saves the home game and boots it (the session's `boot(payload, true)`). */
  boot(payload: GameSaveV1): Promise<void>;
  /** The current group, with pending home grants folded in (`sync`). */
  group(): Archipelago;
  /**
   * A run without a home ended (GS3a): stores the slot's player progress (the exit recorded on a victory) and leaves
   * to the landing (GS3b). Absent: a run without a filed home cannot end (a home session's invariant).
   */
  leaveWithoutHome?(player: PlayerProgress, ended: HomelessRunEnd): Promise<void>;
  notify(message: string): void;
  /** Text of a victory (or its reward claim) that could not reach the server (translated by the caller). */
  offlineVictory(): string;
  /**
   * Tells the server how the attempt ended, a victory with the named exit its script chose (absent: the implicit
   * `victory` exit): the stored path facts, the refusal otherwise; a thrown error means the server was not reached.
   * Absent for guests.
   */
  report?(attemptId: string, end: CampaignRunEnd, exit?: string): Promise<CampaignEndReport | string>;
  /** Live player progress (the run's player row). */
  player?(): PlayerProgress;
  /** The server stored the end: its path facts, to be shown at home after the reload (BR4). */
  reported?(run: CampaignRunState, report: CampaignEndReport): void;
  run(): CampaignRunState | undefined;
  setRun(run: CampaignRunState): void;
  settle?(): Promise<void>;
  simulation: Pick<SettlementSimulation, "campaignSettlers" | "saveState">;
  /** Runs one island change under the session's transition lock (`runTravel`). */
  travel(key: string, action: (token: SessionToken) => Promise<boolean>): Promise<boolean>;
}

/**
 * The end of the campaign run on screen (C9a). The map's outcome is recorded on the run when the simulation decides
 * it; ending the run then sails home: a decided map ends as its outcome, a running one is given up (a restart gives
 * up first). After a defeat nothing returns; otherwise the shipped soldiers and settlers still alive wait to be
 * stored at home (settlers within the home people limit, C9b).
 * The marker leaves the group, so the run's stored row is pruned with the next save.
 */
export const createCampaignRunEnd = (options: CampaignRunEndOptions) => {
  /** False keeps the player on the map: a victory the server has not stored yet must not be lost. */
  const reported = async (run: CampaignRunState, end: CampaignRunEnd) => {
    if (!run.attemptId || !options.report) return true;
    try {
      const answer = await options.report(run.attemptId, end, campaignRunEndExit(run, end));
      if (typeof answer === "string") options.notify(answer);
      else options.reported?.(run, answer);
      return true;
    } catch {
      if (end !== "victory") return true;
      options.notify(options.offlineVictory());
      return false;
    }
  };
  /**
   * The reward-ship load of a won run, claimed once: a claimed run keeps its load, so a retry never pays twice. A
   * refusal sails home without a reward (with its notice); null keeps the player on the map (server unreachable).
   */
  const victoryLoad = async (run: CampaignRunState): Promise<CampaignVictoryShipment | undefined | null> => {
    if (run.rewardClaimed) return run.victoryShipment;
    if (!options.claimVictory) return undefined;
    let answer: CampaignVictoryShipment | string | undefined;
    try {
      answer = await options.claimVictory(run);
    } catch {
      options.notify(options.offlineVictory());
      return null;
    }
    if (typeof answer === "string") options.notify(answer);
    const victoryShipment = typeof answer === "string" ? undefined : answer;
    // The claim's XP may have queued level-up grants on the run meanwhile: build on the current run state.
    const current = options.run() ?? run;
    options.setRun({ ...current, rewardClaimed: true, ...(victoryShipment ? { victoryShipment } : {}) });
    return victoryShipment;
  };
  /**
   * A signed-in run whose rules pay rewards (it carries its map's rewards, PROG) claims its victory before it
   * leaves; the server pays the wallet kinds only without a home (§9.3). False keeps the player on the map.
   */
  const claimedWithoutHome = async (run: CampaignRunState, end: CampaignRunEnd) => {
    if (end !== "victory" || !run.attemptId || !run.rewards) return true;
    return (await victoryLoad(run)) !== null;
  };
  /** No home to sail to (plan §7.4 step 5): no survivors, no reward ship; the progress keeps the exit. */
  const finishWithoutHome = async (run: CampaignRunState, end: CampaignRunEnd, token: SessionToken) => {
    if (!(await claimedWithoutHome(run, end)) || !token.current()) return false;
    const player = options.player?.();
    if (!options.leaveWithoutHome || !player) throw new Error("The campaign run has no filed home island");
    await options.leaveWithoutHome(homelessRunEndProgress(run, player), { before: player, run });
    return true;
  };
  const finish = async (run: CampaignRunState, token: SessionToken) => {
    await options.settle?.();
    if (!token.current()) throw new SessionTransitionCancelled();
    const end = campaignRunEndOf(run.status);
    if (!(await reported(run, end)) || !token.current()) return false;
    if (!options.group().home) return finishWithoutHome(run, end, token);
    if (end === "victory" && run.attemptId) await options.afterVictory?.();
    if (!token.current()) throw new SessionTransitionCancelled();
    const reward = end === "victory" ? await victoryLoad(run) : undefined;
    if (reward === null || !token.current()) return false;
    const alive = colonySurvivors({ settlement: options.simulation.saveState() } as GameSaveV1);
    const group = options.group();
    if (!group.home) throw new Error("The campaign run has no filed home island");
    const settlers = campaignRunSettlers(run, end, options.simulation.campaignSettlers());
    const ended = endCampaignRunGroup(group, { reward, settlers, soldiers: campaignRunSurvivors(run, end, alive) });
    await options.boot({ ...group.home, archipelago: { ...ended, home: undefined } });
    return true;
  };
  return {
    /** Ends the run on screen: as its outcome when decided, else as given up. False when nothing changed. */
    end: () => {
      const run = options.run();
      if (!run) return Promise.resolve(false);
      return options.travel("travel:home", token => finish(run, token));
    },
    /**
     * The simulation decided the map: the run keeps the outcome and a victory's named exit (saved with it) until
     * the player sails home.
     */
    recordOutcome: (outcome: Readonly<CampaignOutcomeRecord>) => {
      const run = options.run();
      if (run?.status === "running") options.setRun(campaignRunWithOutcome(run, outcome));
    }
  };
};

/** The settlement options of a campaign run on screen: its map status (fixed per attempt) and the outcome hand-off. */
export const campaignRunOptions = (
  run: CampaignRunState | undefined, onOutcome: NonNullable<SettlementOptions["onCampaignOutcome"]>
): Pick<SettlementOptions, "campaignMapStatus" | "onCampaignOutcome"> =>
  run ? { campaignMapStatus: () => campaignRunMapStatus(run), onCampaignOutcome: onOutcome } : {};
