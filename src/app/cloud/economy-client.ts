import type {
  CampaignAttemptEnd, CampaignAttemptStatus
} from "../../../../island-of-settlers-shared/src/campaign/campaign-attempts";
import type {
  CampaignEdgeState, CampaignNodeState
} from "../../../../island-of-settlers-shared/src/campaign/campaign-graph";
import type {
  PublishedCampaignsAnswer
} from "../../../../island-of-settlers-shared/src/campaign/campaign-published";
import type {
  CampaignVictoryKind, CampaignVictoryPayout
} from "../../../../island-of-settlers-shared/src/campaign/campaign-victory-reward";
import type { Goods } from "../../../../island-of-settlers-shared/src/goods";
import type { CampaignMapStatus } from "../../../../island-of-settlers-shared/src/script/engine/home-rewards";
import type { WorkerNation } from "../../render-common/workers/worker-unit";
import type { PlayerInventory } from "../../shared/progression/player-inventory";
import type { MarketTrade } from "../../shared/trade/market";
import type { StockGoods, StockMoveBody, StockMoveResult } from "../../shared/trade/stock-move";
import {
  createApiTransport, readApiBytes, readApiError, type SaveApiOptions
} from "../save-store/save-api-client";
import type { QuestClaimBody } from "./quest-claim-body";

/** The wallet fields the game uses; the Market also reads the free goods and delivery state. */
export interface WalletView {
  blessingScrolls?: number;
  delivery?: string;
  gems: number;
  items?: PlayerInventory;
  chosenNation?: WorkerNation;
  inventory?: StockGoods;
  /** The subset of `inventory` acquired from accepted Market trades. */
  received?: StockGoods;
  revision?: number;
}

export type EconomyRefusable<T> = ({ ok: true } & T) | { ok: false; reason: string };

export interface LevelClaim {
  claimedLevel: number;
  level: number;
  paid: { coins: number; gems: number; level: number }[];
  verifiedLevel: number;
  wallet: WalletView;
}

/** A won adventure's loot claim: the offer's id and seed name it once; `bonus` is the loot talent's share. */
export interface AdventureClaimBody { adventureId: number; bonus: number; difficulty: string; seed: number }
/** What the unified claim route paid: goods (coins included) go home, gems to the wallet, XP to progress. */
export interface QuestClaimAnswer {
  coins: number;
  gems: number;
  goods: Goods;
  ref: string;
  /** The ledger already held this occurrence: nothing new was credited; the fields repeat the stored payout. */
  repeated: boolean;
  /** Reward lines the route records but does not deliver yet (decorations, units, unlocks). */
  unpaid: unknown[];
  wallet: WalletView;
  xp: number;
}
/** `POST /v1/campaign/attempts`: the server-issued attempt id and the map's status at its start. */
export interface CampaignAttemptStartAnswer { attemptId: string; mapStatus: CampaignAttemptStatus }
/** `POST /v1/campaign/attempts/:id/reward` (C12): the won attempt's victory reward, paid once. */
export interface CampaignVictoryAnswer {
  attemptId: string;
  kind: CampaignVictoryKind;
  payout: CampaignVictoryPayout;
  repeated: boolean;
  unpaidDecorations: Record<string, number>;
  wallet: WalletView;
}
/** One map of `GET /v1/campaign/progress` (BR1): the script-facing status and the display state. */
export interface CampaignProgressMap {
  /** The exit of the map's first victory (the account's path); only on a completed map. */
  exit?: string;
  mapId: string;
  /** `closed`: the map lies on a branch the account's recorded exits can no longer open. */
  node: CampaignNodeState;
  status: CampaignMapStatus;
}
/**
 * `GET /v1/campaign/progress`: every map of a ready campaign in `mapIds` order with the account's status, the state
 * of every edge (a linear campaign's derived edges are `linear-<n>`) and whether an ending was reached (BR1).
 */
export interface CampaignProgressAnswer {
  completed: boolean;
  edges: { id: string; state: CampaignEdgeState }[];
  maps: CampaignProgressMap[];
}
/**
 * `POST /v1/campaign/attempts/:id/end`: on a victory `exit` is the exit stored for the attempt and `pathExit` the
 * exit of the map's first victory (BR1); a replay through another exit keeps the path.
 */
