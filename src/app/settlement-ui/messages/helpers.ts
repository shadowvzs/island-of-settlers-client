import type { I18n } from "@lingui/core";

import type { ScriptMail } from "../../../../../island-of-settlers-shared/src/script/types/ui";
import { banditSiteKey, banditSiteName, type BanditSiteRef } from "../../../render-common/buildings/bandit-camp-plan";
import { getBuildingDefinition } from "../../../render-common/buildings/building-catalog";
import { displayWareName } from "../../../shared/i18n/domain";
import { displayQuestText } from "../../../shared/i18n/quest-text";
import { translateMessage } from "../../../shared/i18n/translate";
import type { BattleMessage } from "../../../shared/progression/battle-messages";
import { type InboxMail, isScriptMail } from "../../../shared/progression/inbox-mails";
import type { TroopCounts } from "../../../shared/settlement/expedition-battle-record";
import type { MilitaryTroopType } from "../../../shared/settlement/military-combat-rules";
import { troopTypes } from "../../settlement/army-action-rail";
import { troopPortrait } from "../../settlement/army-icons";
import { troopPluralName } from "../../settlement/troop-names";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiSnapshot } from "../types";

const NO_MESSAGES: readonly InboxMail[] = [];

/** The player's inbox; the reference changes only when a mail arrives or is read. */
export const selectMessages = ({ player }: SettlementUiSnapshot) => player?.messages ?? NO_MESSAGES;

/** The selected mail, else the newest one; undefined when there are none. */
export const getSelectedReport = (messages: readonly InboxMail[], selectedId: string) =>
  messages.find(message => message.id === selectedId) ?? messages[0];

/** True when the shown mail is unread and was not already marked by this view (marks it exactly once). */
export const shouldMarkRead = (report: InboxMail | undefined, marked: ReadonlySet<string>) =>
  Boolean(report && !report.read && !marked.has(report.id));

const getMessageTitle = (message: InboxMail, i18n?: I18n) => {
  if (isScriptMail(message)) return displayQuestText(message.title, i18n);
  return translateMessage(i18n, message.kind === "colony" ? M.messages.colonyConquered : M.messages.adventureCompleted,
    { island: message.island });
};

/** Mail tabs: title, pressed state and the unread marker class. */
export const getMessageTabs = (
  messages: readonly InboxMail[], shownId: string | undefined, i18n?: I18n
) => messages.map(message => ({
  className: message.read ? "settlement-ui__tab" : "settlement-ui__tab is-unread",
  id: message.id,
  pressed: message.id === shownId,
  title: getMessageTitle(message, i18n)
}));

export type ReportTileIcon =
  | { bandit?: BanditSiteRef; kind: "building"; type: number }
  | { kind: "picture"; source: string }
  | { kind: "ware"; ware: string };

export interface ReportTile {
  count: number;
  icon: ReportTileIcon;
  key: string;
  label: string;
}

/** Generic names for troops without a nation (defeated enemies); own troops use the nation roster. */
const TROOP_LABELS: Record<MilitaryTroopType, string> = {
  archer: "Archers", cavalry: "Cavalry", heavy: "Heavy infantry", shield: "Shield soldiers"
};
/** Ware pictures for troops without a nation (defeated enemies). */
const TROOP_WARES: Record<MilitaryTroopType, string> = {
  archer: "bow", cavalry: "horse", heavy: "axe", shield: "shield"
};

const getTroopIcon = (type: MilitaryTroopType, nation?: string): ReportTileIcon => nation
  ? { kind: "picture", source: troopPortrait(nation, type) }
  : { kind: "ware", ware: TROOP_WARES[type] };

const getTroopTiles = (counts: TroopCounts, nation?: string): ReportTile[] => troopTypes.flatMap(type => {
  const count = counts[type] ?? 0;
  if (!count) return [];
  const label = nation ? troopPluralName(nation, type) : TROOP_LABELS[type];
  return [{ count, icon: getTroopIcon(type, nation), key: type, label }];
});

const getBuildingLabel = ({ bandit, type }: BattleMessage["buildings"][number]) => bandit === undefined
  ? getBuildingDefinition(type).name
  : banditSiteName(bandit, "building");

const getBuildingTiles = (buildings: BattleMessage["buildings"]): ReportTile[] => buildings.map(building => ({
  count: building.count,
  icon: { bandit: building.bandit, kind: "building", type: building.type },
  key: `${building.type}:${building.bandit ? banditSiteKey(building.bandit) : ""}`,
  label: getBuildingLabel(building)
}));

const getRewardTiles = (goods: Readonly<Record<string, number>>, i18n?: I18n): ReportTile[] =>
  Object.entries(goods).map(([ware, count]) =>
    ({ count, icon: { kind: "ware", ware }, key: ware, label: displayWareName(ware, i18n) }));

/** Everything a battle report shows, in display order. */
export const getReportDetails = (report: BattleMessage, i18n?: I18n) => ({
  date: new Date(report.date).toLocaleString(i18n?.locale),
  experience: translateMessage(i18n, M.common.xp, { amount: report.experience }),
  incomplete: report.incomplete,
  island: report.island,
  rewardsTravelHome: report.kind === "adventure",
  sections: [
    { tiles: getTroopTiles(report.sent, report.nation), title: translateMessage(i18n, M.messages.troopSent) },
    { tiles: getTroopTiles(report.lost, report.nation), title: translateMessage(i18n, M.messages.losses) },
    { tiles: getTroopTiles(report.defeated), title: translateMessage(i18n, M.messages.defeated) },
    { tiles: getBuildingTiles(report.buildings), title: translateMessage(i18n, M.messages.buildings) },
    { tiles: getRewardTiles(report.goods, i18n), title: translateMessage(i18n, M.messages.rewards) }
  ]
});

export type ReportDetails = ReturnType<typeof getReportDetails>;

/** A scripted mail: its title, body (both in the active language), date, island and informative goods. */
export const getScriptMailDetails = (mail: ScriptMail, i18n?: I18n) => ({
  body: displayQuestText(mail.body, i18n),
  goods: getRewardTiles(
    Object.fromEntries((mail.attachments?.goods ?? []).map(line => [line.ware, line.amount])), i18n),
  goodsTitle: translateMessage(i18n, M.messages.attachments),
  meta: [mail.island, new Date(mail.date).toLocaleString(i18n?.locale)].filter(Boolean).join(" · "),
  title: displayQuestText(mail.title, i18n)
});

export type ScriptMailDetails = ReturnType<typeof getScriptMailDetails>;

/** The shown mail's view model: exactly one of the battle report or the scripted mail. */
export const getInboxDetails = (mail: InboxMail | undefined, i18n?: I18n) => {
  if (!mail) return { battle: undefined, script: undefined };
  if (isScriptMail(mail)) return { battle: undefined, script: getScriptMailDetails(mail, i18n) };
  return { battle: getReportDetails(mail, i18n), script: undefined };
};
