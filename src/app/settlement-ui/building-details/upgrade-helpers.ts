import type { I18n } from "@lingui/core";

import type { BuildingLevelFamily } from "../../../shared/balance/building-levels";
import { translateMessage } from "../../../shared/i18n/translate";
import {
  buildingLevelBenefits, type WorkshopUpgradeLevel, workshopUpgradeLevels
} from "../../../shared/settlement/building-level-benefits";
import { buildingLevelFamily } from "../../../shared/settlement/building-levels";
import { SAWMILL_TYPE_ID } from "../../../shared/settlement/building-type-ids";
import { wareDisplayName } from "../../../shared/settlement/ware-names";
import {
  isUpgradeableWorkshopType, maxWorkshopUpgradeLevel, workshopUpgradeCost
} from "../../../shared/settlement/workshop-upgrades";
import type { TooltipLine } from "../../components/info-tooltip-helpers";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary, SettlementUiOptions } from "../types";
import { getBuildingLevel } from "./construction-helpers";

const ROAD_BLOCKED = "Road not connected to storage";


/** The upgrade section exists for completed upgradeable buildings when the command is wired. */
export const hasWorkshopUpgrade = (building: SettlementBuildingSummary, options: SettlementUiOptions) =>
  Boolean(building.completed && isUpgradeableWorkshopType(building.type) && options.onWorkshopUpgrade);

const formatLevel = ({ benefits, level }: WorkshopUpgradeLevel, i18n?: I18n) =>
  translateMessage(i18n, M.details.upgrade.level, { benefits: benefits.join("; "), level });

/**
 * Tooltip of the upgrade info button: one line per upgrade level with what it gives; the next level is
 * marked (and reached levels say so). Empty for a building type without upgrade levels.
 */
export const getUpgradeBenefitLines = (
  typeId: number, currentLevel: number, i18n?: I18n
): TooltipLine[] => {
  const levels = workshopUpgradeLevels(typeId);
  if (!levels.length) return [];
  return [
    { text: translateMessage(i18n, M.details.upgrade.benefitsTitle) },
    ...levels.map(level => getBenefitLine(level, currentLevel, i18n))
  ];
};

const getBenefitLine = (
  level: WorkshopUpgradeLevel, currentLevel: number, i18n?: I18n
): TooltipLine => {
  const line = formatLevel(level, i18n);
  if (level.level <= currentLevel)
    return { text: translateMessage(i18n, M.details.upgrade.reached, { line }) };
  if (level.level === currentLevel + 1)
    return { marked: true, text: translateMessage(i18n, M.details.upgrade.next, { line }) };
  return { text: line };
};

/** What the building has now: "Now (level 2): +10% work speed." */
const getCurrentText = (typeId: number, level: number, berths: number | undefined, i18n?: I18n) => {
  const benefits = buildingLevelBenefits(typeId, level);
  const text = benefits.length ? benefits.join("; ") : translateMessage(i18n, M.details.upgrade.noBonus);
  if (berths === 1)
    return translateMessage(i18n, M.details.upgrade.currentBerth, { benefits: text, berths, level });
  if (berths && berths > 1)
    return translateMessage(i18n, M.details.upgrade.currentBerths, { benefits: text, berths, level });
  return translateMessage(i18n, M.details.upgrade.current, { benefits: text, level });
};

/** What the next level gives in total ("Level 3: +20% work speed."); null at the maximum. */
const getNextText = (typeId: number, level: number, atMaximum: boolean, i18n?: I18n) => {
  if (atMaximum) return null;
  return translateMessage(i18n, M.details.upgrade.nextLevel, {
    benefits: buildingLevelBenefits(typeId, level + 1).join("; "), level: level + 1
  });
};

const getCostItems = (
  building: SettlementBuildingSummary, cost: Readonly<Record<string, number>>, tracking: boolean, i18n?: I18n
) =>
  Object.entries(cost).map(([ware, required]) => {
    const name = wareDisplayName(ware);
    const delivered = building.upgradeDelivered?.[ware] ?? 0, incoming = building.upgradeIncoming?.[ware] ?? 0;
    return {
      text: tracking
        ? translateMessage(i18n, M.details.upgrade.costTracking, { delivered, incoming, name, required })
        : translateMessage(i18n, M.details.upgrade.cost, { name, required }),
      ware
    };
  });

/** "3 planks": a count and the lower-case ware name, as the upgrade sentences use them. */
const formatWareAmount = (count: number, ware: string) => `${count} ${wareDisplayName(ware).toLowerCase()}`;

const getMissingStock = (building: SettlementBuildingSummary, cost: Readonly<Record<string, number>>) =>
  Object.entries(cost).flatMap(([ware, count]) => {
    const unavailable = Math.max(0, count - (building.upgradeDelivered?.[ware] ?? 0) -
      (building.upgradeIncoming?.[ware] ?? 0) - (building.upgradeSupply?.[ware] ?? 0));
    return unavailable ? [formatWareAmount(unavailable, ware)] : [];
  });

