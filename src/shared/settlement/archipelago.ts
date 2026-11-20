import { ADVENTURE_LIMIT, COLONY_LIFETIME_MS } from "@shared/catalog/balance";

import { FORMATS } from "../../../../island-of-settlers-shared/src/formats";
import type { ColonyEndReason } from "../../../../island-of-settlers-shared/src/script/archipelago/types";
import { COLONY_LIMIT, COLONY_ORE_SHIP_MS } from "../balance/colonies";
import {
  type CampaignGrant, isGoodsRecord, unappliedGrants, withAppliedGrants
} from "../campaign/campaign-grants";
import { type CampaignMarker,campaignMarkerError } from "../campaign/campaign-run";
import { reducedDuration } from "../progression/talents";
import { type AdventureIsland,adventureIslandError } from "./adventure-rules";
import { retainColonyReliefReceipt } from "./archipelago-relief";
import type { ColonyIsland } from "./colony-expedition-rules";
import { colonyExpiryAssets, creditExpiredColony } from "./colony-expiry-assets";
import { type ColonyNativeEconomy, validColonyNativeEconomy } from "./colony-native-economy";
import { isEmigratedTroop } from "./colony-troop-supply";
import type { GameSaveV1 } from "./game-save";
import type { MilitaryTroopType } from "./military-combat-rules";
import { addGood } from "./production-rules";
import { type ClosedRoadDecorationReturn, closedRoadDecorationReturnProblem, queueClosedRoadDecorations } from "./road-decoration-closures";
import { isSaveObject } from "./save-validation";
import type { AdventureStatus } from "./settlement-adventure";
import type { ColonySetup, ColonyStatus } from "./settlement-colony";
import { savedCommanderManifest } from "./settlement-commander-transport";
import type { EmigratedTroop } from "./settlement-military";
import type { Goods } from "./settlement-types";

/** Landing party carried from the home harbour; it seeds the island on the first visit. */
export interface ColonyLanding extends Omit<ColonySetup, "island"> { crew: number }
interface IslandRecord {
  expeditionId: number;
  /** Until the first visit; afterwards the island's own save holds everyone. */
  landing?: ColonyLanding;
  /** The island's save while another island is active. */
  save?: GameSaveV1;
}
export interface ColonyRecord extends IslandRecord {
  island: ColonyIsland;
  status: ColonyStatus | "landed";
  conqueredAt?: number;
  /** Game time of the next hourly ore ship; set at conquest. */
  nextOreShipAt?: number;
  nativeEconomy?: ColonyNativeEconomy;
}
/** An adventure island: fought over with troops only, discarded once it is won or lost. */
export interface AdventureRecord extends IslandRecord {
  island: AdventureIsland;
  status: AdventureStatus | "landed";
}
/**
 * What a freed colony left behind (owner decision 2026-10-13): idle home ships fetch it; whatever
 * is still waiting at `deadline` (wall clock) reaches the home harbour at once.
 */
export interface ColonyEvacuation {
  expeditionId: number;
  name: string;
  voyageSeconds: number;
  deadline: number;
  troops: EmigratedTroop[];
  cargo: Goods;
}
export interface Archipelago {
  /** The campaign run that exists (on screen or not); its document lives in its own table (C2). */
  campaign?: CampaignMarker;
  /** Existing cosmetic units of discarded worlds, transferred with the same group/player snapshot. */
  closedRoadDecorations?: readonly ClosedRoadDecorationReturn[];
  version: 1;
  /** Expedition id of the colony or adventure on screen; null is the home island. */
  active: number | null;
  /** The home island's save while another island is active. */
  home?: GameSaveV1;
  colonies: ColonyRecord[];
  /** At most ADVENTURE_LIMIT; absent before the first adventure lands. */
  adventures?: AdventureRecord[];
  /** Ended colonies and adventures whose home expedition is freed on the next home visit. */
  released?: number[];
  /** Survivors of ended colonies and adventures, stored at home on the next home visit. */
  returning?: EmigratedTroop[];
  /** Settlers of an ended campaign run (C9b), stored at home on the next home visit within its people limit. */
  returningSettlers?: number;
  /** Adventure coins and wares; a reward ship brings them on the next home visit. */
  rewards?: Goods;
  /** Freed colonies' soldiers and wares waiting for home ships. */
  evacuations?: ColonyEvacuation[];
  /** Closed expired/disbanded worlds retained only for unclaimed departed relief proof. */
  reliefReceipts?: { islandId: number; colony: Omit<ColonyRecord, "save">; save: GameSaveV1 }[];
}
export interface ColonyVisitRequest {
  format: typeof FORMATS.colonyVisit.id;
  archipelago: Archipelago;
  player?: import("../progression/player-progress").PlayerProgress;
}

