import type { I18n, MessageDescriptor } from "@lingui/core";
import { RESOURCE_TIER_MINIMUM_LEVEL, ROAD_SPEED } from "@shared/catalog/balance";

import { BUILDING_MENU } from "../../../render-common/buildings/building-menu";
import { getNationBuildingDefinition } from "../../../render-common/buildings/nation-building-text";
import { ROAD_APPEARANCE } from "../../../render-common/road-appearance";
import { isWorkerNation } from "../../../render-common/workers/worker-appearance";
import { displayBuildingRole } from "../../../shared/i18n/building-role";
import { displayBuildingName, displayJobName, displayWareName } from "../../../shared/i18n/domain";
import { translateMessage } from "../../../shared/i18n/translate";
import type { BridgeRoadMode } from "../../../shared/settlement/bridge-construction";
import { getConstructionCost } from "../../../shared/settlement/construction-costs";
import {
  BRIDGE_MAX_TILES,
  BRIDGE_MIN_TILES,
  ROAD_TIERS,
  ROAD_VERGE_KINDS,
  type RoadTier,
  type RoadVergeKind,
  type RoadVergeMode,
  roadVergeMode} from "../../../shared/settlement/road-types";
import type { SurveyJob } from "../../../shared/settlement/settlement-surveying";
import { COLONY_RESOURCE_TIERS } from "../../../shared/world/colony-resource-tiers";
import { joinClassNames } from "../../components/helpers";
import { getBuildingCategoryName } from "../building-category-labels";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiSnapshot } from "../types";

/** Road utility card; survey dispatch now belongs to terrain dialogs. */
export interface BuildToolRow {
  caption?: string;
  icon?: string;
  id: RoadTier | BridgeRoadMode | RoadVergeMode | "remove" | SurveyJob;
  label: string;
  pressed: boolean;
  title: string;
  ware?: string;
}

const SURVEY_JOBS: readonly SurveyJob[] = ["Geologist", "Scout"];

export const isSurveyJob = (id: BuildToolRow["id"]): id is SurveyJob => SURVEY_JOBS.includes(id as SurveyJob);

const lower = (tier: RoadTier) => ROAD_APPEARANCE[tier].label.toLowerCase();

const getPavedTitle = (tier: RoadTier, i18n?: I18n) => {
  const previous = ROAD_TIERS[ROAD_TIERS.indexOf(tier) - 1]!;
  return translateMessage(i18n, M.build.pavedTitle, {
    previous: lower(previous), speed: Math.round(ROAD_SPEED[tier] * 100), tier: lower(tier)
  });
};

/** What the road / survey toolbar depends on. */
export const selectBuildTools = (snapshot: SettlementUiSnapshot) => ({
  level: snapshot.player?.level ?? 1,
  roadMode: snapshot.roadMode ?? null,
  surveyJob: snapshot.surveyJob ?? null
});

type BuildToolState = ReturnType<typeof selectBuildTools>;

export interface RoadCard extends BuildToolRow {
  className: string;
  id: RoadTier | BridgeRoadMode | RoadVergeMode;
  locked: boolean;
  lockText: string | null;
  speed: string;
}

/** Advanced paving follows the existing resource-level bands; no stock or colony ownership gate. */
export const getRoadLockLevel = (tier: RoadTier, level: number): number | undefined => {
  const resource = COLONY_RESOURCE_TIERS.find(pair => pair.stone === tier);
  if (!resource) return undefined;
  const required = RESOURCE_TIER_MINIMUM_LEVEL[resource.tier];
  return level < required ? required : undefined;
};

interface VergeCardMessages {
  cost: MessageDescriptor;
  label: MessageDescriptor;
  title: MessageDescriptor;
}

/** One Road-tab card per saved verge kind; a new kind adds its messages here and one enum entry. */
const VERGE_CARD_MESSAGES: Readonly<Record<RoadVergeKind, VergeCardMessages>> = {
  flowers: { cost: M.build.vergeFlowersCost, label: M.build.vergeFlowers, title: M.build.vergeFlowersTitle }
};

