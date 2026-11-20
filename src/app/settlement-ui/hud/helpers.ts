import type { I18n, MessageDescriptor } from "@lingui/core";

import { getNationBuildingDefinition } from "../../../render-common/buildings/nation-building-text";
import { ROAD_APPEARANCE } from "../../../render-common/road-appearance";
import { translateMessage } from "../../../shared/i18n/translate";
import {
  isRoadVergeMode, type RoadVergeKind, roadVergeKindFromMode
} from "../../../shared/settlement/road-types";
import { INVENTORY_MESSAGES } from "../../player-inventory/messages";
import { CAMPAIGN_WINDOW_MESSAGES } from "../campaign-window/messages";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiSnapshot } from "../types";
import { HUD_MESSAGES } from "./messages";

/** What the bottom launcher bar depends on. */
export const selectBottomBar = (snapshot: SettlementUiSnapshot) => ({
  blocked: snapshot.buildingMenuBlocked === true,
  /** The campaign launcher belongs to the home island only (C8). */
  homeIsland: snapshot.homeIsland === true,
  minimapVisible: Boolean(snapshot.minimapVisible),
  notificationCount: snapshot.notifications?.length ?? 0
});

export type BottomBarState = ReturnType<typeof selectBottomBar>;
export type LauncherId = "build" | "campaign" | "inventory" | "map" | "menu" | "news" | "support";

export interface LauncherRow {
  /** `data-ui-anchor` (map script highlights): `bottomBar.<id>`. */
  anchor: string;
  className: string;
  disabled: boolean;
  icon: string;
  id: LauncherId;
  label: string;
  pressed?: boolean;
  title: string;
}

const LAUNCHER_CLASS = "settlement-ui__button settlement-ui__launcher";

const launcherRows = (
  { blocked, minimapVisible, notificationCount }: Omit<BottomBarState, "homeIsland">,
  i18n?: I18n
): Omit<LauncherRow, "anchor">[] => [
  {
    className: `${LAUNCHER_CLASS} settlement-ui__button--primary`,
    disabled: blocked,
    icon: "build",
    id: "build",
    label: translateMessage(i18n, HUD_MESSAGES.launcher.build),
    title: translateMessage(i18n, blocked ? HUD_MESSAGES.launcher.buildBlocked : HUD_MESSAGES.launcher.build)
  },
  {
    className: LAUNCHER_CLASS,
    disabled: false,
    icon: "inventory",
    id: "inventory",
    label: translateMessage(i18n, INVENTORY_MESSAGES.title),
    title: translateMessage(i18n, INVENTORY_MESSAGES.title)
  },
  {
    className: LAUNCHER_CLASS,
    disabled: false,
    icon: "map",
    id: "map",
    label: translateMessage(i18n, HUD_MESSAGES.launcher.map),
    pressed: minimapVisible,
    title: translateMessage(i18n, HUD_MESSAGES.launcher.map)
  },
  {
    className: LAUNCHER_CLASS,
    disabled: false,
    icon: "menu",
    id: "menu",
    label: translateMessage(i18n, HUD_MESSAGES.launcher.menu),
    title: translateMessage(i18n, HUD_MESSAGES.launcher.menu)
  },
  {
    className: LAUNCHER_CLASS,
    disabled: false,
    icon: "notice",
    id: "news",
    label: translateMessage(i18n, HUD_MESSAGES.launcher.news),
    title: translateMessage(i18n, HUD_MESSAGES.launcher.notifications, { count: notificationCount })
  }
];

const campaignLauncher = (i18n?: I18n): Omit<LauncherRow, "anchor"> => ({
  className: LAUNCHER_CLASS,
  disabled: false,
  icon: "campaign",
  id: "campaign",
  label: translateMessage(i18n, CAMPAIGN_WINDOW_MESSAGES.launcher),
  title: translateMessage(i18n, CAMPAIGN_WINDOW_MESSAGES.launcher)
});

/** The donation launcher stays the last icon on the bar, after News and Campaign. */
const supportLauncher = (i18n?: I18n): Omit<LauncherRow, "anchor"> => ({
  className: LAUNCHER_CLASS,
  disabled: false,
  icon: "support",
  id: "support",
  label: translateMessage(i18n, HUD_MESSAGES.launcher.support),
  title: translateMessage(i18n, HUD_MESSAGES.launcher.support)
});

/**
 * Build, Inventory, Map, Menu and News, icon only; the label is the accessible name, the title the tooltip.
 * `campaign`: the session offers campaigns; its launcher then shows on the home island only, before News.
 * Support is always appended last.
 */
export const getLauncherRows = (state: BottomBarState, i18n?: I18n, campaign = false): LauncherRow[] => {
  const rows = launcherRows(state, i18n);
  if (campaign && state.homeIsland) rows.splice(rows.length - 1, 0, campaignLauncher(i18n));
  rows.push(supportLauncher(i18n));
  return rows.map(row => ({ ...row, anchor: `bottomBar.${row.id}` }));
};

/** What the placement strip depends on. */
export const selectPlacement = (snapshot: SettlementUiSnapshot) => ({
  nation: snapshot.playerNation,
  roadMode: snapshot.roadMode ?? null,
  selected: snapshot.selectedBuilding ?? null,
  surveyJob: snapshot.surveyJob ?? null
});

export type PlacementState = ReturnType<typeof selectPlacement>;

const VERGE_PLACEMENT_MESSAGES: Readonly<Record<RoadVergeKind, MessageDescriptor>> = {
  flowers: M.build.vergeFlowers
};

const getPlacementName = ({ nation, roadMode, selected, surveyJob }: PlacementState, i18n?: I18n) => {
  if (surveyJob) return translateMessage(i18n, M.hud.placement.sendJob, { job: surveyJob });
  if (roadMode === "remove") return translateMessage(i18n, M.hud.placement.removeRoad);
  if (roadMode === "dirt") return translateMessage(i18n, M.hud.placement.buildDirtRoad);
  if (roadMode === "bridge-wood") return translateMessage(i18n, M.build.bridgeWood);
  if (roadMode === "bridge-stone") return translateMessage(i18n, M.build.bridgeStone);
  if (isRoadVergeMode(roadMode))
    return translateMessage(i18n, VERGE_PLACEMENT_MESSAGES[roadVergeKindFromMode(roadMode)]);
  if (roadMode) return translateMessage(i18n, M.hud.placement.roadUpgrade, {
    road: ROAD_APPEARANCE[roadMode].label
  });
  if (selected === null) return translateMessage(i18n, M.hud.placement.placeBuilding);
  return translateMessage(i18n, M.hud.placement.placeNamed, {
    name: getNationBuildingDefinition(selected, nation).name
  });
};

/** The strip shows while a building, road or survey tool is active; Rotate only for a building. */
export const getPlacementStrip = (state: PlacementState, i18n?: I18n) => ({
  hidden: state.selected === null && !state.roadMode && !state.surveyJob,
  name: getPlacementName(state, i18n),
  showRotate: state.selected !== null
});
