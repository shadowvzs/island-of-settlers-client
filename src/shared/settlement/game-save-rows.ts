import type { IslandKey } from "../../../../island-of-settlers-shared/src/island-key";
import {
  type CampaignMarker, type CampaignRunKey, campaignRunKey, type CampaignRunState
} from "../campaign/campaign-run";
import type { PlayerProgress } from "../progression/player-progress";
import {
  emptyTradeRows, type LegacyTradeMailRow, liftIslandTrade, restoreIslandTrade, type TradeRows
} from "../trade/trade-rows";
import type { AdventureRecord, Archipelago, ColonyEvacuation, ColonyRecord } from "./archipelago";
import type { GameSaveV1 } from "./game-save";

/** Table rows of a saved game, shaped like a future backend database (one row per entity). */
export type { IslandKey };
export interface IslandRow { id: IslandKey; save: GameSaveV1 }
export type ColonyRow = Omit<ColonyRecord, "save">;
export type AdventureRow = Omit<AdventureRecord, "save">;
/** A freed colony's soldiers and wares waiting for pickup; keyed by the colony's expedition id. */
export type EvacuationRow = ColonyEvacuation;
export interface PlayerRow { id: "local"; progress: PlayerProgress }
/** The campaign run document (C2): its settlement save and campaign state, keyed by the run key. */
export interface CampaignRunRow { id: CampaignRunKey; run: CampaignRunState; save: GameSaveV1 }
/** What the session shows: home (null), a colony or adventure (its expedition id) or the campaign run. */
export type SessionActive = number | null | "campaign";
export interface SessionRow {
  id: "local";
  /** Expedition id of the colony or adventure on screen; null is the home island; "campaign" the run. */
  active: SessionActive;
  /** The campaign run that exists; it names the run row (C2). */
  campaign?: CampaignMarker;
  /** Before database version 5 the evacuations lived here; `liftSessionEvacuations` moves them out. */
  evacuations?: EvacuationRow[];
  released?: number[];
  returning?: Archipelago["returning"];
  returningSettlers?: Archipelago["returningSettlers"];
  rewards?: Archipelago["rewards"];
  reliefReceipts?: Archipelago["reliefReceipts"];
  closedRoadDecorations?: Archipelago["closedRoadDecorations"];
  /** "offline": the rows belong to an offline-mode slot; the verified save API refuses them (GS2, GS3a). */
  origin?: "offline";
  savedAt: number;
}
/** Trade offers and history of every island: their own tables since database version 6. */
export interface GameRows extends Partial<TradeRows> {
  /** Trade mail rows of database version 6 (older stored rows only): they fold back into their island save. */
  tradeMail?: readonly LegacyTradeMailRow[];
  adventures?: AdventureRow[];
  colonies: ColonyRow[];
  /** Absent in rows written before database version 5. */
  evacuations?: EvacuationRow[];
  islands: IslandRow[];
  /**
   * Campaign run rows (database version 11). A split save holds the run only while it is on screen; storage keeps
   * a filed run until the sweep finds no marker naming it.
   */
  campaignRuns?: CampaignRunRow[];
  player?: PlayerRow;
  session: SessionRow;
}

/** The expedition id a session's island rows use: a campaign session files every island (home included). */
export const sessionIsland = (active: SessionActive): number | null => active === "campaign" ? null : active;

/** Colony islands and adventure islands are keyed apart; both use their expedition id. */
export const islandKey = (active: number | null, adventure = false): IslandKey => {
  if (active === null) return "home";
  return adventure ? `adventure-${active}` : `colony-${active}`;
};

const bareSave = (save: GameSaveV1): GameSaveV1 => ({ ...save, archipelago: undefined, player: undefined });
const isAdventureId = (adventures: ReadonlyArray<{ expeditionId: number }> | undefined, id: number | null) =>
  Boolean(adventures?.some(adventure => adventure.expeditionId === id));

