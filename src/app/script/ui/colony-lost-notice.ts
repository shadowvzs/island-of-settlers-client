import type { I18n } from "@lingui/core";

import type { QuestText } from "../../../../../island-of-settlers-shared/src/script/types/quest-text";
import { translateMessage } from "../../../shared/i18n/translate";
import { expiryNoticeText } from "../../../shared/settlement/archipelago-colony-quests";
import { wareArt } from "../../settlement-ui/art-helpers";
import type { SettlementPopupContent } from "../../settlement-ui/settlement-popup";
import {
  COLONY_NOTICE_ANNOUNCED_LIMIT, COLONY_NOTICE_STORAGE_PREFIX, EMPTY_COLONY_NOTICE_MEMORY as EMPTY_MEMORY
} from "./constants";
import { SCRIPT_UI_MESSAGES as M } from "./messages";

/**
 * The local colony-lost notice (owner round 6, design §8.2 point 3): the server drops an expired colony silently,
 * without a mail; the client remembers the conquered colonies it last saw and, at the next login, tells the player
 * once per expedition which of them are gone, with the `notify` text of the colony's `colony.hold` quest (TRG10:
 * its own book's text when it had one, else the shipped default colony book). Colonies the client ends itself
 * (live expiry, harbour lost, disband) leave the remembered list while the session runs, so they are never
 * announced twice.
 */

export interface SeenColony {
  id: number;
  name: string;
  /** The expiry notice of the colony's own quest book; absent = the shipped default colony book. */
  notice?: QuestText;
  ore: string;
}

export interface ColonyNoticeMemory {
  /** Expedition ids already announced (bounded). */
  announced: number[];
  seen: SeenColony[];
}

/** Colonies remembered from the last session that are gone now and were not announced yet. */
export const lostColonies = (memory: ColonyNoticeMemory, current: readonly SeenColony[]) => {
  const present = new Set(current.map(colony => colony.id));
  const announced = new Set(memory.announced);
  return memory.seen.filter(colony => !present.has(colony.id) && !announced.has(colony.id));
};

/** The memory after announcing `lost` and seeing `current` (oldest announcements forgotten first). */
export const rememberColonies = (
  memory: ColonyNoticeMemory, current: readonly SeenColony[], lost: readonly SeenColony[]
): ColonyNoticeMemory => ({
  announced: [...memory.announced, ...lost.map(colony => colony.id)].slice(-COLONY_NOTICE_ANNOUNCED_LIMIT),
  seen: current.map(colony => ({ ...colony }))
});

const isSeenColony = (value: unknown): value is SeenColony => {
  const colony = value as SeenColony | null;
  return Boolean(colony) && Number.isSafeInteger(colony!.id) && typeof colony!.name === "string" &&
    typeof colony!.ore === "string" && (colony!.notice === undefined || typeof colony!.notice?.en === "string");
};

const parseMemory = (text: string | null): ColonyNoticeMemory => {
  if (!text) return EMPTY_MEMORY;
  try {
    const value = JSON.parse(text) as Partial<ColonyNoticeMemory>;
    const announced = Array.isArray(value.announced) ? value.announced.filter(Number.isSafeInteger) : [];
    const seen = Array.isArray(value.seen) ? value.seen.filter(isSeenColony) : [];
    return { announced, seen };
  } catch {
    return EMPTY_MEMORY;
  }
};

/** Browser storage of the memory per home island; unavailable storage acts as an empty memory. */
export const createColonyNoticeStorage = (homeSeed: number) => {
  const key = `${COLONY_NOTICE_STORAGE_PREFIX}${homeSeed}`;
  let last = "";
  return {
    read: () => {
      try { return parseMemory(localStorage.getItem(key)); } catch { return EMPTY_MEMORY; }
    },
    write: (memory: ColonyNoticeMemory) => {
      const text = JSON.stringify(memory);
      if (text === last) return;
      last = text;
      try { localStorage.setItem(key, text); } catch { /* private mode: the notice is a convenience */ }
    }
  };
};

/** The local notice of one expedition: the `notify` text of its `colony.hold` quest. */
export const colonyLostNotice = (colony: SeenColony, i18n?: I18n) =>
  expiryNoticeText(colony.name, colony.notice, i18n);

/** One popup for the colonies found gone at login: one notice per expedition. */
export const colonyLostPopup = (lost: readonly SeenColony[], i18n?: I18n): SettlementPopupContent => ({
  actions: [{ label: translateMessage(i18n, M.colonyLostOk), primary: true }],
  art: wareArt(lost[0]!.ore),
  message: lost.map(colony => colonyLostNotice(colony, i18n)).join("\n\n"),
  title: translateMessage(i18n, M.colonyLostTitle),
  tone: "defeat"
});