export const getRoadCardRows = ({ level, roadMode }: BuildToolState, i18n?: I18n): RoadCard[] => {
  const tierCards = ROAD_TIERS.map(tier => {
    const required = getRoadLockLevel(tier, level);
    const locked = required !== undefined;
    const label = translateMessage(i18n, M.build.road, { road: ROAD_APPEARANCE[tier].label });
    let title = tier === "dirt"
      ? translateMessage(i18n, M.build.dirtTitle)
      : getPavedTitle(tier, i18n);
    if (locked) title = translateMessage(i18n, M.build.lockedTitle, {
      label, reason: getBuildingLockText(required, level, i18n)
    });
    return {
      className: joinClassNames("settlement-ui__card", locked && "settlement-ui__card--locked"),
      id: tier, label, locked, lockText: locked ? translateMessage(i18n, M.common.levelBadge, { level: required }) : null,
      pressed: roadMode === tier,
      speed: translateMessage(i18n, M.build.speed, { speed: Math.round(ROAD_SPEED[tier] * 100) }), title
    };
  });
  const bridgeCard = (id: BridgeRoadMode, label: string, cost: string): RoadCard => ({
    className: "settlement-ui__card",
    id,
    label,
    locked: false,
    lockText: null,
    pressed: roadMode === id,
    speed: translateMessage(i18n, M.build.bridgeDeck),
    title: translateMessage(i18n, M.build.bridgeTitle, {
      cost, kind: label, max: BRIDGE_MAX_TILES, min: BRIDGE_MIN_TILES
    })
  });
  const vergeCards = ROAD_VERGE_KINDS.map((kind): RoadCard => {
    const id = roadVergeMode(kind), messages = VERGE_CARD_MESSAGES[kind];
    return {
      className: "settlement-ui__card",
      id,
      label: translateMessage(i18n, messages.label),
      locked: false,
      lockText: null,
      pressed: roadMode === id,
      speed: translateMessage(i18n, messages.cost),
      title: translateMessage(i18n, messages.title)
    };
  });
  return [
    ...tierCards,
    bridgeCard("bridge-wood", translateMessage(i18n, M.build.bridgeWood),
      translateMessage(i18n, M.build.bridgeCostWood)),
    bridgeCard("bridge-stone", translateMessage(i18n, M.build.bridgeStone),
      translateMessage(i18n, M.build.bridgeCostStone)),
    ...vergeCards
  ];
};

/** Remove road is shown as a large card inside the Roads tab. */
export const getBuildToolRows = (state: BuildToolState, _canSurvey: boolean, i18n?: I18n): BuildToolRow[] => [
  { caption: translateMessage(i18n, M.build.removeRoad), icon: "cancel", id: "remove",
    label: translateMessage(i18n, M.build.removeRoad), pressed: state.roadMode === "remove",
    title: translateMessage(i18n, M.build.removeRoadTitle) }
];

/** The home sandbox switch's state: absent off the home island. */
export const selectHomeSandbox = (snapshot: SettlementUiSnapshot) => snapshot.homeSandbox;

export interface HomeSandboxButton {
  label: string;
  pressed: boolean;
  title: string;
}

/** The Build view's compact home sandbox toggle; null where the island has none (colonies, campaigns). */
export const getHomeSandboxButton = (enabled: boolean | undefined, i18n?: I18n): HomeSandboxButton | null => {
  if (enabled === undefined) return null;
  return {
    label: translateMessage(i18n, M.build.homeSandbox),
    pressed: enabled,
    title: translateMessage(i18n, enabled ? M.build.homeSandboxOnTitle : M.build.homeSandboxOffTitle)
  };
};

/** Picker categories: the menu groups without the headquarters (never placed from the picker). */
export const BUILDING_PICKER_GROUPS = BUILDING_MENU
  .map(group => ({ ...group, buildings: group.buildings.filter(building => building.id !== 0) }))
  .filter(group => group.buildings.length > 0);

/** What the building picker depends on; the allowed types and locks compare by value (new arrays each tick). */
export const selectBuildingPicker = (snapshot: SettlementUiSnapshot) => ({
  allowed: snapshot.buildableTypes?.join(","),
  built: snapshot.builtBuildings ?? "",
  highlight: snapshot.buildHighlight ?? "",
  highlightRevision: snapshot.buildHighlightRevision ?? 0,
  level: snapshot.player?.level ?? 1,
  locked: snapshot.lockedBuildings ?? "",
  nation: snapshot.playerNation,
  selected: snapshot.selectedBuilding ?? null,
  tierBlocked: snapshot.tierBlockedBuildings ?? "",
  tierCap: snapshot.buildingTierCap ?? 5
});

export type BuildingPickerState = ReturnType<typeof selectBuildingPicker>;

export interface BuildingCard {
  className: string;
  description: string;
  hidden: boolean;
  id: number;
  /** "Lv N" badge of a building the player's level still locks; null when unlocked. */
  lockText: string | null;
  locked: boolean;
  materials: readonly { count: number; name: string; ware: string }[];
  name: string;
  pressed: boolean;
  size: string;
  title: string;
}

const parseAllowed = (allowed: string | undefined) =>
  allowed === undefined ? undefined : new Set(allowed.split(",").filter(Boolean).map(Number));

const parseBuildingTypes = (types: string) => types.split(",").filter(Boolean).map(Number);

/** The picker category of the first highlighted building (the first category when none). */
export const getHighlightTabIndex = (highlight: string) => {
  const [first] = parseBuildingTypes(highlight);
  const index = BUILDING_PICKER_GROUPS.findIndex(group => group.buildings.some(building => building.id === first));
  return Math.max(index, 0) + 1;
};

/** Unlock level by type from "type:level" pairs. */
export const parseLockedBuildings = (locked: string) => new Map(locked.split(",").filter(Boolean)
  .map(pair => pair.split(":").map(Number) as [number, number]));

