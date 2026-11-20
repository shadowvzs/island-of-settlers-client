import { isCampaignRunRowKey } from "../../../../island-of-settlers-shared/src/island-key";
import type { CampaignRunKey, CampaignRunState } from "../../shared/campaign/campaign-run";
import type { PlayerProgress } from "../../shared/progression/player-progress";
import type { GameSaveV1 } from "../../shared/settlement/game-save";
import {
  type AdventureRow, type CampaignRunRow, type ColonyRow, composeGameSave, type EvacuationRow, type GameRows,
  type IslandRow, type SessionRow, splitGameSave
} from "../../shared/settlement/game-save-rows";
import { restoreIslandTrade } from "../../shared/trade/trade-rows";
import type { ExpeditionEntry, SaveSnapshot } from "./save-api-client";

type ExpeditionRow = AdventureRow | ColonyRow | EvacuationRow;

const toEntries = (rows: readonly ExpeditionRow[] = []): ExpeditionEntry[] =>
  rows.map(row => ({ data: { ...row }, expeditionId: row.expeditionId }));

const fromEntries = <Row extends ExpeditionRow>(entries: readonly ExpeditionEntry[]) =>
  entries.map(entry => entry.data as unknown as Row);

type SnapshotRow = SaveSnapshot["islands"][number];

const documentOf = (save: GameSaveV1): SnapshotRow["save"] => ({
  data: save as unknown as Record<string, unknown>, metadata: { savedAt: save.savedAt }, schemaVersion: save.version
});

/**
 * A campaign run row travels as one more snapshot row under its run key (campaign server part 2): its settlement
 * save with the campaign state inside (pending grants included), so the run, its command log chain and its grants
 * reach the server like an island and survive a device change.
 */
const campaignRunEntry = (row: CampaignRunRow): SnapshotRow =>
  ({ key: row.id, save: documentOf({ ...row.save, campaignRun: row.run }) });

const campaignRunRowOf = (entry: SnapshotRow): CampaignRunRow => {
  const { campaignRun, ...save } = entry.save.data as unknown as GameSaveV1 & { campaignRun: CampaignRunState };
  return { id: entry.key as CampaignRunKey, run: campaignRun, save: save as GameSaveV1 };
};

/** The snapshot rows split into islands and campaign runs (by key). */
const splitRows = (rows: readonly SnapshotRow[]) => {
  const islands: IslandRow[] = [], campaignRuns: CampaignRunRow[] = [];
  for (const row of rows) {
    if (isCampaignRunRowKey(row.key)) campaignRuns.push(campaignRunRowOf(row));
    else islands.push({ id: row.key, save: row.save.data as unknown as GameSaveV1 });
  }
  return { campaignRuns, islands };
};

/**
 * The save API's complete snapshot of one game: the same rows as the browser tables (islands, the campaign run,
 * colonies, adventures, evacuations, player, session); each island keeps its own trade lists, as the API has no
 * trade tables.
 */
export const toSaveSnapshot = (save: GameSaveV1): SaveSnapshot => {
  const rows = splitGameSave(save);
  const { id: _id, ...session } = rows.session;
  return {
    adventures: toEntries(rows.adventures),
    colonies: toEntries(rows.colonies),
    evacuations: toEntries(rows.evacuations),
    islands: [
      ...rows.islands.map(island =>
        ({ key: island.id, save: documentOf(restoreIslandTrade(island.id, island.save, rows)) })),
      ...(rows.campaignRuns ?? []).map(campaignRunEntry)
    ],
    player: (rows.player?.progress ?? {}) as unknown as Record<string, unknown>,
    session
  };
};

/** The game of a stored snapshot; null for an empty slot (created but never uploaded). */
export const fromSaveSnapshot = (snapshot: SaveSnapshot): GameSaveV1 | null => {
  if (!snapshot.islands.length) return null;
  const hasPlayer = Object.keys(snapshot.player).length > 0;
  const { campaignRuns, islands } = splitRows(snapshot.islands);
  const rows: GameRows = {
    ...(campaignRuns.length ? { campaignRuns } : {}),
    adventures: fromEntries<AdventureRow>(snapshot.adventures),
    colonies: fromEntries<ColonyRow>(snapshot.colonies),
    evacuations: fromEntries<EvacuationRow>(snapshot.evacuations),
    islands,
    player: hasPlayer ? { id: "local", progress: snapshot.player as unknown as PlayerProgress } : undefined,
    session: { ...snapshot.session, id: "local" } as SessionRow
  };
  return composeGameSave(rows);
};
