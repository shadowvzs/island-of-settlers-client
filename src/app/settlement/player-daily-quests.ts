import { questRewardMaterialKind } from "@shared/catalog/balance";

import { hasMonumentBonus } from "../../shared/progression/monument-bonus";
import { type awardExperience, completeQuest, type PlayerProgress } from "../../shared/progression/player-progress";
import { isReliefQuest } from "../../shared/progression/relief-quests";
import { talentModifiers } from "../../shared/progression/talents";
import { materializeDailyQuest } from "../../shared/quests/daily-quest-book";
import { HOME_QUEST_BOOK } from "../../shared/quests/home-quest-book";
import type { SettlementSimulation } from "../../shared/settlement/settlement-simulation";
import type { ServerEconomy } from "../cloud/server-economy";
import { createPlayerQuestClaimProblem } from "./player-quest-claim-problem";
import type { createPlayerReliefSession } from "./player-relief-session";

const CLAIM_REFUSED = "The server did not confirm this claim: ";

interface PlayerDailyQuestOptions {
  /** Commits the experience result (level-ups included). */
  apply: (result: ReturnType<typeof awardExperience>) => void;
  atHome: () => boolean;
  beforeReliefClaim?: () => Promise<true | string>;
  economy?: ServerEconomy;
  get: () => PlayerProgress;
  isCurrent?: () => boolean;
  localize: (text: string) => string;
  refresh: () => PlayerProgress;
  relief: () => ReturnType<typeof createPlayerReliefSession>;
  /** Rewards are on under the island's rules; off: a claim completes the quest without goods or a server claim. */
  rewardsOn: () => boolean;
  simulation: () => SettlementSimulation | undefined;
  syncHomeMonument: () => void;
  withReliefClaim?: (id: string, claim: () => Promise<true | string>) => Promise<true | string>;
}

/**
 * The global daily pool's claims of the player session (QU5): the home book switches the pool on; a claim is the
 * island's recorded `claimQuest` (cost from the materialized book quest, reward goods home), and a signed-in
 * player's claim waits for the server ledger, which names the goods.
 */
export const createPlayerDailyQuests = (options: PlayerDailyQuestOptions) => {
  const { atHome, economy, get, localize, refresh, relief, simulation } = options;
  const claimProblem = createPlayerQuestClaimProblem({ atHome, localize, refresh,
    reliefProblem: id => relief().claimProblem(id), stored: ware => simulation()?.resourceTotal(ware) ?? 0 });
  /** Pays quests through the journalled island claim; online `confirmed` goods are the server's ledger credit. */
  const pay = (id: string, confirmed?: Readonly<Record<string, number>>): true | string => {
    const problem = claimProblem(id);
    if (problem) return problem;
    const progress = get();
    const quest = progress.quests.find(entry => entry.id === id)!;
    options.syncHomeMonument();
    const result = completeQuest(get(), id, hasMonumentBonus(get()))!;
    const book = materializeDailyQuest(quest, HOME_QUEST_BOOK.dailyResetUtcMinutes);
    const cost = isReliefQuest(progress.relief, id) ? {} :
      Object.fromEntries(book.cost.map(line => [line.ware, line.amount]));
    const goods = options.rewardsOn() ? confirmed ?? result.goods : {};
    const recorded = simulation()!.claimQuest({ bookId: HOME_QUEST_BOOK.id, cost, goods,
      occurrence: quest.id, questId: book.id, skip: false });
    if (recorded !== true) return localize(recorded);
    options.apply(result);
    return true;
  };
  const reliefSaved = async (): Promise<true | string> => {
    if (!options.beforeReliefClaim) return localize("Save the completed relief voyage before claiming its reward");
    const saved = await options.beforeReliefClaim();
    if (saved !== true) return localize(saved);
    if (options.isCurrent?.() === false) return localize("The island changed before claiming the relief reward");
    return true;
  };
  /** A signed-in player's quest claim: the server records its reward once and names the goods. */
  const claimServer = async (server: ServerEconomy, id: string) => {
    const reliefClaim = isReliefQuest(get().relief, id);
    if (reliefClaim) {
      const saved = await reliefSaved();
      if (saved !== true) return saved;
    }
    const quest = get().quests.find(entry => entry.id === id)!;
    const claim = async (): Promise<true | string> => {
      const result = await server.claimQuest({ bonus: talentModifiers(get().talents).questRewards,
        material: questRewardMaterialKind(quest.reward), questId: id, ...(reliefClaim ? { relief: true } : {}) });
      return typeof result === "string" ? localize(`${CLAIM_REFUSED}${result}`) : pay(id, result);
    };
    return reliefClaim && options.withReliefClaim ? options.withReliefClaim(id, claim) : claim();
  };
  /** Delivery quests pay from this island's storages; true, the reason it failed, or the server's answer. */
  const complete = (id: string): true | string | Promise<true | string> => {
    refresh();
    if (relief().status(id)?.stage === "awaiting-aid") return relief().pay(id);
    const problem = claimProblem(id);
    if (problem) return problem;
    return economy && options.rewardsOn() ? claimServer(economy, id) : pay(id);
  };
  return { complete };
};
