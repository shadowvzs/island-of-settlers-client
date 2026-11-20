import {
  buildingExperience, LEVEL_THRESHOLDS, levelForExperience, MAX_PLAYER_LEVEL
} from "@shared/catalog/balance";

import { playerItemForOfferId } from "../../../../island-of-settlers-shared/src/player-inventory";
import type { RoadDecorationAction } from "../../../../island-of-settlers-shared/src/road-decoration-custody";
import { isRoadDecorationItemId, type RoadDecorationItemId } from "../../../../island-of-settlers-shared/src/road-decoration-items";
import type { ScriptMail } from "../../../../island-of-settlers-shared/src/script/types/ui";
import { getBuildingDefinition } from "../../render-common/buildings/building-catalog";
import { TOOL_WARES } from "../../render-common/wares/ware-catalog";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { type BattleMessage,createBattleMessage } from "../../shared/progression/battle-messages";
import { GEM_SHOP_CAMPAIGN_CLOSED, grantGems, purchaseGemOffer } from "../../shared/progression/gem-shop";
import { addInboxMails } from "../../shared/progression/inbox-mails";
import {
  hasCompletedMonument, hasMonumentBonus, monumentExperience, withHomeMonument
} from "../../shared/progression/monument-bonus";
import { consumeChooseNation, hasChooseNation } from "../../shared/progression/player-inventory";
import {
  awardExperience, createPlayerProgress, type LevelUp, migratePlayerProgress, type PlayerProgress,
questDayKey,
  recordProduction, refreshQuests} from "../../shared/progression/player-progress";
import {
  applyTalents, resetAppliedTalents, type TalentCommandResult
} from "../../shared/progression/player-talents";
import {
  effectivePlayerLevel, experienceEnabled, experienceResultUnderRules, levelsEarned, rewardsEnabled, TALENTS_OFF,
  talentsEnabled, withoutExperience
} from "../../shared/progression/progression-rules";
import { talentModifiers, type TalentRanks } from "../../shared/progression/talents";
import { homeDailyPoolEnabled, isHomeTutorialQuest } from "../../shared/quests/home-quest-book";
import { refreshHomeQuests } from "../../shared/quests/home-quests";
import {
type AdventureIsland,
  adventureRewardFor, adventureRewardGoods} from "../../shared/settlement/adventure-rules";
import type { ColonyDifficulty } from "../../shared/settlement/colony-expedition-rules";
import { colonyConquestReward } from "../../shared/settlement/colony-island-rules";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { SettlementBuilding } from "../../shared/settlement/settlement-types";
import type { ServerEconomy } from "../cloud/server-economy";
import type { PlayerRecoveryResult } from "./commander-recovery-session";
import { createArchivedPlayerProgress } from "./player-archive-progress";
import { createPlayerCampaignVictory } from "./player-campaign-victory";
import { createPlayerCommanderRecovery } from "./player-commander-recovery";
import { createPlayerDailyQuests } from "./player-daily-quests";
import { createPlayerHomeQuests } from "./player-home-quests";
import { createPlayerReliefSession } from "./player-relief-session";
import { createPlayerRoadDecorations } from "./player-road-decorations";
import type { ReliefIslandPort } from "./relief-island-port";
import type { PlayerRoadDecorationResult } from "./road-decoration-session";

const NO_ROOM = "No storage or insufficient island storage capacity for these goods";

/** Adventures record when they ended, colonies when they were conquered. */
const battleResultDate = (result: { endedAt?: number } | { conqueredAt?: number }) => {
  if ("endedAt" in result) return result.endedAt;
  return "conqueredAt" in result ? result.conqueredAt : undefined;
};

export interface PlayerProgressStore {
  get(): PlayerProgress | undefined;
  set(progress: PlayerProgress): void;
}

