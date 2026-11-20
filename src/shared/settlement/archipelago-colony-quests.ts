import type { I18n } from "@lingui/core";

import {
  archipelagoFailureNotices, archipelagoTextValues, runArchipelagoFailure
} from "../../../../island-of-settlers-shared/src/script/archipelago/executor";
import type {
  ArchipelagoNotice, ColonyEndReason
} from "../../../../island-of-settlers-shared/src/script/archipelago/types";
import { COLONY_HOLD_QUEST_ID } from "../../../../island-of-settlers-shared/src/script/constants";
import type { QuestBook } from "../../../../island-of-settlers-shared/src/script/types/quests";
import type { QuestText } from "../../../../island-of-settlers-shared/src/script/types/quest-text";
import { displayQuestText } from "../i18n/quest-text";
import { type Archipelago, colonyEnd, type ColonyRecord } from "./archipelago";
import type { EmigratedTroop } from "./settlement-military";

/**
 * Colony quests that end in the archipelago (trigger design §8.2, owner round 6): expiry (`colony.hold`), harbour
 * loss (`colony.harbourLost`) and disbanding (`colony.cancelled`) run their `onFailure` list through the shared
 * archipelago executor: `colonyEnd` changes the island group, `notify` becomes a local notice. Client only: the
 * server drops an expired colony silently and writes no mail.
 */

export interface ColonyQuestFailure {
  archipelago: Archipelago;
  /** The reason the quest's `colonyEnd` ended the colony with; null when it was already gone or the list has none. */
  ended: ColonyEndReason | null;
  notices: ArchipelagoNotice[];
}

/** The colony's own book from its filed save's script snapshot; null = the shipped default colony book. */
export const colonyQuestBook = (colony: Pick<ColonyRecord, "save">): QuestBook | null =>
  colony.save?.settlement?.scriptSnapshot?.script?.quests ?? null;

/** Fails a colony quest: the island group after its `colonyEnd` and the notices to show. */
export const failColonyQuest = (
  archipelago: Archipelago, colony: ColonyRecord, questId: string,
  options: { now: number; survivors?: readonly EmigratedTroop[] }
): ColonyQuestFailure => {
  let next = archipelago;
  const notices: ArchipelagoNotice[] = [];
  const result = runArchipelagoFailure(colonyQuestBook(colony), questId, {
    colonyEnd: reason => {
      const ended = colonyEnd(next, colony, reason, options);
      if (!ended) return false;
      next = ended;
      return true;
    },
    notify: notice => notices.push(notice)
  });
  return { archipelago: next, ended: result.ended, notices };
};

/** A notice text in the player's language with the island's name filled in. */
export const colonyNoticeText = (text: QuestText, islandName: string, i18n?: I18n) =>
  displayQuestText(text, i18n, { evaluate: archipelagoTextValues({ islandName }) });

/** The notices of a failure as one message (a list normally has one). */
export const colonyNoticeMessage = (notices: readonly ArchipelagoNotice[], islandName: string, i18n?: I18n) =>
  notices.map(notice => colonyNoticeText(notice.text, islandName, i18n)).join(" ");

/**
 * The expiry notice of a colony's own book when it differs from the shipped default (remembered with the colony
 * so a colony the server drops while the player is away is announced with its real text); undefined = default.
 */
export const customExpiryNotice = (colony: Pick<ColonyRecord, "save">): QuestText | undefined => {
  const book = colonyQuestBook(colony);
  return book ? archipelagoFailureNotices(book, COLONY_HOLD_QUEST_ID)[0]?.text : undefined;
};

/** The expiry notice text of a colony that is gone: its remembered own text, else the shipped default book's. */
export const expiryNoticeText = (islandName: string, own: QuestText | undefined, i18n?: I18n) => {
  const text = own ?? archipelagoFailureNotices(null, COLONY_HOLD_QUEST_ID)[0]!.text;
  return colonyNoticeText(text, islandName, i18n);
};
