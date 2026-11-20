import type { I18n } from "@lingui/core";

import { FORMATS } from "../../../../island-of-settlers-shared/src/formats";
import {
  COLONY_CANCELLED_QUEST_ID, COLONY_HARBOUR_LOST_QUEST_ID, COLONY_HOLD_QUEST_ID
} from "../../../../island-of-settlers-shared/src/script/constants";
import { activeOperation } from "../../shared/campaign/active-operation";
import type { CampaignRunState } from "../../shared/campaign/campaign-run";
import type { CampaignRunEnd } from "../../shared/campaign/campaign-run-end";
import type { CampaignVictoryShipment } from "../../shared/campaign/campaign-victory-reward";
import { translateMessage } from "../../shared/i18n/translate";
import { talentModifiers } from "../../shared/progression/talents";
import {
  type AdventureIsland, adventureRewardGoods, isAdventureIsland
} from "../../shared/settlement/adventure-rules";
import {
  addAdventureRecord, addColonyRecord,   type Archipelago,
  type ColonyRecord, colonySurvivors, emptyArchipelago, endAdventure, endColony, expireColony,
  expiredColonies, findAdventure, findColony, findIsland, isColonyVisitRequest, islandSurvivors,
  updateAdventureStatus,
  updateColonyStatus} from "../../shared/settlement/archipelago";
import { colonyNoticeMessage, failColonyQuest } from "../../shared/settlement/archipelago-colony-quests";
import { pendingColonyRelief, pruneClaimedReliefReceipts } from "../../shared/settlement/archipelago-relief";
import { homeGarrisonReserves } from "../../shared/settlement/colony-troop-supply";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import { retainedGarrisonIds } from "../../shared/settlement/military-garrison-preservation";
import { rewardShipLoads } from "../../shared/settlement/reward-ship-loads";
import type { ClosedRoadDecorationReturn } from "../../shared/settlement/road-decoration-closures";
import { isHomeBuilding } from "../../shared/settlement/settlement-home";
import type { EmigratedTroop } from "../../shared/settlement/settlement-military";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { Goods } from "../../shared/settlement/settlement-types";
import { shipTravelSeconds } from "../../shared/settlement/ship-travel-time";
import type { CampaignEndReport } from "../cloud/economy-client";
import { errorMessage } from "../helpers";
import type { IslandDestination, IslandHandoffRequest, IslandHandoffResult } from "../island-handoff";
import type { SaveStore } from "../save-store/save-store";
import {
  createSessionLifecycle, type SessionLifecycle, type SessionToken, SessionTransitionCancelled
} from "../session-lifecycle";
import { SESSION_MESSAGES } from "../session-messages";
import { formatColonyDurationSource as formatColonyDuration } from "../settlement-ui/colony-time";
import { describeWares } from "../settlement-ui/helpers";
import { createArchivedIslandAccess } from "./archived-island-access";
import { createArchivedReliefCoordinator } from "./archived-relief-coordinator";
import { createCampaignHomeGrants } from "./campaign-home-grants";
import { createCampaignRunEnd, type HomelessRunEnd } from "./campaign-run-end";
import { type CampaignAttemptStarter, createCampaignRunStart } from "./campaign-run-start";
import { createColonyEconomy } from "./colony-economy-session";
import type { IslandHandoffTrigger } from "./island-handoff-policy";
import { prepareIslandTravel } from "./island-travel-plan";

