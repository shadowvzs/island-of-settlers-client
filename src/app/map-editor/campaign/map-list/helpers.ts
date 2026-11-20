import {
  type Campaign, type CampaignMap, createCampaignMap
} from "../../../../../../island-of-settlers-shared/src/campaign/campaign-model";
import { campaignMapSlotId, displayText } from "../helpers";
import { addDefaultNode, removeNode } from "../map-view/helpers";
import { withoutGraphMap } from "../paths/helpers";

/** Why a map cannot join a campaign's order: it belongs to another campaign, or it is listed already. */
export type MapListRefusal = "foreignMap" | "alreadyListed";

/** Owner rule (item 40): every map belongs to exactly one campaign and appears once in its order. */
export const mapListRefusal = (campaign: Campaign, map: CampaignMap): MapListRefusal | null => {
  if (map.campaignId !== campaign.id) return "foreignMap";
  if (campaign.mapIds.includes(map.id)) return "alreadyListed";
  return null;
};

/**
 * A new draft map record of the campaign ("Map <number>"). A branching campaign ignores `previousMapCompleted`
 * (plan §11), so its new maps start without that lock.
 */
export const newCampaignMap = (campaign: Campaign, id: string, number: number): CampaignMap => {
  const map = createCampaignMap(id, campaign.id, { hash: null, id: campaignMapSlotId(campaign.id, id) });
  const unlock = campaign.edges ? [] : map.unlock;
  return { ...map, name: { en: `Map ${number}` }, unlock };
};

/** The order with one entry moved from `from` to `to` (both clamped); the same array when nothing moves. */
export const moveMapId = (mapIds: string[], from: number, to: number) => {
  const last = mapIds.length - 1;
  const source = Math.min(Math.max(from, 0), last), target = Math.min(Math.max(to, 0), last);
  if (source === target || last < 0) return mapIds;
  const next = [...mapIds];
  const [moved] = next.splice(source, 1);
  next.splice(target, 0, moved!);
  return next;
};

/** The campaign with `map` appended to its order and placed on the map view; refused maps leave it unchanged. */
export const listMap = (campaign: Campaign, map: CampaignMap): Campaign => {
  if (mapListRefusal(campaign, map)) return campaign;
  return addDefaultNode({ ...campaign, mapIds: [...campaign.mapIds, map.id] }, map.id);
};

/**
 * The campaign without `mapId` in its order, on its map view or in its stored graph (edges from or to it, start
 * map); the map record itself stays, unlisted.
 */
export const unlistMap = (campaign: Campaign, mapId: string): Campaign =>
  removeNode(withoutGraphMap({ ...campaign, mapIds: campaign.mapIds.filter(id => id !== mapId) }, mapId), mapId);

/** Maps owned by the campaign but not in its order (kept records, item 40), by id. */
export const unlistedMaps = (campaign: Campaign, maps: readonly CampaignMap[]) =>
  maps.filter(map => map.campaignId === campaign.id && !campaign.mapIds.includes(map.id));

/** One row of the ordered map list. */
export interface MapListRow {
  first: boolean;
  id: string;
  index: number;
  last: boolean;
  name: string;
  position: number;
  ready: boolean;
  selected: boolean;
}

/** The ordered list rows; a listed id without a record is shown by its id so it can still be removed. */
export const mapListRows = (
  campaign: Campaign, maps: readonly CampaignMap[], selectedMapId: string | null, language: string
): MapListRow[] => {
  const byId = new Map(maps.map(map => [map.id, map]));
  return campaign.mapIds.map((id, index) => {
    const map = byId.get(id);
    return {
      first: index === 0,
      id,
      index,
      last: index === campaign.mapIds.length - 1,
      name: map ? displayText(map.name, language, id) : id,
      position: index + 1,
      ready: map?.state === "ready",
      selected: id === selectedMapId
    };
  });
};