interface PlayerSessionOptions {
  roadDecorationOwnedUnits?: (item: RoadDecorationItemId) => number;
  mutateRoadDecoration?: (action: RoadDecorationAction) => Promise<PlayerRoadDecorationResult>;
  recoverCommanderWithItem?: (id:string)=>Promise<PlayerRecoveryResult>;
  /** Development grants and level jumps (owner 2026-10-15: false for online non-admins). */
  developmentAllowed?: boolean;
  /** Resolves command refusals in the locale shown at the command; identity in the server replay. */
  localize?: (text: string) => string;
  /** A signed-in player's gems belong to the server economy (phase B); guests keep them locally. */
  economy?: ServerEconomy;
  initial?: PlayerProgress;
  /** Shared canonical progress for multiple live offline island sessions. */
  store?: PlayerProgressStore;
  /** The player's nation: its drink chain replaces the Roman grapes and wine in daily quests. */
  nation?: WorkerNation;
  /** Game time (UTC ms): the island's game clock. */
  now: () => number;
  seed: number;
  onLevelUp?: (levelUps: readonly LevelUp[]) => void;
  /** Coordinated archived replay buffers level coins for their actual home instead of the private island. */
  receiveLevelUpCoins?: (coins: number) => void;
  /**
   * On a campaign map, home-bound grants (level-up coins) are queued into `archipelago.rewards` for the next home
   * visit instead of entering the run (plan item 19). The id (`level-<n>`) makes a retried grant credit once.
   * Without it (headless replay of a run) they are skipped.
   */
  queueHomeGrant?: (id: string, goods: Readonly<Record<string, number>>) => void;
  reliefIslands?: () => ReliefIslandPort | undefined;
  initialReliefArchives?: readonly GameSaveV1[];
  hasArchivedReliefHarbour?: () => boolean;
  isCurrent?: () => boolean;
  beforeReliefClaim?: () => Promise<true | string>;
  withReliefClaim?: (id: string, claim: () => Promise<true | string>) => Promise<true | string>;
}

/**
 * Player-wide experience, gems and daily quests; coins of a level up and gem shop purchases go to
 * this island's home storage.
 */