export interface CampaignAttemptEndAnswer extends CampaignEndReport {
  attemptId: string;
  mapStatus: string;
  outcome: CampaignAttemptEnd;
}
/** What the session keeps of a stored attempt end: the path facts shown after the run (BR4). */
export interface CampaignEndReport {
  /** A taken edge of the account's path ends the campaign. */
  campaignCompleted: boolean;
  exit?: string;
  pathExit?: string;
}
export interface ReliefPreparationBody { amount: number; questId: string; ware: string }

/** One server Market order (docs/server/economy.md); amounts are the shared ware allowlist's integers. */
export type TradeView = MarketTrade;
export interface TradePage { nextCursor: string | null; trades: TradeView[] }
export interface TradeCreateBody {
  idempotencyKey: string;
  offered: Goods;
  recipientId?: string;
  requested: Goods;
  ttlSeconds: number;
}

/** A stock refusal: a rule/revision conflict, or another device took the session lease (both HTTP 409). */
export type StockMoveAnswer = ({ ok: true } & StockMoveResult) |
  { message: string; ok: false; reason: "conflict" | "lease-lost" };

export interface EconomyClientOptions extends SaveApiOptions {
  /** The live session lease a stock move names: the API writes the save, like an upload. */
  leaseId?: () => string | undefined;
}

const CONFLICT = 409;

/**
 * The server economy of a signed-in player (phase B, docs/server/economy.md): the wallet, reward claims, the gem
 * shop, the talent reset, the player Market's typed trade calls and the island stock bridge. Refusals of the rules
 * (409: not enough gems, level gate, stale stock revision, lost lease) come back as reasons; everything else throws
 * (SaveApiError), so callers can retry transient failures.
 */