/** The line a locked card shows on hover and, after a tap, under the cards. */
export const getBuildingLockText = (unlockLevel: number, level: number, i18n?: I18n) =>
  translateMessage(i18n, M.build.requiresLevel, { level: unlockLevel, levelNow: level });

type CardLockSource = Pick<BuildingPickerState, "built" | "level" | "locked" | "tierBlocked" | "tierCap">;

/**
 * Why a card is disabled: a built one-off building, the map's tier cap, else the level it still needs; null
 * when free (MAP BUILDING AVAILABILITY: blocked items stay visible, greyed with the reason).
 */
const getCardLockReason = (
  { built, level, locked, tierBlocked, tierCap }: CardLockSource, id: number, i18n?: I18n
) => {
  if (parseBuildingTypes(built).includes(id)) return translateMessage(i18n, M.build.alreadyBuilt);
  const tier = parseLockedBuildings(tierBlocked).get(id);
  if (tier !== undefined) return translateMessage(i18n, M.build.requiresTier, { cap: tierCap, tier });
  const lockLevel = parseLockedBuildings(locked).get(id);
  return lockLevel === undefined ? null : getBuildingLockText(lockLevel, level, i18n);
};

/** The line under the cards after a tap on a disabled card (phones have no hover title). */
export const getCardLockNotice = (picker: BuildingPickerState, id: number | null, i18n?: I18n) =>
  id === null ? null : getCardLockReason(picker, id, i18n);

/** The short badge of a disabled card: "Already built", "Tier N" or "Lv N"; null when free. */
const getCardBadge = (
  built: boolean, lockLevel: number | undefined, tier: number | undefined, i18n?: I18n
) => {
  if (built) return translateMessage(i18n, M.build.alreadyBuilt);
  if (tier !== undefined) return translateMessage(i18n, M.build.tierBadge, { tier });
  return lockLevel === undefined ? null : translateMessage(i18n, M.common.levelBadge, { level: lockLevel });
};

const getCardTitle = (name: string, role: string, reason: string | null, i18n?: I18n) => {
  if (reason === null) return translateMessage(i18n, M.build.cardTitle, { name, role });
  return translateMessage(i18n, M.build.cardLockedTitle, { name, reason });
};

/** Cards per category; slots 5-7 carry the nation's names, colonies hide types they do not offer. */
export const getBuildingCardGroups = (picker: BuildingPickerState, i18n?: I18n) => {
  const { allowed, built, highlight, locked, nation, selected, tierBlocked } = picker;
  const allowedTypes = parseAllowed(allowed);
  const builtTypes = new Set(parseBuildingTypes(built));
  const highlighted = new Set(parseBuildingTypes(highlight));
  const lockedTypes = parseLockedBuildings(locked);
  const tierTypes = parseLockedBuildings(tierBlocked);
  return BUILDING_PICKER_GROUPS.map(group => ({
    id: group.id,
    name: getBuildingCategoryName(group.id, i18n),
    cards: group.buildings.map(({ gridFootprint, id }): BuildingCard => {
      const name = displayBuildingName(id, nation, i18n);
      const description = displayBuildingRole(id, nation, i18n);
      const lockLevel = lockedTypes.get(id);
      const isBuilt = builtTypes.has(id);
      const tier = tierTypes.get(id);
      const isLocked = isBuilt || lockLevel !== undefined || tier !== undefined;
      return {
        className: joinClassNames("settlement-ui__card", isLocked && "settlement-ui__card--locked",
          highlighted.has(id) && "settlement-ui__card--new"),
        description,
        hidden: Boolean(allowedTypes) && !allowedTypes!.has(id),
        id,
        lockText: getCardBadge(isBuilt, lockLevel, tier, i18n),
        locked: isLocked,
        materials: Object.entries(getConstructionCost(id, isWorkerNation(nation) ? nation : undefined))
          .filter(([, count]) => count > 0)
          .map(([ware, count]) => ({ count, name: displayWareName(ware, i18n), ware })),
        name,
        pressed: id === selected,
        size: `${gridFootprint[0]} × ${gridFootprint[1]}`,
        title: getCardTitle(name, description, getCardLockReason(picker, id, i18n), i18n)
      };
    })
  }));
};

/** The line under the cards: a tapped locked card's requirement, the selection, else a hint. */
export const getSelectionDetail = (
  { nation, selected }: BuildingPickerState, lockNotice: string | null = null, i18n?: I18n
) => {
  if (lockNotice) return lockNotice;
  if (selected === null) return translateMessage(i18n, M.build.chooseHint);
  return translateMessage(i18n, M.build.selectedDetail, {
    name: displayBuildingName(selected, nation, i18n),
    role: displayBuildingRole(selected, nation, i18n),
    worker: displayJobName(getNationBuildingDefinition(selected, nation).worker, i18n)
  });
};
