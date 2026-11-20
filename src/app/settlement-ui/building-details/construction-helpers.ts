import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { getSettlementInventoryEntries } from "../inventory";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary } from "../types";

/** Saved upgrade level zero is the base building, presented to players as level one. */
export const getBuildingLevel = (building: Pick<SettlementBuildingSummary, "workshopUpgrade">) =>
  1 + (building.workshopUpgrade?.level ?? 0);

/** "Level N" and what is happening to it: construction, an upgrade or its cancellation. */
export const getBuildingLevelLabel = (building: SettlementBuildingSummary, i18n?: I18n) => {
  const level = getBuildingLevel(building);
  const text = getLevelText(building, level, i18n);
  return { level: String(level), suffix: "", text };
};

const getLevelText = (building: SettlementBuildingSummary, level: number, i18n?: I18n) => {
  if (building.completed === false)
    return translateMessage(i18n, M.details.levelUnderConstruction, { level });
  if (building.workshopUpgrade?.cancelling)
    return translateMessage(i18n, M.details.levelCancelling, { level });
  if (building.workshopUpgrade?.requested)
    return translateMessage(i18n, M.details.levelUpgrading, { level, next: level + 1 });
  return translateMessage(i18n, M.details.level, { level });
};

/**
 * A planned building has construction materials, never operating stock or production controls:
 * progress, ground preparation while unfinished, why it waits and one row per required material.
 */
export const getConstructionDetails = (building: SettlementBuildingSummary, i18n?: I18n) => {
  const construction = building.construction;
  const progress = construction?.progress ?? 0;
  const foundation = construction && construction.foundationProgress < 1
    ? translateMessage(i18n, M.details.construction.ground, {
      percent: Math.round(construction.foundationProgress * 100)
    })
    : null;
  const materials = getSettlementInventoryEntries(construction?.required).map(({ count, name, ware }) => ({
    delivered: String((building.input?.[ware] ?? 0) + (construction?.consumed[ware] ?? 0)),
    incoming: String(construction?.incoming[ware] ?? 0),
    name,
    required: String(count),
    ware
  }));
  return {
    blocker: building.blockageHint
      ? translateMessage(i18n, M.details.whyWaiting, { reason: building.blockageHint }) : null,
    foundation,
    materials,
    progress,
    progressText: translateMessage(i18n, M.details.construction.progress, {
      percent: Math.round(progress * 100)
    }),
    showMaterials: Boolean(construction && Object.keys(construction.required).length),
    status: building.status ?? translateMessage(i18n, M.details.construction.waiting)
  };
};

export type ConstructionDetailsView = ReturnType<typeof getConstructionDetails>;
