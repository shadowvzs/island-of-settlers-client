import type {
  AdventureRow, CampaignRunRow, ColonyRow, EvacuationRow, GameRows, IslandRow, PlayerRow, SessionRow
} from "../../shared/settlement/game-save-rows";
import type { TradeHistoryRow, TradeOfferRow } from "../../shared/trade/trade-rows";

/**
 * Save slot of play without an account (tools, ?skipLogin=1) and of a game saved before accounts
 * (database version 4 moves an untagged game here).
 */
export const GUEST_SLOT = "guest";
/** Working slot of browser-only online play without a home island (plan §5.6): never shares rows with `guest`. */
export const GUEST_STORY_SLOT = "guest.story";
/** Working slots of offline mode, with and without a home island (plan §5.6); never synced, never uploaded. */
export const OFFLINE_HOME_SLOT = "offline.home";
export const OFFLINE_STORY_SLOT = "offline.story";
const OFFLINE_SLOT_PREFIX = "offline.";
/** True for every slot of offline mode (working slots and later Save/Load slots `offline.home.1` …). */
export const isOfflineSlot = (slotId: string) => slotId.startsWith(OFFLINE_SLOT_PREFIX);
/** Boot value holding a game to open on the next start (Import game and island travel reload with it). */
export const GAME_STARTUP_SLOT = "startup";
/** Boot value of a no-home slot's player progress between runs (GS3a); a slot copy carries it (SAVE-SLOTS). */
export const STORY_PROGRESS_KEY = "story-progress";
/** Boot value describing a Save/Load slot (name, time, what it shows); the slot list reads only these. */
export const SLOT_META_KEY = "slot-meta";
/** Row id of the player and session tables before version 4 (one game per browser). */
export const LEGACY_ROW_ID = "local";

type Slotted<Row> = Row & { slotId: string };
type SlotKeyed<Row extends { id: string }> = Omit<Row, "id"> & { id: string };

/**
 * One account's game as stored rows: islands, colonies and adventures carry the slot id (the account id, or
 * the guest slot) in their composite key; the player and session rows are keyed by it.
 */
export interface SlotRows {
  adventures: Slotted<AdventureRow>[];
  /** Keyed [slotId, run key]; database version 11 (C2). */
  campaignRuns: Slotted<CampaignRunRow>[];
  colonies: Slotted<ColonyRow>[];
  /** Keyed [slotId, expeditionId] (the colony's id, as in the colonies table); database version 5. */
  evacuations: Slotted<EvacuationRow>[];
  islands: Slotted<IslandRow>[];
  player?: SlotKeyed<PlayerRow>;
  session: SlotKeyed<SessionRow>;
  /** Keyed [slotId, islandId, id]; database version 6 (TRADE-01; version 7 dropped the trade mail table). */
  tradeHistory: Slotted<TradeHistoryRow>[];
  tradeOffers: Slotted<TradeOfferRow>[];
}

export const toSlotRows = (slotId: string, rows: GameRows): SlotRows => ({
  adventures: (rows.adventures ?? []).map(row => ({ ...row, slotId })),
  campaignRuns: (rows.campaignRuns ?? []).map(row => ({ ...row, slotId })),
  colonies: rows.colonies.map(row => ({ ...row, slotId })),
  evacuations: (rows.evacuations ?? []).map(row => ({ ...row, slotId })),
  islands: rows.islands.map(row => ({ ...row, slotId })),
  player: rows.player && { ...rows.player, id: slotId },
  // An offline slot marks every save it holds, so the verified save API refuses it (plan §5.4, rev I6).
  session: { ...rows.session, id: slotId, ...(isOfflineSlot(slotId) ? { origin: "offline" as const } : {}) },
  tradeHistory: (rows.tradeHistory ?? []).map(row => ({ ...row, slotId })),
  tradeOffers: (rows.tradeOffers ?? []).map(row => ({ ...row, slotId }))
});

const withoutSlot = <Row extends { slotId: string }>({ slotId: _slotId, ...row }: Row) => row;

export const fromSlotRows = (rows: SlotRows): GameRows => ({
  adventures: rows.adventures.map(withoutSlot),
  ...(rows.campaignRuns.length ? { campaignRuns: rows.campaignRuns.map(withoutSlot) } : {}),
  colonies: rows.colonies.map(withoutSlot),
  evacuations: rows.evacuations.map(withoutSlot),
  islands: rows.islands.map(withoutSlot),
  player: rows.player && { ...rows.player, id: LEGACY_ROW_ID },
  session: { ...rows.session, id: LEGACY_ROW_ID },
  tradeHistory: rows.tradeHistory.map(withoutSlot),
  // Omit<> of the merchant | player union widens `kind`; the rows are unchanged apart from the slot.
  tradeOffers: rows.tradeOffers.map(withoutSlot) as TradeOfferRow[]
});

/** Version 4 migration: the browser's one game belongs to the account it was tagged with, else to the guest. */
export const legacyGameSlot = (owner: string | null | undefined) => owner || GUEST_SLOT;

/** Boot values stored per slot (e.g. the startup payload of a reload) are keyed `<slot>/<key>`. */
export const slotValueKey = (slotId: string, key: string) => `${slotId}/${key}`;
