import type { CampaignAttemptEnd } from "../../../../island-of-settlers-shared/src/campaign/campaign-attempts";
import type { PublishedCampaign } from "../../../../island-of-settlers-shared/src/campaign/campaign-published";
import { CAMPAIGN_VICTORY_PENDING } from "../../../../island-of-settlers-shared/src/campaign/campaign-victory-reward";
import { playerItemForOfferId } from "../../../../island-of-settlers-shared/src/player-inventory";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import { type PlayerInventory } from "../../shared/progression/player-inventory";
import type { PendingHomeClaim } from "../../shared/settlement/settlement-home-claims";
import { PREFERENCE_FAMILIES } from "../preferences/keys";
import { isTransientFailure, SaveApiError } from "../save-store/save-api-client";
import type { SaveTimers } from "../save-store/save-coordinator";
import type {
  AdventureClaimBody, CampaignAttemptStartAnswer, CampaignEndReport, CampaignProgressAnswer, CampaignVictoryAnswer,
  EconomyClient, LevelClaim, ReliefPreparationBody
} from "./economy-client";
import { type DailyQuestClaim, dailyQuestClaimBody, homeRewardClaimBody } from "./quest-claim-body";

/** Gems of a signed-in player are the server's: the player session asks it and applies the answer. */
export interface ServerEconomy {
  refreshWallet?(): Promise<{ gems: number; items?: PlayerInventory }>;
  /** Pays every level up to `level` (once each); the new gems arrive through `onGems`. */
  claimLevel(level: number): void;
  /** A won adventure's loot: the goods the server's ledger recorded (empty on a repeat), else the refusal. */
  claimAdventure(claim: AdventureClaimBody): Promise<Record<string, number> | string>;
  /** A finished daily quest's reward: the goods the server's ledger recorded (empty on a repeat), else the refusal. */
  claimQuest(claim: DailyQuestClaim): Promise<Record<string, number> | string>;
  /**
   * A declared home reward of the island's script (TRG7): the goods and XP the ledger paid (the stored payout on a
   * repeat), else the refusal. Transient failures throw, so the caller retries the same occurrence.
   */
  claimHomeReward?(pending: PendingHomeClaim): Promise<{ goods: Record<string, number>; xp: number } | string>;
  /** A won attempt's victory reward (C12): the server's answer, else the refusal; transient failures throw. */
  claimCampaignVictory?(attemptId: string): Promise<CampaignVictoryAnswer | string>;
  /**
   * A campaign attempt's end (C9a), a victory with the named exit the map script chose (BR2): the stored path facts
   * (BR4), else the refusal; transient failures throw.
   */
  endCampaignAttempt?(attemptId: string, outcome: CampaignAttemptEnd, exit?: string):
    Promise<CampaignEndReport | string>;
  /** A published campaign map's file bytes, null when it is not published; throws when the server has no answer. */
  campaignMapFile?(mapId: string): Promise<Uint8Array | null>;
  /** The campaigns players may start now, from the server's storage; throws when the server has no answer. */
  publishedCampaigns?(): Promise<PublishedCampaign[]>;
  /** The account's lock state of a ready campaign's maps (C8); throws when the server has no answer. */
  campaignProgress?(campaignId: string): Promise<CampaignProgressAnswer>;
  /** A new campaign attempt (C8): its id and the map's start status, else the refusal; transient failures throw. */
  startCampaignAttempt?(campaignId: string, mapId: string): Promise<CampaignAttemptStartAnswer | string>;
  /** Registers a relief identity without crediting rewards; old adapters cannot pay new relief. */
  prepareReliefQuest?(claim: ReliefPreparationBody): Promise<true | string>;
  buyGemOffer(offerId: string): Promise<{ gems: number; goods: Record<string, number>; items?: PlayerInventory; ok: true } |
    { ok: false; reason: string }>;
  changeNation?(current: WorkerNation, next: WorkerNation): Promise<
    { ok: true; items: PlayerInventory; nation: WorkerNation } | { ok: false; reason: string }>;
  readonly startInventory?: PlayerInventory;
  readonly startNation?: WorkerNation;
  onGems(listener: (gems: number) => void): () => void;
  /** A level claim reached the server: its verified-save cap tells whether a later re-claim can pay more. */
  onLevelClaim(listener: (claim: LevelClaim) => void): () => void;
  resetTalents(): Promise<{ gems: number; ok: true } | { ok: false; reason: string }>;
  /** The wallet's gems when the session started. */
  readonly startGems: number;
}