/** Rows of an older save keep their evacuations in the session row: they become evacuation rows. */
export const liftSessionEvacuations = (rows: GameRows): GameRows => {
  if (rows.session.evacuations === undefined) return rows;
  const { evacuations, ...session } = rows.session;
  return { ...rows, evacuations: [...rows.evacuations ?? [], ...evacuations], session };
};

/**
 * Island rows no game record refers to any more (an expired colony or a finished adventure whose rows outlived
 * it): every island but home, the one on screen and the listed colonies and adventures.
 */
export const unreferencedIslands = (rows: GameRows): IslandKey[] => {
  const adventures = rows.adventures ?? [], active = sessionIsland(rows.session.active);
  const kept = new Set<IslandKey>(["home", islandKey(active, isAdventureId(adventures, active)),
    ...rows.colonies.map(colony => islandKey(colony.expeditionId)),
    ...adventures.map(adventure => islandKey(adventure.expeditionId, true))]);
  return rows.islands.map(island => island.id).filter(id => !kept.has(id));
};

/** Campaign run rows no marker names any more (a restarted or ended attempt): the sweep removes them. */
export const unreferencedCampaignRuns = (rows: Pick<GameRows, "campaignRuns" | "session">): CampaignRunKey[] => {
  const marker = rows.session.campaign, kept = marker && campaignRunKey(marker);
  return (rows.campaignRuns ?? []).map(row => row.id).filter(id => id !== kept);
};

/** The key of the island a save shows (its archipelago's active island, home without one). */
export const activeIslandKey = (archipelago: GameSaveV1["archipelago"]): IslandKey => {
  const active = archipelago?.active ?? null;
  return islandKey(active, isAdventureId(archipelago?.adventures ?? [], active));
};

/**
 * The key of the save on screen: the campaign run's own key while a run is shown, else its island key. Command
 * logs, live map parts and verification chains use it, so a campaign run never reads as the home island.
 */
export const activeSaveKey = (save: Pick<GameSaveV1, "archipelago" | "campaignRun">): IslandKey | CampaignRunKey =>
  save.campaignRun ? campaignRunKey(save.campaignRun) : activeIslandKey(save.archipelago);

/** The run row's key of a campaign session; null when the session shows an island. */
export const sessionCampaignRunKey = (session: Pick<SessionRow, "active" | "campaign">) =>
  session.active === "campaign" && session.campaign ? campaignRunKey(session.campaign) : null;

const islandRowsOf = (save: GameSaveV1): IslandRow[] => {
  const archipelago = save.archipelago;
  if (save.campaignRun) return [];
  return [{ id: activeIslandKey(archipelago), save: bareSave(save) }];
};

const campaignRowsOf = (save: GameSaveV1): CampaignRunRow[] | undefined => {
  const run = save.campaignRun;
  if (!run) return undefined;
  const { campaignRun: _run, ...bare } = bareSave(save);
  return [{ id: campaignRunKey(run), run, save: bare }];
};

