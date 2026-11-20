import type { I18n } from "@lingui/core";

import { translateMessage } from "../../../shared/i18n/translate";
import { DEFAULT_FARM_RADIUS } from "../../../shared/settlement/settlement-farm-area";
import { STONEMASON_RADIUS } from "../../../shared/settlement/settlement-stone-area";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementBuildingSummary } from "../types";

/** Read-only farm work range and live field / stock counts; farmers choose fields automatically. */
export const getFarmArea = (building: SettlementBuildingSummary, i18n?: I18n) => {
  const flax = building.farmWare === "flax";
  return {
    counts: [
      { label: translateMessage(i18n, M.details.workArea.growing), value: String(building.farmGrowing ?? 0) },
      { label: translateMessage(i18n, M.details.workArea.ready), value: String(building.farmRipe ?? 0) },
      { label: translateMessage(i18n, flax ? M.details.workArea.storedFlax : M.details.workArea.storedWheat),
        value: `${(flax ? building.farmFlax : building.farmWheat) ?? 0} / 6` }
    ],
    data: { "data-farm-uid": building.id },
    description: translateMessage(i18n,
      flax ? M.details.workArea.flaxDescription : M.details.workArea.farmDescription, { radius: DEFAULT_FARM_RADIUS }),
    heading: translateMessage(i18n, flax ? M.details.workArea.flaxHeading : M.details.workArea.farmHeading),
    icon: "grain",
    label: translateMessage(i18n, flax ? M.details.workArea.flaxAria : M.details.workArea.farmAria),
    location: translateMessage(i18n, M.details.workArea.farmLocation)
  };
};

/** Read-only stonemason range and stock; the stonemason searches for rocks himself. */
export const getStoneArea = (building: SettlementBuildingSummary, i18n?: I18n) => ({
  counts: [{ label: translateMessage(i18n, M.details.workArea.storedStone), value: `${building.stoneOutput ?? 0} / 6` }],
  data: { "data-stone-uid": building.id },
  description: translateMessage(i18n, M.details.workArea.stoneDescription, { radius: STONEMASON_RADIUS }),
  heading: translateMessage(i18n, M.details.workArea.stoneHeading),
  icon: "build",
  label: translateMessage(i18n, M.details.workArea.stoneAria),
  location: translateMessage(i18n, M.details.workArea.stoneLocation)
});

export type WorkAreaView = ReturnType<typeof getFarmArea> | ReturnType<typeof getStoneArea>;