interface ArchipelagoSessionOptions {
  acceptClosedRoadDecorationReturns?: (rows: readonly ClosedRoadDecorationReturn[]) => boolean;
  /**
   * The campaign run on screen (C2). Home is filed meanwhile: nothing settles at home, filed islands do not
   * progress live (they catch up on the next load), and island travel from the run is left to the campaign lanes.
   */
  campaignRun?: CampaignRunState;
  initial?: Archipelago;
  simulation: SettlementSimulation;
  /** The active island's save, without its archipelago. */
  capture(): Promise<GameSaveV1>;
  /** Active interface language for the fixed travel status copy; absent keeps the English source. */
  i18n?: I18n;
  notify(message: string): void;
  store: Pick<SaveStore, "writeSavedGame" | "writeStartupGame">;
  reload(): void | Promise<void>;
  /** A filed colony expired: its island leaves the save (the caller saves soon). */
  onIslandEnded?: () => void;
  onReliefReturned?: (records: ReturnType<typeof pendingColonyRelief>) => void;
  /** In-page saved-island travel; absent keeps the reload path. */
  handoff?: (request: IslandHandoffRequest) => Promise<IslandHandoffResult<unknown, unknown>>;
  /** Game time (UTC ms); default the island's game clock. */
  now?: () => number;
  sourceVersion?: string;
  /** Live player progress; every boot payload carries it, never a copy filed with an island. */
  player?: () => import("../../shared/progression/player-progress").PlayerProgress;
  prepareArchivedProgress?: (next: import("../../shared/progression/player-progress").PlayerProgress) =>
    import("../../shared/progression/player-progress").PlayerProgress;
  acceptArchivedProgress?: (expected: import("../../shared/progression/player-progress").PlayerProgress,
    next: import("../../shared/progression/player-progress").PlayerProgress) => boolean;
  /** Waits for an in-flight save before the departure capture is taken (save-before-travel). */
  settle?: () => Promise<void>;
  /** Serializes island-changing travel with import and resume; standalone tests create their own. */
  transition?: SessionLifecycle;
  /**
   * A signed-in player's adventure loot is the server's ledger credit (D4 follow-up 2): the confirmed goods, or the
   * refusal; a thrown error (offline) keeps the adventure filed. Guests compute the loot locally.
   */
  claimAdventure?: (island: AdventureIsland, lootBonus: number) => Promise<Goods | string>;
  /** A won campaign run's victory reward (C12): the reward ship's load or the refusal; throws when offline. */
  claimCampaignVictory?: (run: CampaignRunState) => Promise<CampaignVictoryShipment | string | undefined>;
  /**
   * A signed-in player's campaign attempt end (C9a), a victory with its named exit (BR2): the stored path facts
   * (BR4), else the refusal; throws when offline.
   */
  reportCampaignEnd?: (attemptId: string, end: CampaignRunEnd, exit?: string) =>
    Promise<CampaignEndReport | string>;
  /** The server stored a campaign attempt end: its path facts, kept for the home island (BR4). */
  onCampaignEndReported?: (run: CampaignRunState, report: CampaignEndReport) => void;
  /** A signed-in player's new campaign attempt (C8): its id and start status, else the refusal; throws offline. */
  startCampaignAttempt?: CampaignAttemptStarter;
  /** Offers the island's pending home claims again and waits for the answers (a won campaign replay, C9b). */
  flushHomeClaims?: () => Promise<void>;
  /** A run without a home ended (GS3a): store the slot's progress and leave to the landing. */
  leaveWithoutHome?: (
    player: import("../../shared/progression/player-progress").PlayerProgress, ended: HomelessRunEnd
  ) => Promise<void>;
}