/** What keeps working while the upgrade is under way, per upgrade family. */
const UPGRADE_ACTIVITY = Object.freeze({
  harbour: M.details.upgrade.activityHarbour,
  legacySawmill: M.details.upgrade.activityProduction,
  lookout: M.details.upgrade.activityTower,
  military: M.details.upgrade.activityGarrison,
  producer: M.details.upgrade.activityProduction,
  residence: M.details.upgrade.activityResidence,
  sawmill: M.details.upgrade.activityProduction,
  storage: M.details.upgrade.activityHarbour,
  tavern: M.details.upgrade.activityTavern
} as const satisfies Readonly<Record<BuildingLevelFamily, unknown>>);
const upgradeActivity = (type: number, i18n?: I18n) => {
  const family = buildingLevelFamily(type);
  return family ? translateMessage(i18n, UPGRADE_ACTIVITY[family]) : "";
};

const getUpgradeStatus = (building: SettlementBuildingSummary, costText: string, i18n?: I18n) => {
  const upgrade = building.workshopUpgrade;
  const activity = upgradeActivity(building.type, i18n);
  if (upgrade?.cancelling) return translateMessage(i18n, M.details.upgrade.statusCancelling);
  if (!upgrade?.requested)
    return translateMessage(i18n, M.details.upgrade.statusIdleWithActivity, { activity, cost: costText });
  const progress = Math.round((upgrade.progress ?? 0) * 100);
  if (progress > 0)
    return translateMessage(i18n, M.details.upgrade.statusProgressWithActivity, { activity, percent: progress });
  if (upgrade.builder !== undefined)
    return translateMessage(i18n, M.details.upgrade.statusTravellingWithActivity, { activity });
  return translateMessage(i18n, M.details.upgrade.statusWaiting);
};

/** Open part of the section (cost, status, supply, blockers and the request / cancel button). */
const getUpgradeRequest = (building: SettlementBuildingSummary, i18n?: I18n) => {
  const pending = building.workshopUpgrade?.requested === true;
  const cancelling = building.workshopUpgrade?.cancelling === true;
  const cost = workshopUpgradeCost({ typeId: building.type, workshopUpgrade: building.workshopUpgrade });
  const costText = Object.entries(cost).map(([ware, count]) => formatWareAmount(count, ware)).join(" and ");
  const missing = getMissingStock(building, cost);
  const roadBlocked = building.status === ROAD_BLOCKED;
  const supply = Object.keys(cost).map(ware => formatWareAmount(building.upgradeSupply?.[ware] ?? 0, ware)).join(", ");
  return {
    button: translateMessage(i18n, pending ? M.details.upgrade.cancelUpgrade : M.details.upgrade.upgrade),
    buttonTitle: pending
      ? translateMessage(i18n, M.details.upgrade.cancelTitle)
      : building.upgradeBlockedReason ?? translateMessage(i18n, M.details.upgrade.requires, { cost: costText }),
    cancel: pending,
    costItems: getCostItems(building, cost, pending || cancelling, i18n),
    disabled: cancelling || (!pending && (missing.length > 0 || building.upgradeAvailable === false || roadBlocked)),
    missing: missing.length && !cancelling
      ? translateMessage(i18n, M.details.upgrade.missing, { items: missing.join(", ") }) : null,
    roadBlocked: roadBlocked ? translateMessage(i18n, M.details.upgrade.roadBlocked) : null,
    status: getUpgradeStatus(building, costText, i18n),
    supply: translateMessage(i18n, M.details.upgrade.available, { supply })
  };
};

export type UpgradeRequestView = ReturnType<typeof getUpgradeRequest>;
/** Everything the shared upgrade confirmation shows; buildings and bridges each prepare one. */
export interface UpgradeView {
  benefitLines: TooltipLine[];
  confirmTitle: string;
  current: string;
  heading: string;
  next: string | null;
  note: string | null;
  request: UpgradeRequestView | null;
  showBenefits: boolean;
}

/** The whole upgrade section: heading, current and next level, tooltip lines and (below the maximum) the request part. */
export const getUpgradeView = (building: SettlementBuildingSummary, i18n?: I18n): UpgradeView => {
  const level = getBuildingLevel(building);
  const atMaximum = (building.workshopUpgrade?.level ?? 0) >= maxWorkshopUpgradeLevel(building.type);
  const benefitLines = getUpgradeBenefitLines(building.type, level, i18n);
  return {
    benefitLines,
    confirmTitle: translateMessage(i18n, M.details.upgrade.confirmTitle),
    current: getCurrentText(building.type, level, building.berths, i18n),
    heading: atMaximum
      ? translateMessage(i18n, M.details.upgrade.headingMax, { level })
      : translateMessage(i18n, M.details.upgrade.headingNext, { level: level + 1 }),
    next: getNextText(building.type, level, atMaximum, i18n),
    note: building.type === SAWMILL_TYPE_ID ? translateMessage(i18n, M.details.upgrade.sawmillNote) : null,
    request: atMaximum ? null : getUpgradeRequest(building, i18n),
    showBenefits: benefitLines.length > 0
  };
};
