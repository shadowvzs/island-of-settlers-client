import { emitBuildingUpgraded } from "../script-world/script-building-events";
import type { SettlementBuilding, SettlementContext } from "./settlement-types";
import {
  canUpgradeWorkshop, finishWorkshopUpgrade, maxWorkshopUpgradeLevel, workshopUpgradeCost
} from "./workshop-upgrades";

export type DebugBuildingLevelResult =
  | { level: number; ok: true; typeId: number }
  | { ok: false; reason: string; typeId?: number };

const refusal = (reason: string, building?: SettlementBuilding): DebugBuildingLevelResult =>
  ({ ok: false, reason, typeId: building?.typeId });

/** Why a building cannot rise; the maximum names the panel level (1 + saved upgrade level). */
const levelRefusal = (building: SettlementBuilding) => {
  const maxLevel = maxWorkshopUpgradeLevel(building.typeId);
  if (!maxLevel) return "this building has no levels";
  if (!canUpgradeWorkshop(building)) return "only finished buildings you own can be raised";
  const upgrade = building.workshopUpgrade;
  if (upgrade?.requested || upgrade?.cancelling) return "finish or cancel its pending upgrade first";
  if ((upgrade?.level ?? 0) >= maxLevel) return `already at its maximum level ${maxLevel + 1}`;
  return undefined;
};

/**
 * Development tool "Raise building level": completes one upgrade level now, without cost or builder.
 * The free cost is reserved as a real request, then the normal completion (`finishWorkshopUpgrade`)
 * consumes it, so the saved level and everything derived from it match a real upgrade.
 */
export const debugRaiseBuildingLevel = (context: SettlementContext, uid: number): DebugBuildingLevelResult => {
  const building = context.buildings.find(entry => entry.uid === uid);
  if (!building) return refusal("no building there");
  const reason = levelRefusal(building);
  if (reason) return refusal(reason, building);
  const level = building.workshopUpgrade?.level ?? 0;
  building.workshopUpgrade = { incoming: {}, level, requested: true, reserved: {} };
  building.workshopUpgrade.reserved = { ...workshopUpgradeCost(building) };
  if (!finishWorkshopUpgrade(building)) {
    building.workshopUpgrade = level ? { level } : undefined;
    return refusal("the upgrade could not be completed", building);
  }
  context.roadDecorations?.changedBuilding(building);
  if (context.script) emitBuildingUpgraded(context, building);
  return { level: 1 + building.workshopUpgrade!.level, ok: true, typeId: building.typeId };
};