export const emptyArchipelago = (): Archipelago => ({ active: null, colonies: [], version: 1 });

export const isColonyVisitRequest = (value: unknown): value is ColonyVisitRequest =>
  isSaveObject(value) && value.format === FORMATS.colonyVisit.id;

export const findColony = (archipelago: Archipelago, id: number | null) =>
  archipelago.colonies.find(colony => colony.expeditionId === id);

export const findAdventure = (archipelago: Archipelago, id: number | null) =>
  archipelago.adventures?.find(adventure => adventure.expeditionId === id);

/** Any island record (colony or adventure) by expedition id. */
export const findIsland = (archipelago: Archipelago, id: number | null): ColonyRecord | AdventureRecord | undefined =>
  findColony(archipelago, id) ?? findAdventure(archipelago, id);

/** Registers a landed expedition once; later calls keep the existing colony untouched. */
export const addColonyRecord = (
  archipelago: Archipelago, expeditionId: number, island: ColonyIsland, landing: ColonyLanding
): Archipelago => {
  if (findColony(archipelago, expeditionId)) return archipelago;
  const colony: ColonyRecord = { expeditionId, island: { ...island }, landing, status: "landed" };
  return { ...archipelago, colonies: [...archipelago.colonies, colony] };
};

/** Registers a landed adventure once; its troops seed the generated island on the first visit. */
export const addAdventureRecord = (
  archipelago: Archipelago, expeditionId: number, island: AdventureIsland, landing: ColonyLanding
): Archipelago => {
  if (findAdventure(archipelago, expeditionId)) return archipelago;
  const adventure: AdventureRecord = { expeditionId, island: { ...island }, landing, status: "landed" };
  return { ...archipelago, adventures: [...archipelago.adventures ?? [], adventure] };
};

const withSave = <T extends IslandRecord>(records: T[] | undefined, id: number | null, save: GameSaveV1 | undefined) =>
  records?.map(record => record.expeditionId === id ? { ...record, save } : record);

/** Files the current island's save under its slot so another island can take the screen. */
const storeActive = (archipelago: Archipelago, current: GameSaveV1): Archipelago => {
  const save = { ...current, archipelago: undefined };
  if (archipelago.active === null) return { ...archipelago, home: save };
  return { ...archipelago, adventures: withSave(archipelago.adventures, archipelago.active, save),
    colonies: withSave(archipelago.colonies, archipelago.active, save)! };
};

/**
 * The startup payload for the next island: its stored save carrying the archipelago, or a
 * visit request when a colony or adventure has never been visited (its island is generated on arrival).
 */
export const travelTo = (archipelago: Archipelago, current: GameSaveV1, target: number | null) => {
  const filed = storeActive(archipelago, current);
  if (target === null) {
    if (!filed.home) throw new Error("The home island has no saved state");
    return { ...filed.home, archipelago: { ...filed, active: null, home: undefined }, player: current.player } satisfies
      GameSaveV1;
  }
  const record = findIsland(filed, target);
  if (!record) throw new Error("Unknown colony");
  const next: Archipelago = { ...filed, active: target, adventures: withSave(filed.adventures, target, undefined),
    colonies: withSave(filed.colonies, target, undefined)! };
  if (!record.save)
    return { archipelago: next, format: FORMATS.colonyVisit.id, player: current.player } satisfies
      ColonyVisitRequest;
  return { ...record.save, archipelago: next, player: current.player } satisfies GameSaveV1;
};