export const createPlayerSession = (options: PlayerSessionOptions) => {
  const { developmentAllowed = true, economy, localize = (text: string) => text, now } = options;
  const stored = options.store?.get();
  let progress = stored ?? (migratePlayerProgress(options.initial) as PlayerProgress | undefined) ??
    createPlayerProgress(options.seed);
  if (!stored) options.store?.set(progress);
  const inventoryListeners = new Set<() => void>();
  let inventoryBusy=false,alive=true;
  const commit = (next: PlayerProgress) => {
    const changedInventory = progress.inventory !== next.inventory;
    progress = next;
    options.store?.set(next);
    if (changedInventory) for (const listener of inventoryListeners) listener();
    return next;
  };
  if (economy) commit({ ...progress, gems: economy.startGems, inventory: economy.startInventory ?? {} });
  const stopGems = economy?.onGems(gems => { commit({ ...progress, gems }); });
  let simulation: SettlementSimulation | undefined;
  let relief: ReturnType<typeof createPlayerReliefSession> | undefined;
  /** The rules of the island on screen (plan §9); none before an island is bound (today's game). */
  const rules = () => simulation?.effectiveGameRules?.();
  /** The level the island plays with: the account level unless its rules fix or cap it. */
  const playerLevel = () => effectivePlayerLevel(rules(), levelForExperience(progress.experience));
  /** The ranks that count on this island: none while its rules switch talents off. */
  const activeTalents = (): TalentRanks => (talentsEnabled(rules()) ? progress.talents : {});
  /** Relief capability and, on the home island, its material tier cap (quest pools follow the map rules). */
  const questContext = () => {
    const base = relief?.context() ?? { reliefAvailable: false };
    // Optional calls: lightweight session stubs carry only part of the simulation.
    const home = simulation?.islandRole?.() === "home";
    const tierCap = home ? simulation?.buildingAvailability?.()?.tier : undefined;
    return tierCap === undefined ? base : { ...base, tierCap };
  };
  const refresh = (): PlayerProgress => {
    if (options.store) progress = options.store.get() ?? progress;
    progress = relief?.synchronize(progress) ?? progress;
    const nation = simulation?.playerNation() ?? options.nation;
    if (homeDailyPoolEnabled())
      commit(refreshQuests(progress, questDayKey(now()), TOOL_WARES, nation, questContext()));
    if (progress.questBook) {
      const questBook = refreshHomeQuests(progress.questBook, playerLevel(), nation ?? "roman");
      if (questBook !== progress.questBook) commit({ ...progress, questBook });
    }
    return progress;
  };
  relief = createPlayerReliefSession({ get: () => progress, refresh, commit, simulation: () => simulation,
    port: options.reliefIslands, initialArchives: options.initialReliefArchives,
    hasArchivedHarbour: options.hasArchivedReliefHarbour, isCurrent: options.isCurrent, localize,
    preparePayment: economy ? quest => economy.prepareReliefQuest
      ? economy.prepareReliefQuest({ questId: quest.id, ware: quest.ware, amount: quest.amount })
      : Promise.resolve("The signed-in server does not support relief payment preparation") : undefined });
  const grantLevelUpCoins = (coins: number, level: number) => {
    if (options.receiveLevelUpCoins) return options.receiveLevelUpCoins(coins);
    if (simulation?.islandRole() === "campaign") return options.queueHomeGrant?.(`level-${level}`, { coins });
    simulation?.receiveHomeGoods({ coins });
  };
  /**
   * Experience and level-ups; a signed-in player's level gems come from the server's claim instead. With
   * experience off the grant adds none (plan §9.2); a fixed or capped level announces no level-up (§9.4).
   */
  const apply = (awarded: ReturnType<typeof awardExperience>) => {
    const result = experienceResultUnderRules(rules(), awarded, progress);
    commit(economy ? { ...result.progress, gems: progress.gems } : result.progress);
    if (!result.levelUps.length) return;
    const level = result.levelUps.at(-1)!.level;
    economy?.claimLevel(level);
    const coins = result.levelUps.reduce((sum, entry) => sum + entry.coins, 0);
    if (coins) grantLevelUpCoins(coins, level);
    if (levelsEarned(rules())) options.onLevelUp?.(result.levelUps);
  };
  const atHome = () => simulation?.islandRole() === "home";
  /** The home island's session keeps the player-wide Monument flag in step; `exceptUid` is left out. */
  const syncHomeMonument = (exceptUid?: number) => {
    if (!simulation || !atHome()) return;
    const next = withHomeMonument(progress, hasCompletedMonument(simulation.buildings(), exceptUid));
    if (next !== progress) commit(next);
  };
  /**
   * Awards a gain with the Monument bonus and returns the experience granted; `completedUid` is the building
   * whose completion is rewarded: a Monument earns no bonus on its own completion, the flag follows after.
   */
  const award = (experience: number, completedUid?: number) => {
    refresh();
    syncHomeMonument(completedUid);
    const gained = experienceEnabled(rules()) ? monumentExperience(experience, hasMonumentBonus(progress)) : 0;
    apply(awardExperience(progress, gained));
    if (completedUid !== undefined) syncHomeMonument();
    return gained;
  };
  /** Rewards off (plan §9.3): quests still complete, but pay neither experience nor goods. */
  const rewardsOn = () => rewardsEnabled(rules());
  const homeQuests = createPlayerHomeQuests({ atHome, award: experience => (rewardsOn() ? award(experience) : 0),
    commit, localize, now, refresh, simulation: () => simulation });
  const dailyQuests = createPlayerDailyQuests({
    apply: result => apply(rewardsOn() ? result : withoutExperience(result, progress)), atHome, rewardsOn, beforeReliefClaim: options.beforeReliefClaim, economy,
    get: () => progress, isCurrent: options.isCurrent, localize, refresh, relief: () => relief!,
    simulation: () => simulation, syncHomeMonument, withReliefClaim: options.withReliefClaim });
  const deliverBattleMessage = (kind: BattleMessage["kind"], experience: number, goods: Record<string, number>) => {
    const result = kind === "colony" ? simulation?.colony?.() : simulation?.adventure?.();
    if (!result || !simulation) return;
    const date = battleResultDate(result);
    if (date === undefined) return;
    // The authoritative mission result already awards commander XP once at the simulation
    // boundary. This presentation path must not mint a second result id.
    const message = createBattleMessage({ kind, experience, goods, island: result.island, date,
      nation: simulation.playerNation(), battle: result.battle, buildings: simulation.buildings() });
    if (progress.messages?.some(existing => existing.id === message.id)) return;
    commit({ ...progress, messages: [message, ...(progress.messages ?? [])] });
  };
  /** The island runs with the applied ranks; its simulation refuses them while talents are off, so none are sent. */
  const syncTalentRanks = () => {
    if (talentsEnabled(rules())) simulation?.setTalentRanks(progress.talents);
  };
  /** Apply / reset (TALENT-01): the applied ranks go to the island's simulation at once. */
  const commitTalents = (result: TalentCommandResult): true | string => {
    if (!result.ok) return localize(result.reason);
    commit(result.progress);
    syncTalentRanks();
    return true;
  };
  const talentCommands = {
    applyTalents: (ranks: TalentRanks) => {
      if (!talentsEnabled(rules())) return localize(TALENTS_OFF);
      const result = commitTalents(applyTalents(refresh(), ranks, playerLevel()));
      if (result === true) homeQuests.recordEvent("talent");
      return result;
    },
    resetTalents: (): true | string | Promise<true | string> => {
      if (!talentsEnabled(rules())) return localize(TALENTS_OFF);
      const local = resetAppliedTalents(refresh());
      if (!economy || !local.ok) return commitTalents(local);
      return economy.resetTalents().then(result => (result.ok
        ? commitTalents({ ok: true, progress: { ...local.progress, gems: result.gems } }) : localize(result.reason)));
    },
    /** After the island adopted other game rules: talents switched back on need the applied ranks again. */
    syncTalentRanks,
    talentModifiers: () => talentModifiers(activeTalents()),
    talents: () => progress.talents
  };
  const archivedProgress = createArchivedPlayerProgress({ current: () => options.store?.get() ?? progress,
    commit, economy, onLevelUp: options.onLevelUp });
  const roadDecorations = createPlayerRoadDecorations({ commit, online: Boolean(economy), refreshWallet: economy?.refreshWallet, get: () => options.store?.get() ?? progress,
    active: () => alive && options.isCurrent?.() !== false, busy: () => inventoryBusy, setBusy: value => { inventoryBusy = value; },
    mutate: options.mutateRoadDecoration, simulation: () => simulation });
  return {
    ...roadDecorations,
    dispose: () => { alive=false;stopGems?.(); inventoryListeners.clear(); simulation = undefined; },
    ...archivedProgress,
    bind: (next: SettlementSimulation) => {
      simulation = next;
      syncHomeMonument();
      homeQuests.bind(progress);
      refresh();
      // Every island the player stands on (and offline catch-up) runs with the applied talents.
      syncTalentRanks();
      void relief!.refreshPorts();
    },
    ...talentCommands,
    /** Scripted mails (TRG9) travel in the carried progress like battle reports; known ids are skipped. */
    deliverScriptMails: (mails: readonly ScriptMail[]) => { const messages = addInboxMails(progress.messages, mails);
      if (messages) commit({ ...progress, messages }); },
    readMessage: (id: string) => {
      const messages = progress.messages;
      if (!messages?.some(message => message.id === id && !message.read)) return;
      commit({ ...progress, messages: messages.map(message => message.id === id ? { ...message, read: true } : message) });
    },
    tutorialEvent: homeQuests.islandEvent,
    tutorialSummary: homeQuests.summary,
    tutorialOpened: () => {
      relief!.prune();
      void relief!.refreshPorts();
      commit({ ...progress, questSeenDay: progress.questDay });
      homeQuests.markSeen(progress);
    },
    skipTutorial: (id: string) => homeQuests.finish(id, true),
    progress: refresh,
    subscribeInventory: (listener: () => void) => {
      inventoryListeners.add(listener);
      return () => { inventoryListeners.delete(listener); };
    },
    reliefQuestStatus: (id: string) => relief!.status(id),
    reliefQuests: () => relief!.statuses(),
    payReliefQuest: (id: string) => relief!.pay(id),
    refreshReliefPorts: () => relief!.refreshPorts(),
    /** One player-wide commander marker; the live soldier remains in its island's military save. */
    commanderOwner: () => (options.store?.get() ?? progress).commander,
    releaseCommander: (id: string) => {
      const stored = options.store?.get() ?? progress;
      if (stored.commander?.id === id) commit({ ...stored, commander: undefined });
    },
    claimCommander: (id: string, homeIslandSeed: number) => {
      if (!Number.isSafeInteger(homeIslandSeed) || homeIslandSeed < 0 || !id) return false;
      const stored = options.store?.get() ?? progress;
      const current = stored.commander;
      if (current && (current.id !== id || current.homeIslandSeed !== homeIslandSeed)) return false;
      if (!current) commit({ ...stored, commander: { homeIslandSeed, id } });
      return true;
    },
    /** The level the island on screen plays with (the account level unless its rules fix or cap it). */
    level: playerLevel,
    /** The level earned from experience: what the server's level claim is about. */
    accountLevel: () => levelForExperience(progress.experience),
    /** Debug only: use normal XP accounting and cap before looking up the target threshold. */
    addDebugLevels: (levels = 10) => {
      const current = levelForExperience(refresh().experience);
      if (!developmentAllowed || !Number.isSafeInteger(levels) || levels <= 0) return current;
      const target = Math.min(MAX_PLAYER_LEVEL, current + levels);
      // Exact thresholds: the Monument bonus does not apply to development level jumps.
      if (target > current) apply(awardExperience(progress, Math.max(0, LEVEL_THRESHOLDS[target - 1]! - progress.experience)));
      return levelForExperience(progress.experience);
    },
    produced: (ware: string) => {
      commit(recordProduction(refresh(), ware));
      homeQuests.islandEvent(`produce:${ware}`);
      if ((TOOL_WARES as ReadonlySet<string>).has(ware)) homeQuests.islandEvent("tools");
    },
    buildingCompleted: (building: SettlementBuilding) => {
      award(buildingExperience(getBuildingDefinition(building.typeId).gridFootprint), building.uid);
    },
    /** A demolished or destroyed home building may have been the Monument: future bonuses stop. */
    buildingRemoved: () => syncHomeMonument(),
    /** A completed home Monument: +25 % experience and the harbour defenders of new starts. */
    monumentBonusActive: () => hasMonumentBonus(options.store?.get() ?? progress),
    /** A small experience reward at the current level; returns it for the victory popup. */
    colonyConquered: (difficulty: ColonyDifficulty) => {
      refresh();
      const experience = award(colonyConquestReward(difficulty, playerLevel()));
      deliverBattleMessage("colony", experience, {});
      return experience;
    },
    /** Experience at the current level now; the coins and wares sail home on the reward ship. */
    adventureWon: (island: AdventureIsland) => {
      const talents = talentModifiers(activeTalents());
      refresh();
      const reward = adventureRewardFor(island, playerLevel());
      const experience = award(Math.round(reward.experience * (1 + talents.adventureExperience)));
      const goods = adventureRewardGoods(island, talents.adventureLoot);
      deliverBattleMessage("adventure", experience, goods);
      return { experience, goods };
    },
    /**
     * Delivery quests pay from this island's storages; true or the reason it failed. A signed-in player's claim
     * waits for the server's ledger (owner 2026-10-22); quest progress itself stays local.
     */
    completeQuest: (id: string): true | string | Promise<true | string> =>
      isHomeTutorialQuest(id) ? homeQuests.finish(id) : dailyQuests.complete(id),
    /**
     * Gem shop: pays gems and stores the goods at home; true or the reason it was refused. A signed-in player's
     * purchase is the server's (it checks room first, then the server debits and names the goods).
     */
    buyGemOffer: (offerId: string): true | string | Promise<true | string> => {
      if (inventoryBusy) return localize("Another inventory action is in progress");
      if (simulation?.islandRole() === "campaign") return localize(GEM_SHOP_CAMPAIGN_CLOSED);
      const personal = playerItemForOfferId(offerId);
      const owned = personal && isRoadDecorationItemId(personal.id) ? options.roadDecorationOwnedUnits?.(personal.id) ?? 0 : 0;
      const purchase = purchaseGemOffer(refresh(), offerId, owned);
      if (!purchase.ok) return localize(purchase.reason);
      const itemPurchase = Boolean(playerItemForOfferId(offerId));
      if (!economy) {
        if (!itemPurchase && !simulation?.deliverHome(purchase.goods)) return localize(NO_ROOM);
        commit(purchase.progress);
        return true;
      }
      if (!itemPurchase && !simulation?.canDeliverHome(purchase.goods)) return localize(NO_ROOM);
      inventoryBusy=true;
      return economy.buyGemOffer(offerId).then(result => {
        if (!result.ok) return localize(result.reason);
        commit({ ...progress, gems: result.gems, inventory: result.items ?? progress.inventory });
        if (itemPurchase) return true;
        return simulation?.deliverHome(result.goods) ? true : localize(NO_ROOM);
      }).finally(()=>{ inventoryBusy=false; roadDecorations.claimPendingRoadDecorationReturns(); });
    },
    hasNationItem: () => hasChooseNation(refresh()),
    changeNation: async (current: WorkerNation, next: WorkerNation): Promise<true | string> => {
      if (current === next) return true;
      if (inventoryBusy || !alive || options.isCurrent?.() === false)
        return localize("Another inventory action is in progress");
      inventoryBusy=true;
      try {
      if (!hasChooseNation(refresh())) return localize("A Choose nation item is required");
      if (economy) {
        if (!economy.changeNation) return localize("Nation changes are unavailable");
        const result = await economy.changeNation(current, next);
        if (!result.ok) return localize(result.reason);
        commit({ ...progress, inventory: result.items });
        return true;
      }
      const changed = consumeChooseNation(refresh(), current, next);
      if (!changed) return localize("A Choose nation item is required");
      commit(changed);
      return true;
      } finally { inventoryBusy=false; roadDecorations.claimPendingRoadDecorationReturns(); }
    },
    useCommanderRecovery:createPlayerCommanderRecovery({ active:()=>alive && options.isCurrent?.() !== false,
      busy:()=>inventoryBusy,commit,get:()=>progress,localize,online:Boolean(economy),
      recover:options.recoverCommanderWithItem,refresh,setBusy:busy=>{ inventoryBusy=busy;
        if (!busy) roadDecorations.claimPendingRoadDecorationReturns(); },simulation:()=>simulation }),
    /** Development tool: local gems for guests; a signed-in player's gems are only the server's. */
    /** A won campaign run's victory reward (C12): credits gems/XP/decorations, answers the reward ship's load. */
    claimCampaignVictory: createPlayerCampaignVictory({ commit, economy, get: refresh,
      grantExperience: experience => apply(awardExperience(progress, experience)), localize, now, rewardsOn,
      walletOnly: () => simulation?.gameRules?.()?.homeIsland === false }).claim,
    /** XP a server-confirmed declared home reward paid (TRG7); no Monument bonus: the ledger names the amount. */
    grantRewardExperience: (experience: number) => apply(awardExperience(progress, experience)),
    grantGems: (gems: number) => {
      if (!developmentAllowed || economy) return false;
      commit(grantGems(refresh(), gems));
      return true;
    },
    /** A signed-in player's levels reached offline or before phase B are paid by the server once. */
    claimServerLevel: () => {
      if (experienceEnabled(rules())) economy?.claimLevel(levelForExperience(refresh().experience));
    }
  };
};
export type PlayerSession = ReturnType<typeof createPlayerSession>;
