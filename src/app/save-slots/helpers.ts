import type { I18n, MessageDescriptor } from "@lingui/core";

import { translateMessage } from "../../shared/i18n/translate";
import { SLOT_ACTION_ICONS } from "./constants";
import { SAVE_SLOTS_MESSAGES as M } from "./messages";
import type { SaveSlotEntry, SlotMeta } from "./slot-meta";

/** The list's purpose: save into a slot (in game) or load one (in game and on the title page). */
export type SlotListMode = "load" | "save";
export type SlotActionId = "delete" | "load" | "save";

/** A slot row action as the view renders it. */
export interface SlotRowAction {
  icon: string;
  id: SlotActionId;
  label: string;
}

export interface SlotRow {
  actions: SlotRowAction[];
  date: string;
  detail: string;
  empty: boolean;
  number: number;
  title: string;
}

/** Which actions a slot offers: Save here (save mode), Load (load mode, used slots), Delete (used slots). */
export const slotActionIds = (mode: SlotListMode, used: boolean): SlotActionId[] => {
  const primary: SlotActionId[] = mode === "save" ? ["save"] : [];
  if (!used) return primary;
  return mode === "save" ? [...primary, "delete"] : ["load", "delete"];
};

/** Whether an action asks first: overwriting a used slot, loading and deleting always do. */
export const needsConfirmation = (action: SlotActionId, used: boolean) => action !== "save" || used;

const kindText = (meta: SlotMeta, i18n: I18n) => i18n._(M.kind[meta.shows.kind]);

/** The slot's heading: the player's name, else the map's name, else what it shows. */
const slotTitle = (meta: SlotMeta, i18n: I18n) => meta.label ?? meta.place ?? kindText(meta, i18n);

/** The line under the heading: what it shows (with the map's name under a player's name) and the level. */
const slotDetail = (meta: SlotMeta, i18n: I18n) => {
  const parts = [kindText(meta, i18n)];
  if (meta.label && meta.place) parts.push(meta.place);
  if (meta.level !== undefined) parts.push(translateMessage(i18n, M.level, { level: meta.level }));
  return parts.join(" · ");
};

/** The save time in the active locale (short date and time). */
export const slotDate = (savedAt: number, locale: string) =>
  new Intl.DateTimeFormat(locale, { dateStyle: "short", timeStyle: "short" }).format(savedAt);

/** One prepared row of the slot list. */
export const slotRow = (entry: SaveSlotEntry, mode: SlotListMode, i18n: I18n): SlotRow => {
  const { meta, number } = entry;
  const actions = slotActionIds(mode, meta !== null).map(id =>
    ({ icon: SLOT_ACTION_ICONS[id], id, label: i18n._(M.action[id]) }));
  if (!meta) {
    const title = translateMessage(i18n, M.slot, { number });
    return { actions, date: "", detail: i18n._(M.empty), empty: true, number, title };
  }
  return { actions, date: slotDate(meta.savedAt, i18n.locale), detail: slotDetail(meta, i18n), empty: false, number,
    title: slotTitle(meta, i18n) };
};

/** The slots a list shows: every slot to save into, only used ones to load. */
export const shownSlots = (entries: readonly SaveSlotEntry[], mode: SlotListMode) =>
  mode === "save" ? entries : entries.filter(entry => entry.meta !== null);

/** The confirmation question of an action on slot `number`. */
export const confirmationText = (action: SlotActionId, number: number, i18n: I18n) => {
  const questions: Record<SlotActionId, MessageDescriptor> = {
    delete: M.confirm.deleteQuestion, load: M.confirm.loadQuestion, save: M.confirm.saveQuestion
  };
  const question = translateMessage(i18n, questions[action], { number });
  return { confirm: i18n._(M.confirm[action]), question };
};
