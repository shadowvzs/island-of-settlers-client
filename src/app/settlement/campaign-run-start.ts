import type { CampaignCargo, CampaignMap } from "../../../../island-of-settlers-shared/src/campaign/campaign-model";
import {
  campaignAttemptNumber, campaignLaunchOf, campaignRunGame, campaignShippedOf
} from "../../shared/campaign/campaign-departure-game";
import {
  type CampaignRunStart, type CampaignRunState, createCampaignRunState
} from "../../shared/campaign/campaign-run";
import { campaignRunWorld, campaignStartOptions } from "../../shared/campaign/campaign-start";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { Archipelago } from "../../shared/settlement/archipelago";
import { createGameSave, type GameSaveV1 } from "../../shared/settlement/game-save";
import { campaignMonumentGarrison } from "../../shared/settlement/monument-start-garrison";
import type { EmigratedTroop } from "../../shared/settlement/settlement-military";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SimRules } from "../../shared/settlement/sim-rules";
import type { LoadedMap } from "../../shared/world/save/map-reader";
import { scriptOf } from "../../shared/world/script-of";
import type { WorldData } from "../../shared/world/world-data";
import { type SessionToken, SessionTransitionCancelled } from "../session-lifecycle";
import { CAMPAIGN_NOT_HOME } from "./constants";
import { createHeadlessSimulation } from "./headless-replay";

/** One chosen map leaving from one home harbour; `loaded` is the map file the record names. */
export interface CampaignDeparture {
  loaded: LoadedMap;
  map: CampaignMap;
  sourceUid: number;
}

/** The server's answer to a new attempt: its id and start status, or the refusal; throws when not reached. */
export type CampaignAttemptStarter = (campaignId: string, mapId: string) =>
  Promise<Required<Pick<CampaignRunStart, "attemptId" | "mapStatus">> | string>;

/**
 * The server attempt of a run: a guest (no starter) or an unreachable server starts an untracked attempt (C9a); a
 * refusal (English text) stops the start.
 */
export const startServerAttempt = async (
  startAttempt: CampaignAttemptStarter | undefined, { campaignId, id }: Pick<CampaignMap, "campaignId" | "id">
): Promise<CampaignRunStart | string> => {
  if (!startAttempt) return {};
  try {
    return await startAttempt(campaignId, id);
  } catch {
    return {};
  }
};

interface CampaignRunStartOptions {
  /** Saves the run's first game and boots it (the session's `boot(payload, true)`). */
  boot(payload: GameSaveV1): Promise<void>;
  /** The home island's save, without its archipelago. */
  capture(): Promise<GameSaveV1>;
  group(): Archipelago;
  homeOnScreen(): boolean;
  /** Home game time (UTC ms). */
  now(): number;
  operation(): ReturnType<typeof import("../../shared/campaign/active-operation").activeOperation>;
  player?(): PlayerProgress;
  settle?(): Promise<void>;
  simulation: Pick<SettlementSimulation, "campaignRequirements" | "departCampaign" | "playerNation">;
  /** Absent for guests: the run then starts without an attempt id. */
  startAttempt?: CampaignAttemptStarter;
  /** Runs one island change under the session's transition lock (`runTravel`). */
  travel(key: string, action: (token: SessionToken) => Promise<boolean>): Promise<boolean>;
}

/** The map file's world as the run plays it; throws before anything leaves home when the file cannot be played. */
export const campaignDepartureWorld = ({ loaded, map }: Pick<CampaignDeparture, "loaded" | "map">) =>
  campaignRunWorld({ ...loaded.world, script: scriptOf(loaded.world, map) ?? undefined }, map);

interface CampaignRunSaveInput {
  /** The shipment that left home (soldiers already trimmed to the map's cap); absent without a home (GS3a). */
  cargo?: CampaignCargo;
  loaded: LoadedMap;
  map: CampaignMap;
  nation: ReturnType<SettlementSimulation["playerNation"]>;
  /** Game time (UTC ms) the run's own clock starts at. */
  now: number;
  run: CampaignRunState;
  /** Session rules pinned into the fresh run island before its first tick (no-home play, GS3a). */
  rules?: SimRules;
  /** The shipped soldiers, then the Monument defenders: stationed at the landing harbour before the first tick. */
  troops: readonly EmigratedTroop[];
  world: WorldData;
}

/**
 * The run's first save, built without a renderer (C9a start helpers): the landing harbour with the delivered goods
 * and settlers, the troops stationed, no tick run. The ordinary continued-save boot then restores it like any run.
 */
export const buildCampaignRunSave = async (
  { cargo, loaded, map, nation, now, rules, run, troops, world }: CampaignRunSaveInput
): Promise<GameSaveV1> => {
  const simulation = createHeadlessSimulation(world,
    { ...campaignStartOptions({ cargo, map, nation }), clockStart: now });
  const adopted = rules ? simulation.adoptGameRules(rules) : true;
  if (adopted !== true) throw new Error(adopted);
  if (troops.length && !simulation.stationCampaignStartTroops(troops))
    throw new Error("The campaign troops could not land");
  const save = await createGameSave(world, simulation.saveState(),
    { ...loaded.meta, animals: loaded.animals, savedAt: now, terrain: loaded.terrain });
  return { ...save, campaignRun: run };
};

/**
 * The start of a campaign run from the home island on screen (C8, simple departure): the launch gate, the server's
 * attempt, the recorded `departCampaign` command (goods, soldiers and settlers leave home at once), then the run's
 * first save with home filed is stored and booted. Nothing leaves home before the map file, the gate and the
 * server accepted the start.
 */
export const createCampaignRunStart = (options: CampaignRunStartOptions) => {
  /** The refusal of the departure in progress; the session's own failures are notified by `travel`. */
  let refusal = "";
  const refuse = (reason: string) => {
    refusal = reason;
    return false;
  };
  const begin = async (departure: CampaignDeparture, token: SessionToken) => {
    const { loaded, map, sourceUid } = departure, launch = campaignLaunchOf(map);
    await options.settle?.();
    if (!token.current()) throw new SessionTransitionCancelled();
    const world = campaignDepartureWorld(departure);
    const blocked = options.simulation.campaignRequirements(sourceUid, launch, options.operation()).reason;
    if (blocked) return refuse(blocked);
    const attempt = await startServerAttempt(options.startAttempt, map);
    if (typeof attempt === "string") return refuse(attempt);
    if (!token.current()) throw new SessionTransitionCancelled();
    const departed = options.simulation.departCampaign(sourceUid, launch);
    if (!departed.ok) return refuse(departed.reason);
    const now = options.now();
    const identity = { attempt: campaignAttemptNumber(now), campaignId: map.campaignId, mapId: map.id };
    const run = createCampaignRunState(identity,
      { ...attempt, ...campaignShippedOf(launch.cargo), rewards: map.rewards });
    const troops = [...departed.troops, ...campaignMonumentGarrison(options.player?.(), identity)];
    const runSave = await buildCampaignRunSave({ cargo: launch.cargo, loaded, map,
      nation: options.simulation.playerNation(), now, run, troops, world });
    await options.boot(campaignRunGame(await options.capture(), options.group(), runSave, now));
    return true;
  };
  return {
    /**
     * Leaves for the map: true, or the English domain refusal when nothing changed (empty when the session
     * already notified why, e.g. another island change is running).
     */
    start: async (departure: CampaignDeparture): Promise<true | string> => {
      if (!options.homeOnScreen()) return CAMPAIGN_NOT_HOME;
      refusal = "";
      return await options.travel("travel:campaign", token => begin(departure, token)) || refusal;
    }
  };
};