/** Splits one game save (with its filed islands) into rows; every island is stored once. */
export const splitGameSave = (save: GameSaveV1): GameRows => {
  const archipelago = save.archipelago;
  const active: SessionActive = save.campaignRun ? "campaign" : archipelago?.active ?? null;
  const adventures = archipelago?.adventures ?? [];
  const islands = islandRowsOf(save), campaignRuns = campaignRowsOf(save);
  if (archipelago?.home) islands.push({ id: "home", save: bareSave(archipelago.home) });
  for (const colony of archipelago?.colonies ?? [])
    if (colony.save) islands.push({ id: islandKey(colony.expeditionId), save: bareSave(colony.save) });
  for (const adventure of adventures)
    if (adventure.save) islands.push({ id: islandKey(adventure.expeditionId, true), save: bareSave(adventure.save) });
  const trade = emptyTradeRows();
  const liftedIslands = islands.map(island => ({ ...island, save: liftIslandTrade(island.id, island.save, trade) }));
  return {
    ...trade,
    ...(campaignRuns ? { campaignRuns } : {}),
    adventures: adventures.map(({ save: _save, ...adventure }) => adventure),
    colonies: (archipelago?.colonies ?? []).map(({ save: _save, ...colony }) => colony),
    evacuations: archipelago?.evacuations ?? [],
    islands: liftedIslands,
    player: save.player && { id: "local", progress: save.player },
    session: { active, ...(archipelago?.campaign ? { campaign: archipelago.campaign } : {}), id: "local",
      ...(save.origin ? { origin: save.origin } : {}),
      released: archipelago?.released,
      returning: archipelago?.returning, rewards: archipelago?.rewards, reliefReceipts: archipelago?.reliefReceipts,
      ...(archipelago?.returningSettlers ? { returningSettlers: archipelago.returningSettlers } : {}),
      closedRoadDecorations: archipelago?.closedRoadDecorations, savedAt: save.savedAt }
  };
};

/** The campaign run row a campaign session shows; undefined when the session shows an island. */
const shownCampaignRun = (rows: GameRows) => {
  const key = sessionCampaignRunKey(rows.session);
  return key ? rows.campaignRuns?.find(row => row.id === key) : undefined;
};

const hasFiledGroup = (rows: GameRows, active: SessionActive, records: number, evacuations: unknown) =>
  records > 0 || active !== null || Boolean(rows.session.campaign) ||
  Boolean(rows.session.released?.length) || Boolean(rows.session.rewards) || Boolean(evacuations) ||
  Boolean(rows.session.returning?.length) || Boolean(rows.session.returningSettlers) ||
  Boolean(rows.session.reliefReceipts?.length) || Boolean(rows.session.closedRoadDecorations?.length);

/**
 * Rebuilds the game save for the island on screen, filing the others into its archipelago. A campaign session
 * shows its run with home filed; when its run row is missing it falls back to home (the marker stays).
 */
export const composeGameSave = (stored: GameRows): GameSaveV1 | null => {
  const rows = liftSessionEvacuations(stored), evacuations = rows.evacuations?.length ? rows.evacuations : undefined;
  const run = shownCampaignRun(rows), active = sessionIsland(rows.session.active);
  const find = (id: IslandKey) => {
    const save = rows.islands.find(island => island.id === id)?.save;
    return save && restoreIslandTrade(id, save, rows);
  };
  const adventureRows = rows.adventures ?? [];
  const current = run ? { ...run.save, campaignRun: run.run }
    : find(islandKey(active, isAdventureId(adventureRows, active)));
  if (!current) return null;
  const colonies: ColonyRecord[] = rows.colonies.map(colony => colony.expeditionId === active ? { ...colony }
    : { ...colony, save: find(islandKey(colony.expeditionId)) });
  const adventures: AdventureRecord[] = adventureRows.map(adventure => adventure.expeditionId === active
    ? { ...adventure } : { ...adventure, save: find(islandKey(adventure.expeditionId, true)) });
  const homeFiled = Boolean(run) || active !== null, session = rows.session;
  const archipelago: Archipelago | undefined = hasFiledGroup(rows, active, colonies.length + adventures.length,
    evacuations) ? { active, adventures: adventures.length ? adventures : undefined,
      ...(session.campaign ? { campaign: session.campaign } : {}), colonies, evacuations,
      home: homeFiled ? find("home") : undefined, released: session.released, returning: session.returning,
      rewards: session.rewards, reliefReceipts: session.reliefReceipts,
      ...(session.returningSettlers ? { returningSettlers: session.returningSettlers } : {}),
      closedRoadDecorations: session.closedRoadDecorations, version: 1 }
    : undefined;
  const origin = session.origin ? { origin: session.origin } : {};
  return { ...current, archipelago, player: rows.player?.progress, ...origin };
};