interface ServerEconomyOptions {
  client: EconomyClient;
  /** UTC ms of a claim (tests inject a fixed clock). */
  now?: () => number;
  /** A key unique per purchase (retries of one purchase reuse it). */
  newKey?: () => string;
  startGems: number;
  startInventory?: PlayerInventory;
  startNation?: WorkerNation;
  pendingStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">;
  scope?: string;
  /** The save slot on screen, named by gem purchases (the server's campaign-map check). */
  slotId?: string;
  timers?: SaveTimers;
}

const FIRST_RETRY_MS = 2000;
const MAX_RETRY_MS = 60_000;
/** A victory claim waits for the server's replay of the run: asked again this often, this many times at most. */
const VICTORY_RETRY_MS = 3000;
const VICTORY_CLAIM_ATTEMPTS = 6;

const isVictoryPending = (error: unknown) => error instanceof SaveApiError && error.code === CAMPAIGN_VICTORY_PENDING;
const DEFAULT_TIMERS: SaveTimers = { clear: handle => clearTimeout(handle), set: (run, ms) => setTimeout(run, ms) };

/**
 * The player session's server economy: purchases and resets wait for the server; reward claims queue and retry
 * with backoff while offline (each is idempotent on the server, so a retry never pays twice).
 */
export const createServerEconomy = ({
  client, newKey = () => crypto.randomUUID(), now = Date.now, pendingStorage, scope = "player", slotId, startGems,
  startInventory, startNation, timers = DEFAULT_TIMERS
}: ServerEconomyOptions): ServerEconomy => {
  const nationRequestSlot = `${PREFERENCE_FAMILIES.inventoryRequest.prefix}${scope}:nation`;
  const storedNationRequest = pendingStorage?.getItem(nationRequestSlot);
  if (storedNationRequest && startNation) {
    try {
      const request = JSON.parse(storedNationRequest) as { body: string };
      const body = JSON.parse(request.body) as { nation?: string };
      if (body.nation === startNation) pendingStorage?.removeItem(nationRequestSlot);
    } catch { pendingStorage?.removeItem(nationRequestSlot); }
  }
  /** The last pending answer throws: the run end keeps the player on the map ("try again in a moment"). */
  const claimVerifiedVictory = async (attemptId: string) => {
    for (let attempt = 1; ; attempt++) {
      try {
        return await client.claimCampaignVictory(attemptId);
      } catch (error) {
        if (!isVictoryPending(error) || attempt >= VICTORY_CLAIM_ATTEMPTS) throw error;
        await new Promise(resolve => timers.set(() => resolve(undefined), VICTORY_RETRY_MS));
      }
    }
  };
  const retryPending = async <T>(run: () => Promise<T>): Promise<T> => {
    try { return await run(); }
    catch (error) {
      if (!isTransientFailure(error)) throw error;
      // A lost response can follow a successful commit. Reuse its exact key and body once.
      return run();
    }
  };
  const pendingKey = (operation: string, body: string) => {
    const slot = `${PREFERENCE_FAMILIES.inventoryRequest.prefix}${scope}:${operation}`;
    const saved = pendingStorage?.getItem(slot);
    if (saved) {
      try {
        const value = JSON.parse(saved) as { body: string; key: string };
        if (value.body === body && typeof value.key === "string") return { key: value.key, slot };
        throw new Error("Finish the previous inventory request before choosing another nation");
      } catch (error) {
        if (error instanceof SyntaxError) pendingStorage?.removeItem(slot);
        else throw error;
      }
    }
    const key = newKey();
    pendingStorage?.setItem(slot, JSON.stringify({ body, key }));
    return { key, slot };
  };
  const listeners = new Set<(gems: number) => void>(), claimListeners = new Set<(claim: LevelClaim) => void>();
  const claims: (() => Promise<LevelClaim>)[] = [];
  let running = false, delay = FIRST_RETRY_MS;
  const publish = (gems: number) => { for (const listener of listeners) listener(gems); };
  const drain = async () => {
    if (running) return;
    running = true;
    while (claims.length) {
      try {
        const claim = await claims[0]!();
        publish(claim.wallet.gems);
        for (const listener of claimListeners) listener(claim);
        delay = FIRST_RETRY_MS;
      } catch (error) {
        if (isTransientFailure(error)) {
          timers.set(() => void drain(), delay);
          delay = Math.min(MAX_RETRY_MS, delay * 2);
          break;
        }
        console.warn("[economy] claim refused:", error);
      }
      claims.shift();
    }
    running = false;
  };
  const queue = (claim: () => Promise<LevelClaim>) => {
    claims.push(claim);
    void drain();
  };
  return {
    refreshWallet: () => client.wallet(),
    buyGemOffer: async offerId => {
      const pending = playerItemForOfferId(offerId) ? pendingKey(offerId === "choose-nation" ? "purchase" : `purchase:${offerId}`, offerId) : null;
      const result = pending
        ? await retryPending(() => client.buyGemOffer(offerId, pending.key, slotId))
        : await client.buyGemOffer(offerId, newKey(), slotId);
      if (pending) pendingStorage?.removeItem(pending.slot);
      if (!result.ok) return result;
      publish(result.wallet.gems);
      return { gems: result.wallet.gems, goods: result.goods, items: result.wallet.items, ok: true };
    },
    changeNation: async (currentNation, nation) => {
      const pending = pendingKey("nation", JSON.stringify({ currentNation, nation }));
      let result: Awaited<ReturnType<typeof client.changeNation>>;
      try { result = await retryPending(() => client.changeNation(currentNation, nation, pending.key)); }
      catch (error) {
        if (isTransientFailure(error)) throw new Error("Nation change is awaiting server confirmation", { cause: error });
        throw error;
      }
      pendingStorage?.removeItem(pending.slot);
      if (!result.ok) return result;
      publish(result.wallet.gems);
      return { items: result.wallet.items ?? {}, nation: result.nation, ok: true };
    },
    startInventory,
    startNation,
    claimAdventure: async claim => {
      const result = await client.claimAdventure(claim);
      return result.ok ? result.goods : result.reason;
    },
    claimLevel: level => queue(() => client.claimLevels(level)),
    claimCampaignVictory: async attemptId => {
      const result = await claimVerifiedVictory(attemptId);
      if (!result.ok) return result.reason;
      publish(result.wallet.gems);
      const { ok: _ok, ...answer } = result;
      return answer;
    },
    endCampaignAttempt: async (attemptId, outcome, exit) => {
      const result = await client.endCampaignAttempt(attemptId, outcome, exit);
      if (!result.ok) return result.reason;
      return { campaignCompleted: result.campaignCompleted, exit: result.exit, pathExit: result.pathExit };
    },
    campaignMapFile: client.campaignMapFile,
    campaignProgress: client.campaignProgress,
    publishedCampaigns: client.publishedCampaigns,
    startCampaignAttempt: async (campaignId, mapId) => {
      const result = await client.startCampaignAttempt(campaignId, mapId);
      return result.ok ? { attemptId: result.attemptId, mapStatus: result.mapStatus } : result.reason;
    },
    claimQuest: async claim => {
      const result = await client.claimQuest(dailyQuestClaimBody(claim, now()));
      if (!result.ok) return result.reason;
      publish(result.wallet.gems);
      return result.goods;
    },
    claimHomeReward: async pending => {
      const result = await client.claimQuest(homeRewardClaimBody(pending, now(), slotId));
      if (!result.ok) return result.reason;
      publish(result.wallet.gems);
      return { goods: result.goods, xp: result.xp };
    },
    prepareReliefQuest: async claim => {
      const result = await client.prepareReliefQuest(claim);
      return result.ok ? true : result.reason;
    },
    onGems: listener => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    onLevelClaim: listener => {
      claimListeners.add(listener);
      return () => claimListeners.delete(listener);
    },
    resetTalents: async () => {
      const result = await client.resetTalents(newKey());
      if (!result.ok) return result;
      publish(result.wallet.gems);
      return { gems: result.wallet.gems, ok: true };
    },
    startGems
  };
};