/** Island travel: files the active island, saves the whole group, then boots the next island. */
export const createArchipelagoSession = (options: ArchipelagoSessionOptions) => {
  const t = (descriptor: Parameters<typeof translateMessage>[1], values?: Parameters<typeof translateMessage>[2]) =>
    translateMessage(options.i18n, descriptor, values);
  let archipelago = options.initial ?? emptyArchipelago();
  /** The run's campaign state; it changes only through its pending home grants. */
  let campaignRun = options.campaignRun;
  const homeOnScreen = () => archipelago.active === null && !campaignRun;
  /** The save on screen as stored: a campaign run carries its campaign state. */
  const withCampaignRun = (save: GameSaveV1): GameSaveV1 => campaignRun ? { ...save, campaignRun } : save;
  const captureActive = async () => withCampaignRun(await options.capture());
  const settleDecorationReturns = () => {
    const pending = archipelago.closedRoadDecorations;
    if (pending?.length && options.acceptClosedRoadDecorationReturns?.(pending))
      archipelago = { ...archipelago, closedRoadDecorations: undefined };
  };
  let disbanding = false;
  const now = options.now ?? options.simulation.gameNow;
  const transition = options.transition ?? createSessionLifecycle();
  const lootBonus = () => talentModifiers(options.player?.().talents).adventureLoot;
  /** A won adventure's loot: local for guests, the server's confirmed credit for a signed-in player. */
  const wonLoot = async (island: AdventureIsland): Promise<Goods | null> => {
    if (!options.claimAdventure) return adventureRewardGoods(island, lootBonus());
    try {
      const loot = await options.claimAdventure(island, lootBonus());
      if (typeof loot !== "string") return loot;
      options.notify(`The server did not confirm the adventure reward: ${loot}`);
      return {};
    } catch {
      options.notify(t(SESSION_MESSAGES.travel.offlineReward));
      return null;
    }
  };
  /**
   * A colony ends with its survivors; an adventure also hands over its reward when it was won, raised by the
   * adventure loot talent. Null when the server could not be reached (nothing changes then).
   */
  const endIsland = async (group: Archipelago, id: number, survivors: readonly EmigratedTroop[]) => {
    const adventure = findAdventure(group, id);
    if (!adventure) return endColony(group, id, survivors);
    const rewards = adventure.status === "won" ? await wonLoot(adventure.island) : {};
    return rewards && endAdventure(group, id, survivors, rewards);
  };
  const archivedAccess = createArchivedIslandAccess({ capture: captureActive, group: () => archipelago,
    persist: options.store, player: options.player, now, sourceVersion: options.sourceVersion,
    prepareArchivedProgress: options.prepareArchivedProgress,
    acceptArchivedProgress: options.acceptArchivedProgress, onProgressConflict: options.reload,
    setGroup: group => { archipelago = group; }, settle: options.settle, transition });
  const homeGrants = createCampaignHomeGrants({ archive: archivedAccess, busy: transition.busy,
    run: () => campaignRun, setRun: run => { campaignRun = run; } });
  const reliefChronology = createArchivedReliefCoordinator({ archive: archivedAccess, now, busy: transition.busy });
  const economy = createColonyEconomy({ group: () => archipelago, notify: options.notify, now,
    ownsArchivedIsland: reliefChronology.owns,
    setGroup: next => { archipelago = next; }, simulation: options.simulation });
  /**
   * Rewards and returning soldiers sail in on reward ships, one deck each (C12, plan item 35); without a harbour the
   * goods go straight to the home building and the soldiers into its reserve.
   */
  const deliverRewards = (rewards: Goods, troops: readonly EmigratedTroop[]) => {
    if (!Object.keys(rewards).length && !troops.length) return;
    let sailed = false;
    for (const load of rewardShipLoads(rewards, troops)) {
      if (options.simulation.sendVisitorShip(load.cargo, [], "reward", load.troops) !== null) {
        sailed = true;
        continue;
      }
      if (Object.keys(load.cargo).length) options.simulation.receiveHomeGoods(load.cargo);
      if (load.troops.length) options.simulation.receiveTroops(load.troops);
    }
    // The ship notice only when something actually sails; a direct delivery keeps the caller's own notice.
    if (!sailed) return;
    if (Object.keys(rewards).length) options.notify(t(SESSION_MESSAGES.campaign.rewardShip,
      { wares: describeWares(rewards) }));
    else options.notify(t(SESSION_MESSAGES.campaign.rewardShipSoldiers, { soldiers: troops.length }));
  };
  /**
   * Home only: frees ended islands' expeditions, stores returning survivors and rewards, ends expired
   * colonies (their soldiers and wares wait for home ships).
   */
  const announce = (failure: ReturnType<typeof failColonyQuest>, colony: ColonyRecord) => {
    if (failure.notices.length)
      options.notify(colonyNoticeMessage(failure.notices, colony.island.name, options.i18n));
  };
  /**
   * Expiry is `colony.hold` failing in the archipelago executor (design §8.2): its `colonyEnd` frees the colony
   * and its `notify` is the toast. A book without the `colonyEnd` step still expires (the server enforces it).
   */
  const expireIn = (group: Archipelago, colony: ColonyRecord) => {
    const failure = failColonyQuest(group, colony, COLONY_HOLD_QUEST_ID, { now: now() });
    return failure.ended ? failure : { ...failure, archipelago: expireColony(group, colony, now()) };
  };
  /** Disbanding and harbour loss: the quest's `colonyEnd` + `notify` (design §8.2 item 6), survivors sail home. */
  const endColonyByQuest = (
    group: Archipelago, colony: ColonyRecord, questId: string, survivors: readonly EmigratedTroop[]
  ) => {
    const failure = failColonyQuest(group, colony, questId, { now: now(), survivors });
    return failure.ended ? failure : { ...failure, archipelago: endColony(group, colony.expeditionId, survivors) };
  };
  const expire = (colony: ColonyRecord) => {
    options.onReliefReturned?.(pendingColonyRelief(colony.save));
    const failure = expireIn(archipelago, colony);
    archipelago = failure.archipelago;
    announce(failure, colony);
    options.onIslandEnded?.();
  };
  /** Campaign settlers home (C9b): the people limit trims them, with one notification; null keeps them waiting. */
  const receiveSettlers = (count: number | undefined) => {
    if (!count) return undefined;
    const received = options.simulation.receiveSettlers(count);
    if (!received) return count;
    if (received.lost > 0) options.notify(t(SESSION_MESSAGES.campaign.settlersLost, { lost: received.lost }));
    return undefined;
  };
  const settleAtHome = () => {
    for (const colony of expiredColonies(archipelago, now())) expire(colony);
    economy.settleEvacuations();
    const pendingRelease = (archipelago.released ?? []).filter(id => !options.simulation.releaseColony(id));
    // Settlers first: they are trimmed to the people limit; soldiers then return in full, any above the limit
    // waiting in the HQ reserve (owner Q3 follow-up, R15).
    const { returningSettlers: waiting, ...group } = archipelago;
    const returningSettlers = receiveSettlers(waiting);
    if (archipelago.rewards || archipelago.returning?.length)
      deliverRewards(archipelago.rewards ?? {}, archipelago.returning ?? []);
    archipelago = { ...group, released: pendingRelease.length ? pendingRelease : undefined,
      returning: undefined, rewards: undefined, ...(returningSettlers ? { returningSettlers } : {}) };
  };
  /** Registers landed expeditions and mirrors the visited island's progress. */
  const sync = () => {
    if (archivedAccess.isMutating()) return archipelago;
    // Pending campaign grants join the group every save and travel capture writes (no-op without any).
    archipelago = homeGrants.fold(archipelago);
    archipelago = pruneClaimedReliefReceipts(archipelago, options.player?.());
    // The run's clock is its own tick: filed colonies expire at the next catch-up, not by the run's time.
    if (homeOnScreen()) settleAtHome();
    else if (!campaignRun) for (const colony of expiredColonies(archipelago, now())) {
      if (colony.expeditionId !== archipelago.active) expire(colony);
    }
    for (const expedition of options.simulation.colonyExpeditions()) {
      if (expedition.status !== "arrived" || archipelago.released?.includes(expedition.id)) continue;
      const landing = options.simulation.colonyLanding(expedition.id);
      if (!landing) continue;
      archipelago = isAdventureIsland(expedition.island)
        ? addAdventureRecord(archipelago, expedition.id, expedition.island, landing)
        : addColonyRecord(archipelago, expedition.id, expedition.island, landing);
    }
    const colony = options.simulation.colony(), adventure = options.simulation.adventure();
    if (colony && archipelago.active !== null)
      archipelago = updateColonyStatus(archipelago, archipelago.active, colony.status, colony.conqueredAt,
        options.simulation.talentModifiers().colonyShipIntervalReduction);
    if (adventure && archipelago.active !== null)
      archipelago = updateAdventureStatus(archipelago, archipelago.active, adventure.status);
    settleDecorationReturns();
    return archipelago;
  };
  /** The filed islands a save carries (none while the player only has the home island). */
  const groupForSave = (): Archipelago | undefined => {
    const current = sync();
    const grouped = current.colonies.length || current.adventures?.length || current.active !== null ||
      current.campaign ||
      current.evacuations?.length || current.reliefReceipts?.length || current.closedRoadDecorations?.length;
    return grouped ? current : undefined;
  };
  const attach = (save: GameSaveV1): GameSaveV1 => {
    const archipelago = groupForSave();
    return withCampaignRun(archipelago ? { ...save, archipelago } : save);
  };
  const boot = async (payload: object, saveSlot: boolean) => {
    const game = { ...payload, player: options.player?.() } as GameSaveV1, text = JSON.stringify(game);
    // An unvisited island has no save yet; it is saved right after its island is created.
    if (saveSlot) await options.store.writeSavedGame(game);
    await options.store.writeStartupGame(text);
    await options.reload();
  };
  /** Files the departing island and boots the next one under the page's one transition at a time. */
  const runTravel = async (key: string, action: (token: SessionToken) => Promise<boolean>) => {
    const result = await transition.run({ key, run: action });
    if (result.ok) return result.value;
    if (result.reason === "busy") options.notify(t(SESSION_MESSAGES.common.busy));
    else if (result.reason === "failed")
      options.notify(errorMessage(result.error, t(SESSION_MESSAGES.common.failed)));
    else if (result.reason === "stale") options.notify(t(SESSION_MESSAGES.common.changedBeforeTravel));
    return false;
  };
  const travelInPage = async (target: number | null) => {
    try {
      const outcome = await options.handoff!({
        key: `travel:${target ?? "home"}`,
        resolve: async token => {
          const { departure, payload } = await prepareIslandTravel({
            capture: captureActive, endIsland, group: sync, settle: options.settle, target, token
          });
          let destination: IslandDestination;
          if (isColonyVisitRequest(payload))
            destination = { kind: "visit", payload, targetKey: `island:${target}` };
          else if (payload.format === FORMATS.gameSave.id)
            destination = {
              kind: "saved", payload, targetKey: target === null ? "home" : `island:${target}`
            };
          else throw new SessionTransitionCancelled();
          return { departure, destination, saveDeparture: true };
        },
        trigger: (() => {
          if (target === null) return "travel-home";
          return findIsland(archipelago, target)?.save ? "travel-saved-island" : "travel-first-visit";
        })() satisfies IslandHandoffTrigger
      });
      if (outcome.ok) return true;
      if (outcome.reason === "reload-required") {
        await options.reload();
        return true;
      }
      if (outcome.reason === "busy") options.notify(t(SESSION_MESSAGES.common.busy));
      else if (outcome.reason !== "cancelled" && outcome.reason !== "stale")
        options.notify(t(SESSION_MESSAGES.common.failed));
      return false;
    } catch (error) {
      options.notify(errorMessage(error, t(SESSION_MESSAGES.common.failed)));
      return false;
    }
  };
  const campaignEnd = createCampaignRunEnd({ afterVictory: options.flushHomeClaims, boot: game => boot(game, true),
    claimVictory: options.claimCampaignVictory, group: sync, leaveWithoutHome: options.leaveWithoutHome,
    notify: options.notify, player: options.player,
    offlineVictory: () => t(SESSION_MESSAGES.campaign.victoryOffline), report: options.reportCampaignEnd,
    reported: options.onCampaignEndReported, run: () => campaignRun, setRun: run => { campaignRun = run; },
    settle: options.settle, simulation: options.simulation, travel: runTravel });
  const operation = () => activeOperation(options.simulation.colonyExpeditions(), sync());
  const campaignStart = createCampaignRunStart({ boot: payload => boot(payload, true), capture: options.capture,
    group: sync, homeOnScreen, now, operation, player: options.player,
    settle: options.settle, simulation: options.simulation, startAttempt: options.startCampaignAttempt,
    travel: runTravel });
  const travel = (target: number | null) => {
    // A campaign run is left only through `endCampaignRun` (C9a).
    if (campaignRun || target === archipelago.active || disbanding) return Promise.resolve(false);
    if (options.handoff && (target === null || Boolean(findIsland(archipelago, target))))
      return travelInPage(target);
    return runTravel(`travel:${target ?? "home"}`, async token => {
      const { payload } = await prepareIslandTravel({
        capture: captureActive, endIsland, group: sync, settle: options.settle, target, token
      });
      await boot(payload, "map" in payload);
      return true;
    });
  };
  /** Ends the island on screen: its survivors (and an adventure's reward) sail home with the player. */
  const endActive = async (id: number, token: SessionToken, questId = COLONY_CANCELLED_QUEST_ID) => {
    await options.settle?.();
    if (!token.current()) throw new SessionTransitionCancelled();
    const activeState = options.simulation.saveState();
    const survivors = colonySurvivors({ settlement: activeState } as GameSaveV1);
    const readyReceipt = activeState.reliefCollections?.jobs.some(job => job.departed);
    const hasDecorations = activeState.roadDecorations && (activeState.roadDecorations.placed.length || activeState.roadDecorations.returns.length);
    const activeSave = readyReceipt || hasDecorations ? await options.capture() : undefined;
    const group = sync();
    const filed = { ...group, active: null, colonies: activeSave ? group.colonies.map(colony => colony.expeditionId === id
      ? { ...colony, save: activeSave } : colony) : group.colonies,
    adventures: activeSave ? group.adventures?.map(adventure => adventure.expeditionId === id
      ? { ...adventure, save: activeSave } : adventure) : group.adventures };
    const colony = findColony(filed, id);
    const failure = colony && endColonyByQuest(filed, colony, questId, survivors);
    const ended = failure ? failure.archipelago : await endIsland(filed, id, survivors);
    if (!ended || !token.current()) throw new SessionTransitionCancelled();
    if (failure) announce(failure, colony!);
    await boot({ ...ended.home!, archipelago: { ...ended, home: undefined } }, true);
    return true;
  };
  /** Disbanding (or abandoning) the island on screen sails home; others end from their filed save. */
  const disband = (id: number) => {
    const record = findIsland(sync(), id);
    if (!record || transition.busy()) return Promise.resolve(false);
    const pending = archipelago.active === id ? options.simulation.saveState().reliefCollections?.jobs.some(job => !job.departed)
      : pendingColonyRelief(record.save).length;
    if (pending) { options.notify("Wait for the paid relief ship before abandoning this island"); return Promise.resolve(false); }
    if (archipelago.active === id) return runTravel("travel:home", token => endActive(id, token));
    const once = async (action: () => Promise<void>) => {
      if (disbanding) return false;
      disbanding = true;
      try { await action(); return true; } finally { disbanding = false; }
    };
    return once(async () => {
      await options.settle?.();
      const survivors = islandSurvivors(record), colony = findColony(archipelago, id);
      const failure = colony && endColonyByQuest(archipelago, colony, COLONY_CANCELLED_QUEST_ID, survivors);
      const ended = failure ? failure.archipelago : await endIsland(archipelago, id, survivors);
      if (!ended) return;
      archipelago = ended;
      if (homeOnScreen()) settleAtHome();
      await options.store.writeSavedGame(attach(await options.capture()));
      if (failure) announce(failure, colony!);
      else options.notify(`${record.island.name} was abandoned; its troops sailed home.`);
    });
  };
  let expiryAge = 0, harbourSeen = false;
  /** The colony on screen lost its harbour, its home building (`colony.harbourLost`, owner 42). */
  const activeHarbourLost = () => {
    if (!findColony(archipelago, archipelago.active) || !options.simulation.colony()) return false;
    const standing = options.simulation.buildings().some(isHomeBuilding);
    harbourSeen ||= standing;
    return harbourSeen && !standing;
  };
  const endLostColony = () => {
    const id = archipelago.active;
    if (id === null || !activeHarbourLost()) return;
    void runTravel("travel:home", token => endActive(id, token, COLONY_HARBOUR_LOST_QUEST_ID));
  };
  const update = (dt: number) => {
    // Filed islands do not progress live while a campaign run is shown (plan item 25): no relief chronology,
    // colony economy or expiry by the run's clock.
    if (campaignRun) return homeGrants.update(dt);
    if (transition.busy()) return;
    reliefChronology.update(dt);
    if (transition.busy()) return;
    economy.update(dt);
    expiryAge += dt;
    if (expiryAge < 1 || disbanding || transition.busy()) return;
    expiryAge = 0;
    sync();
    const colony = expiredColonies(archipelago, now()).find(entry => entry.expeditionId === archipelago.active);
    if (!colony) return endLostColony();
    void runTravel("travel:home", async token => {
      await options.settle?.();
      if (!token.current()) throw new SessionTransitionCancelled();
      const current = await options.capture();
      if (!token.current()) throw new SessionTransitionCancelled();
      const ending = { ...colony, save: current };
      options.onReliefReturned?.(pendingColonyRelief(current));
      const failure = expireIn({ ...archipelago, active: null }, ending);
      const ended = failure.archipelago;
      if (!ended.home) throw new Error("The home island is unavailable for colony evacuation");
      announce(failure, colony);
      await boot({ ...ended.home, archipelago: { ...ended, active: null, home: undefined } }, true);
      return true;
    });
  };
  /** A finished adventure is discarded on the way home; any other island is filed for a later visit. */
  const returnHome = () => travel(null);
  const recallSoldiers = (id: number) => {
    const colony = sync().colonies.find(entry => entry.expeditionId === id);
    if (!colony || archipelago.active !== id || transition.busy()) return false;
    const retained = retainedGarrisonIds(options.simulation.buildings(), options.simulation.frames());
    const available = new Set(options.simulation.frames().filter(actor => actor.navalOrder === undefined && !retained.has(actor.uid))
      .map(actor => actor.uid));
    const ids = options.simulation.militarySoldiers().filter(soldier =>
      (soldier.combat?.faction ?? 0) === 0 && available.has(soldier.actor)).map(soldier => soldier.actor);
    if (!ids.length) { options.notify(t(SESSION_MESSAGES.travel.defenderRequired)); return false; }
    const accepted = options.simulation.requestTroopPickup(ids, colony.island.voyageSeconds);
    if (!accepted.length) { options.notify(t(SESSION_MESSAGES.travel.noHarbour)); return false; }
    for (const site of options.simulation.militaryBuildings()) {
      const keeper = options.simulation.militarySoldiers().find(soldier =>
        soldier.building === site.uid && retained.has(soldier.actor));
      const plan = { archer: 0, heavy: 0, shield: 0 };
      const type = keeper?.combat?.type;
      if (type === "archer" || type === "heavy" || type === "shield") plan[type] = 1;
      options.simulation.setMilitaryComposition(site.uid, plan);
    }
    options.simulation.returnMilitaryHome(accepted);
    options.notify(`Ship requested: arrives in ${formatColonyDuration(shipTravelSeconds(colony.island.voyageSeconds,
      options.simulation.talentModifiers().shippingTimeReduction))}. ` +
      `${accepted.length} soldiers will gather at the harbour and sail home.`);
    return true;
  };
  settleDecorationReturns();
  return {
    ...archivedAccess,
    advanceArchivedReliefTo: reliefChronology.advanceTo,
    archivedReliefReceipts: () => archipelago.reliefReceipts ?? [],
    archivedReliefBlocker: reliefChronology.blocker,
    whenArchivedReliefIdle: reliefChronology.whenIdle,
    dispose: reliefChronology.dispose,
    attach,
    groupForSave,
    recallSoldiers,
    receiveReturnedTroops: (troops: readonly EmigratedTroop[]) => {
      archipelago = { ...archipelago, returning: [...(archipelago.returning ?? []), ...troops] };
      options.notify(`${troops.length} soldiers sailed home from the colony.`);
    },
    homeGarrisonReserves: () => archipelago.active !== null && archipelago.home
      ? homeGarrisonReserves(archipelago.home.settlement) : undefined,
    active: () => archipelago.active,
    /** The campaign run on screen; undefined on an island. */
    campaignRun: () => campaignRun,
    /** Sails home from the campaign run: as its decided outcome, or giving it up while it runs (C9a). */
    endCampaignRun: campaignEnd.end,
    /** The run's map was won or lost (the simulation's `onCampaignOutcome`). */
    recordCampaignOutcome: campaignEnd.recordOutcome,
    /**
     * A home-bound grant from the campaign map, written into `archipelago.rewards` once per id through the
     * serialized write; a refused write keeps it pending in the run's save until a retry writes it.
     */
    queueHomeGrant: homeGrants.queue,
    adventures: () => sync().adventures ?? [],
    colonies: () => sync().colonies,
    /** What holds the shared operation slot: the home expeditions plus the filed colonies, adventure and run. */
    operation,
    /** Leaves the home island for a campaign map (C8): cargo debited, attempt started, the run booted. */
    startCampaignRun: campaignStart.start,
    disband,
    receiveAbroad: economy.receiveAbroad,
    returnHome,
    update,
    visit: (id: number) => travel(id),
    voyageSeconds: () => {
      const active = archipelago.active;
      if (active === null) return 0;
      return findIsland(archipelago, active)?.island.voyageSeconds ?? 0;
    }
  };
};
export type ArchipelagoSession = ReturnType<typeof createArchipelagoSession>;