/** `reduction`: the colony resource ship talent's share off the interval (60 → 45 min at rank 5). */
export const colonyOreShipMs = (reduction = 0) => reducedDuration(COLONY_ORE_SHIP_MS, reduction);

const firstOreShipAt = (conqueredAt: number | undefined, oreShipReduction: number) =>
  conqueredAt === undefined ? undefined : conqueredAt + colonyOreShipMs(oreShipReduction);

/**
 * Mirrors the visited colony's progress into its record before it is filed away. `oreShipReduction`:
 * the colony resource ship talent, for the first ship after the conquest.
 */
export const updateColonyStatus = (
  archipelago: Archipelago, id: number, status: ColonyRecord["status"], conqueredAt?: number, oreShipReduction = 0
): Archipelago => ({
  ...archipelago,
  colonies: archipelago.colonies.map(colony => colony.expeditionId === id
    ? { ...colony, conqueredAt, landing: undefined, status,
      nextOreShipAt: colony.nextOreShipAt ?? firstOreShipAt(conqueredAt, oreShipReduction) }
    : colony)
});

/** Mirrors the visited adventure's progress into its record. */
export const updateAdventureStatus = (
  archipelago: Archipelago, id: number, status: AdventureRecord["status"]
): Archipelago => ({
  ...archipelago,
  adventures: archipelago.adventures?.map(adventure => adventure.expeditionId === id
    ? { ...adventure, landing: undefined, status } : adventure)
});

/**
 * Offline time beyond the catch-up cap produced nothing: every colony's ore ship schedule moves on by it, so the
 * skipped hours send no ships.
 */
export const deferOreShips = (archipelago: Archipelago, ms: number): Archipelago => ({
  ...archipelago,
  colonies: archipelago.colonies.map(colony => colony.nextOreShipAt === undefined ? colony
    : { ...colony, nextOreShipAt: colony.nextOreShipAt + ms })
});

export const setNextOreShip = (archipelago: Archipelago, id: number, at: number): Archipelago => ({
  ...archipelago,
  colonies: archipelago.colonies.map(colony => colony.expeditionId === id ? { ...colony, nextOreShipAt: at } : colony)
});

const removeColony = (archipelago: Archipelago, id: number): Archipelago => ({
  ...archipelago, colonies: archipelago.colonies.filter(colony => colony.expeditionId !== id)
});

/** Player soldiers still alive in a filed colony save: they sail home when it ends. */
export const colonySurvivors = (save: GameSaveV1 | undefined): EmigratedTroop[] => {
  const commander = save?.settlement.military?.commander;
  return (save?.settlement.military?.soldiers ?? []).flatMap(soldier => {
    const combat = soldier.combat;
    if ((combat?.faction ?? 0) !== 0) return [];
    const type: MilitaryTroopType = combat?.type ?? "shield";
    const hp = combat?.hp ?? 1;
    const manifest = commander && soldier.commanderId === commander.id
      ? savedCommanderManifest(commander, hp, commander.operationId ?? 1,
        commander.transport?.destinationName ?? "Colony") : undefined;
    return [{ hp, rank: soldier.rank, type,
      ...(manifest ? { commander: manifest } : {}),
      ...(soldier.recoverySeconds !== undefined ? { recoverySeconds: soldier.recoverySeconds } : {}) }];
  });
};

/** Survivors of a filed island; troops of a never visited island are still their landing party. */
export const islandSurvivors = (record: Pick<IslandRecord, "landing" | "save">): EmigratedTroop[] =>
  record.save ? colonySurvivors(record.save) : (record.landing?.troops ?? []).map(troop => ({ ...troop }));

