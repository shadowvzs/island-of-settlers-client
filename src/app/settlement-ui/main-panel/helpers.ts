import type { I18n } from "@lingui/core";

import type { OnlineFeatures } from "../../../../../island-of-settlers-shared/src/game-settings/game-settings";
import { translateMessage } from "../../../shared/i18n/translate";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementNotification, SettlementUiSnapshot } from "../types";

export type MenuEntryId = "buildings" | "market" | "overview" | "settings" | "ships";

export interface MenuEntry {
  /** `data-ui-anchor` of the entry (map script highlights). */
  data: { "data-ui-anchor": string };
  icon: string;
  id: MenuEntryId;
  label: string;
  title: string;
}

/** Main selection entries in their order. Export / Import live in Development > Diagnostics. */
const menuEntries = (i18n?: I18n): Omit<MenuEntry, "data">[] => [
  { icon: "buildings", id: "buildings", label: translateMessage(i18n, M.menu.buildings),
    title: translateMessage(i18n, M.menu.buildings) },
  { icon: "statistics", id: "overview", label: translateMessage(i18n, M.menu.overview),
    title: translateMessage(i18n, M.menu.overview) },
  { icon: "ship", id: "ships", label: translateMessage(i18n, M.menu.ships),
    title: translateMessage(i18n, M.menu.shipsTitle) },
  { icon: "market", id: "market", label: translateMessage(i18n, M.menu.market),
    title: translateMessage(i18n, M.menu.marketTitle) },
  { icon: "settings", id: "settings", label: translateMessage(i18n, M.menu.settings),
    title: translateMessage(i18n, M.menu.settings) }
];

/** The Market entry exists only while the game's player market is switched on (plan §8.2). */
const isEntryOffered = (id: MenuEntryId, features?: OnlineFeatures) =>
  id !== "market" || !features || features.market;

/**
 * Main selection entries; each carries its `data-ui-anchor` (`menu.<id>`) for map script highlights. An entry
 * whose online feature is switched off is absent (no `features` = today's full list).
 */
export const getMenuEntries = (i18n?: I18n, features?: OnlineFeatures): MenuEntry[] =>
  menuEntries(i18n)
    .filter(entry => isEntryOffered(entry.id, features))
    .map(entry => ({ ...entry, data: { "data-ui-anchor": `menu.${entry.id}` } }));

export interface NoticeLink {
  buildingId: string;
  disabled: boolean;
  name: string;
  title: string;
}

export interface NoticeRow {
  after: string;
  before: string;
  id: string;
  link?: NoticeLink;
  title: string;
}

const getNoticeLink = (
  notice: SettlementNotification, buildingIds: ReadonlySet<string>, i18n?: I18n
) => {
  const { buildingId, buildingName, message } = notice;
  if (!buildingId || !buildingName) return undefined;
  const offset = message.indexOf(buildingName);
  if (offset < 0) return undefined;
  const disabled = !buildingIds.has(buildingId);
  return {
    after: message.slice(offset + buildingName.length),
    before: message.slice(0, offset),
    link: {
      buildingId,
      disabled,
      name: buildingName,
      title: disabled
        ? translateMessage(i18n, M.menu.buildingGone)
        : translateMessage(i18n, M.menu.goToBuilding, { name: buildingName })
    }
  };
};

const getNoticeRow = (
  notice: SettlementNotification, buildingIds: ReadonlySet<string>, i18n?: I18n
): NoticeRow => ({
  after: "",
  before: notice.message,
  id: notice.id,
  title: notice.tone === "warning"
    ? translateMessage(i18n, M.menu.warning)
    : translateMessage(i18n, M.menu.settlementNews),
  ...getNoticeLink(notice, buildingIds, i18n)
});

/** Notification rows; a named building in the text becomes a link while that building exists. */
export const selectNoticeRows = (
  { buildings, notifications }: SettlementUiSnapshot, i18n?: I18n
): NoticeRow[] => {
  if (!notifications?.length) return [];
  const buildingIds = new Set(buildings?.map(building => building.id));
  return notifications.map(notice => getNoticeRow(notice, buildingIds, i18n));
};

