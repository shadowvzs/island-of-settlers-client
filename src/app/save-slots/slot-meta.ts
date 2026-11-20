import { levelForExperience } from "@shared/catalog/balance";

import { SAVE_SLOT_LIMIT } from "../../../../island-of-settlers-shared/src/game-settings/constants";
import {
  isSlotMeta, type SlotMeta, type SlotShows
} from "../../../../island-of-settlers-shared/src/offline-slots";
import type { CampaignMarker } from "../../shared/campaign/campaign-run";
import type { SessionActive } from "../../shared/settlement/game-save-rows";
import type { SlotRecords } from "../settlement/game-slot-copy";
import { SLOT_META_KEY, slotValueKey } from "../settlement/game-slot-rows";
import {
  SAVE_SLOT_NUMBERS, SLOT_LABEL_MAX_LENGTH, SLOT_META_SUFFIX, SLOT_META_VERSION, SLOT_NUMBER_PATTERN
} from "./constants";

/**
 * Slot meta (plan §5.6): the boot value `<slotId>/slot-meta`, written in the copy's transaction. The slot list reads
 * only these values, never the rows. Pure: the game-session worker builds it from the copied rows. Its shape is
 * shared with the server's offline store (OFFLINE-CLOUD).
 */
export type { SlotMeta, SlotShows, SlotShowsKind } from "../../../../island-of-settlers-shared/src/offline-slots";

/** What the caller knows at save time; the rest comes from the copied rows. */
export interface SlotMetaInput {
  label?: string;
  place?: string;
  savedAt: number;
}

/** The copied rows the meta reads (the session, the player and the colonies of the source slot). */
export interface SlotSource {
  colonies: readonly { expeditionId: number }[];
  player?: { progress: { experience: number } };
  session?: { active: SessionActive; campaign?: Pick<CampaignMarker, "campaignId" | "mapId"> };
}

/** The rows of a read or copied slot the meta reads. */
export const slotSourceOf = (records: SlotRecords): SlotSource => ({
  colonies: (records.ranges.colonies ?? []) as unknown as SlotSource["colonies"],
  player: records.player as SlotSource["player"],
  session: records.session as SlotSource["session"]
});

/** One of the mode's slots: its number, id and meta (null while empty). */
export interface SaveSlotEntry {
  meta: SlotMeta | null;
  number: number;
  slotId: string;
}

export const isSaveSlotNumber = (value: number) => SAVE_SLOT_NUMBERS.includes(value);

/** The id of save slot `number` of a working slot (`offline.home.3`). */
export const saveSlotId = (workingSlotId: string, number: number) => {
  if (!isSaveSlotNumber(number)) throw new RangeError(`Save slot ${number} is outside 1-${SAVE_SLOT_LIMIT}`);
  return `${workingSlotId}.${number}`;
};

/** The slot number of `slotId` when it is one of the working slot's save slots, else null. */
export const slotNumberOf = (workingSlotId: string, slotId: string) => {
  const prefix = `${workingSlotId}.`;
  if (!slotId.startsWith(prefix)) return null;
  const rest = slotId.slice(prefix.length);
  if (!SLOT_NUMBER_PATTERN.test(rest)) return null;
  const number = Number(rest);
  return isSaveSlotNumber(number) ? number : null;
};

/** The trimmed player name, at most 40 characters; empty = none. */
export const cleanSlotLabel = (text: string | undefined) => {
  const label = text?.trim().slice(0, SLOT_LABEL_MAX_LENGTH).trim();
  return label || undefined;
};

const campaignShows = (session: SlotSource["session"]): SlotShows => {
  const campaign = session?.campaign;
  return campaign ? { campaignId: campaign.campaignId, kind: "campaign", mapId: campaign.mapId } : { kind: "campaign" };
};

/** What the saved session shows: the home island, a colony, an adventure or the campaign run. */
export const slotShows = (source: SlotSource): SlotShows => {
  const active = source.session?.active ?? null;
  if (active === "campaign") return campaignShows(source.session);
  if (active === null) return { kind: "home" };
  return { kind: source.colonies.some(row => row.expeditionId === active) ? "colony" : "adventure" };
};

export const buildSlotMeta = (input: SlotMetaInput, source: SlotSource): SlotMeta => {
  const label = cleanSlotLabel(input.label), place = input.place?.trim();
  const experience = source.player?.progress.experience;
  return {
    ...(label ? { label } : {}),
    ...(experience === undefined ? {} : { level: levelForExperience(experience) }),
    ...(place ? { place } : {}),
    savedAt: input.savedAt,
    shows: slotShows(source),
    version: SLOT_META_VERSION
  };
};

/** The stored meta when well-formed, else null (never thrown). */
export const parseSlotMeta = (json: string | null | undefined): SlotMeta | null => {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    return isSlotMeta(value) ? value : null;
  } catch {
    return null;
  }
};

/** The boot value key of a slot's meta. */
export const slotMetaKey = (slotId: string) => slotValueKey(slotId, SLOT_META_KEY);

/** Every save slot of the working slot (1 … 10, empty ones included) from the listed meta values. */
export const listSaveSlots = (workingSlotId: string, values: readonly [string, string][]): SaveSlotEntry[] => {
  const metas = new Map<number, SlotMeta>();
  for (const [key, json] of values) {
    if (!key.endsWith(SLOT_META_SUFFIX)) continue;
    const number = slotNumberOf(workingSlotId, key.slice(0, -SLOT_META_SUFFIX.length));
    const meta = number === null ? null : parseSlotMeta(json);
    if (number !== null && meta) metas.set(number, meta);
  }
  return SAVE_SLOT_NUMBERS.map(number =>
    ({ meta: metas.get(number) ?? null, number, slotId: saveSlotId(workingSlotId, number) }));
};

/** The most recently saved slot, or null when every slot is empty. */
export const newestSaveSlot = (entries: readonly SaveSlotEntry[]) => entries.reduce<SaveSlotEntry | null>(
  (newest, entry) => entry.meta && (!newest?.meta || entry.meta.savedAt > newest.meta.savedAt) ? entry : newest,
  null);