/** Ends a colony: its slot and island are released, its survivors sail home. */
export const endColony = (archipelago: Archipelago, id: number, survivors: readonly EmigratedTroop[]): Archipelago => queueClosedRoadDecorations({
  ...removeColony(retainColonyReliefReceipt(archipelago, findColony(archipelago, id)), id),
  released: [...(archipelago.released ?? []), id],
  returning: [...(archipelago.returning ?? []), ...survivors]
}, `colony-${id}`, findColony(archipelago, id)?.save);

const mergeGoods = (base: Goods | undefined, extra: Goods) => {
  const merged = { ...base };
  for (const [ware, count] of Object.entries(extra)) addGood(merged, ware, count);
  return merged;
};

/** Home-bound goods (a campaign map's level-up coins) wait in the rewards delivered on the next home visit. */
export const queueHomeRewards = (archipelago: Archipelago, goods: Readonly<Goods>): Archipelago =>
  ({ ...archipelago, rewards: mergeGoods(archipelago.rewards, goods) });

/**
 * Writes a campaign run's grants into `archipelago.rewards` once each: ids the run's marker already records are
 * skipped, so a retried or reloaded pending grant never credits twice. Without a marker the goods are queued as is.
 */
export const applyCampaignGrants = (archipelago: Archipelago, grants: readonly CampaignGrant[]): Archipelago => {
  const fresh = unappliedGrants(archipelago.campaign, grants);
  if (!fresh.length) return archipelago;
  const rewarded = fresh.reduce((group, grant) => queueHomeRewards(group, grant.goods), archipelago);
  const campaign = archipelago.campaign && withAppliedGrants(archipelago.campaign, fresh.map(grant => grant.id));
  return campaign ? { ...rewarded, campaign } : rewarded;
};

/** Ends an adventure: the island is discarded, survivors and any reward sail home. */
export const endAdventure = (
  archipelago: Archipelago, id: number, survivors: readonly EmigratedTroop[], rewards: Goods = {}
): Archipelago => {
  const adventures = archipelago.adventures?.filter(adventure => adventure.expeditionId !== id);
  const rewarded = Object.keys(rewards).length ? mergeGoods(archipelago.rewards, rewards) : archipelago.rewards;
  return queueClosedRoadDecorations({ ...archipelago, adventures: adventures?.length ? adventures : undefined,
    released: [...(archipelago.released ?? []), id], returning: [...(archipelago.returning ?? []), ...survivors],
    rewards: rewarded }, `adventure-${id}`, findAdventure(archipelago, id)?.save);
};

/** Expiry returns all remaining physical assets immediately; no pickup ship is required. */
export const expireColony = (archipelago: Archipelago, colony: ColonyRecord, now: number): Archipelago => {
  if (!archipelago.colonies.some(entry => entry.expeditionId === colony.expeditionId)) return archipelago;
  const assets = colonyExpiryAssets(colony.save);
  if (!colony.save) assets.troops = islandSurvivors(colony);
  const ended = endColony({ ...archipelago, colonies: archipelago.colonies.map(entry =>
    entry.expeditionId === colony.expeditionId ? colony : entry) }, colony.expeditionId, []);
  if (ended.home) return { ...ended, home: creditExpiredColony(ended.home, assets) };
  const evacuation: ColonyEvacuation = { ...assets, deadline: now, expeditionId: colony.expeditionId,
    name: colony.island.name, voyageSeconds: colony.island.voyageSeconds };
  return { ...ended, evacuations: [...ended.evacuations ?? [], evacuation] };
};

/**
 * `colonyEnd` of the archipelago executor (trigger design §8.2 item 4): `expired` returns every remaining asset
 * (today's `expireColony`); `lost` and `cancelled` end the colony with its survivors and no asset return. Null
 * when the colony is already gone (the server dropped it silently), so the executor skips the step.
 */