export const createEconomyClient = (options: EconomyClientOptions) => {
  const { read, send } = createApiTransport(options);
  const post = async <T>(path: string, body: unknown): Promise<EconomyRefusable<T>> => {
    const response = await send("POST", path, { body });
    if (response.status === CONFLICT) return { ok: false, reason: (await readApiError(response)).message };
    if (!response.ok) throw await readApiError(response);
    return { ok: true, ...(await response.json() as T) };
  };
  const stock = async (path: string, body: StockMoveBody): Promise<StockMoveAnswer> => {
    const response = await send("POST", path, { body, lease: options.leaseId?.() });
    if (response.status === CONFLICT) {
      const { code, message } = await response.json().catch(() => ({})) as { code?: string; message?: string };
      return { message: message ?? "The server refused the stock move",
        ok: false, reason: code === "SESSION_LEASE_LOST" ? "lease-lost" : "conflict" };
    }
    if (!response.ok) throw await readApiError(response);
    return { ok: true, ...(await response.json() as StockMoveResult) };
  };
  const required = async <T>(path: string, body: unknown) => {
    const result = await post<T>(path, body);
    if (!result.ok) throw new Error(result.reason);
    return result;
  };
  const tradePath = (id: string, action: "accept" | "cancel") =>
    `/v1/economy/trades/${encodeURIComponent(id)}/${action}`;
  return {
    /** `slotId` names the slot on screen: the server refuses while it is on a campaign map (C3). */
    buyGemOffer: (offerId: string, idempotencyKey: string, slotId?: string) =>
      post<{ goods: Record<string, number>; wallet: WalletView }>("/v1/economy/gem-shop/purchases",
        { idempotencyKey, offerId, ...(slotId ? { slotId } : {}) }),
    /** The stored map file of a published campaign map; null when the map is not published (any more). */
    campaignMapFile: async (mapId: string) =>
      readApiBytes(await send("GET", `/v1/campaigns/maps/${encodeURIComponent(mapId)}/file`)),
    /** C8: the account's lock state of every map of one ready campaign. */
    campaignProgress: (campaignId: string) =>
      read<CampaignProgressAnswer>(`/v1/campaign/progress?campaignId=${encodeURIComponent(campaignId)}`),
    changeNation: (currentNation: WorkerNation, nation: WorkerNation, idempotencyKey: string) =>
      post<{ changed: boolean; nation: WorkerNation; wallet: WalletView }>("/v1/economy/items/choose-nation",
        { currentNation, nation, idempotencyKey }),
    /** A won adventure's loot (D4 follow-up 2): the server's goods, empty when it was already paid. */
    claimAdventure: (claim: AdventureClaimBody) =>
      post<{ goods: Goods; wallet: WalletView }>("/v1/economy/rewards/adventures", claim),
    claimLevels: (level: number) => required<LevelClaim>("/v1/economy/rewards/levels", { level }),
    /**
     * How a campaign attempt ended (C9a): a victory completes the map for the account. `exit` (BR2) is the named
     * exit of a victory and is sent only then (the server refuses an exit on another end), so a run through the
     * implicit exit keeps the old request body. On a victory the server answers the exit it stored for the attempt
     * (an undeclared one is stored as `victory`) and `pathExit`, the exit of the map's first victory.
     */
    endCampaignAttempt: (attemptId: string, outcome: CampaignAttemptEnd, exit?: string) =>
      post<CampaignAttemptEndAnswer>(
        `/v1/campaign/attempts/${encodeURIComponent(attemptId)}/end`,
        exit === undefined || outcome !== "victory" ? { outcome } : { exit, outcome }),
    /** C12: the won attempt's victory reward (a repeat answers the stored payout, `repeated`). */
    claimCampaignVictory: (attemptId: string) =>
      post<CampaignVictoryAnswer>(`/v1/campaign/attempts/${encodeURIComponent(attemptId)}/reward`, {}),
    /** C8: starts an attempt on an available or completed map; the open attempt (if any) ends as given up. */
    startCampaignAttempt: (campaignId: string, mapId: string) =>
      post<CampaignAttemptStartAnswer>("/v1/campaign/attempts", { campaignId, mapId }),
    /** A v2 quest or declared reward claim (trigger design §9.4); a refusal comes back as its reason. */
    claimQuest: (claim: QuestClaimBody) => post<QuestClaimAnswer>("/v1/economy/rewards/quests", claim),
    /** The ready campaigns inside their availability window with their playable maps (server storage). */
    publishedCampaigns: async () => (await read<PublishedCampaignsAnswer>("/v1/campaigns")).campaigns,
    prepareReliefQuest: (body: ReliefPreparationBody) =>
      post<{ prepared: true; questId: string }>("/v1/economy/relief/prepare", body),
    /** Moves island goods into the server wallet; the answer names the new saved revision and storage totals. */
    depositStock: (body: StockMoveBody) => stock("/v1/economy/stock/deposits", body),
    /** The Market's available and own orders, newest first; `nextCursor` pages older ones. */
    listTrades: (page: { after?: string; limit?: number } = {}) => {
      const query = new URLSearchParams();
      if (page.after !== undefined) query.set("after", page.after);
      if (page.limit !== undefined) query.set("limit", String(page.limit));
      const search = query.toString();
      return read<TradePage>(`/v1/economy/trades${search ? `?${search}` : ""}`);
    },
    /** Offers wallet goods in escrow; a refused offer names its reason (limit, blocked, missing goods). */
    createTrade: (body: TradeCreateBody) => post<{ trade: TradeView }>("/v1/economy/trades", body),
    /** Accepts one whole order; a stale/expired/reused order is a refusal, never a second exchange. */
    acceptTrade: (id: string, idempotencyKey: string) =>
      post<{ status: "accepted"; tradeId: string }>(tradePath(id, "accept"), { idempotencyKey }),
    cancelTrade: (id: string, idempotencyKey: string) =>
      post<{ status: "cancelled"; tradeId: string }>(tradePath(id, "cancel"), { idempotencyKey }),
    resetTalents: (idempotencyKey: string) =>
      post<{ wallet: WalletView }>("/v1/economy/talents/reset", { idempotencyKey }),
    /** Moves wallet goods back into the saved home island; the answer names the new saved revision and storage. */
    withdrawStock: (body: StockMoveBody) => stock("/v1/economy/stock/withdrawals", body),
    wallet: () => read<WalletView>("/v1/economy/wallet")
  };
};

export type EconomyClient = ReturnType<typeof createEconomyClient>;