export const colonyEnd = (
  archipelago: Archipelago, colony: ColonyRecord, reason: ColonyEndReason,
  options: { now: number; survivors?: readonly EmigratedTroop[] }
): Archipelago | null => {
  if (!findColony(archipelago, colony.expeditionId)) return null;
  if (reason === "expired") return expireColony(archipelago, colony, options.now);
  return endColony(archipelago, colony.expeditionId, options.survivors ?? islandSurvivors(colony));
};

export const expiredColonies = (archipelago: Archipelago, now: number) => archipelago.colonies.filter(colony =>
  colony.status === "conquered" && colony.conqueredAt !== undefined &&
  colony.conqueredAt + COLONY_LIFETIME_MS <= now);

const ADVENTURE_RECORD_STATUSES = new Set(["landed", "contested", "won", "defeated"]);

/** One waiting colony evacuation. */
const isColonyEvacuation = (value: unknown) => isSaveObject(value) && Number.isSafeInteger(value.expeditionId) &&
  typeof value.name === "string" && Number.isFinite(value.voyageSeconds) && (value.voyageSeconds as number) > 0 &&
  Number.isFinite(value.deadline) && isGoodsRecord(value.cargo) && Array.isArray(value.troops) &&
  value.troops.every(isEmigratedTroop);

const evacuationsError = (evacuations: unknown) => {
  if (evacuations === undefined) return null;
  return Array.isArray(evacuations) && evacuations.every(isColonyEvacuation) ? null : "Invalid colony evacuation";
};

const adventuresError = (adventures: unknown) => {
  if (adventures === undefined) return null;
  if (!Array.isArray(adventures) || adventures.length > ADVENTURE_LIMIT) return "Invalid adventure list";
  const valid = adventures.every(adventure => isSaveObject(adventure) && Number.isSafeInteger(adventure.expeditionId) &&
    !adventureIslandError(adventure.island) && ADVENTURE_RECORD_STATUSES.has(adventure.status as string));
  return valid ? null : "Invalid adventure record";
};

export const validateArchipelago = (value: unknown) => {
  if (value === undefined) return null;
  if (!isSaveObject(value) || value.version !== 1 || !Array.isArray(value.colonies) ||
    value.colonies.length > COLONY_LIMIT || (value.active !== null && !Number.isSafeInteger(value.active)))
    return "Invalid island group";
  const colonies = value.colonies as unknown[];
  const closedError = closedRoadDecorationReturnProblem(value.closedRoadDecorations) ??
    campaignMarkerError(value.campaign);
  if (closedError) return closedError;
  if (!colonies.every(colony => isSaveObject(colony) && Number.isSafeInteger(colony.expeditionId) &&
    isSaveObject(colony.island) && validColonyNativeEconomy(colony.nativeEconomy)))
    return "Invalid colony record";
  if (value.reliefReceipts !== undefined && (!Array.isArray(value.reliefReceipts) || value.reliefReceipts.length > COLONY_LIMIT ||
    !value.reliefReceipts.every(receipt => isSaveObject(receipt) && Number.isSafeInteger(receipt.islandId) &&
      isSaveObject(receipt.colony) && receipt.colony.expeditionId === receipt.islandId && isSaveObject(receipt.save) &&
      receipt.save.player === undefined && receipt.save.archipelago === undefined &&
      isSaveObject(receipt.save.settlement))))
    return "Invalid closed relief receipt";
  const adventureError = adventuresError(value.adventures);
  if (adventureError) return adventureError;
  if (value.rewards !== undefined && !isGoodsRecord(value.rewards)) return "Invalid adventure rewards";
  const evacuationError = evacuationsError(value.evacuations);
  if (evacuationError) return evacuationError;
  if (value.active !== null && !findIsland(value as unknown as Archipelago, value.active as number))
    return "Active colony is missing";
  return null;
};
