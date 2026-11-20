import type { I18n } from "@lingui/core";

import { getBuildingCategoryName } from "../building-category-labels";
import { BUILDING_MENU } from "../../../render-common/buildings/building-menu";
import { translateMessage } from "../../../shared/i18n/translate";
import { getSettlementBuildingRegister } from "../building-register";
import { SETTLEMENT_MESSAGES as M } from "../messages";
import type { SettlementUiSnapshot } from "../types";

export type BuildingRegisterEntry = ReturnType<typeof getSettlementBuildingRegister>[number];

/** Register entries in build menu order for the current buildings and nation. */
export const selectBuildingRegister = ({ buildableTypes, buildings, playerNation }: SettlementUiSnapshot) =>
  getSettlementBuildingRegister(buildings, playerNation, buildableTypes);

export interface BuildingRegisterGroup {
  entries: BuildingRegisterEntry[];
  id: string;
  label: string;
}

/** Keep each functional category, including empty categories. */
export const getBuildingRegisterGroups = (entries: readonly BuildingRegisterEntry[], i18n?: I18n): BuildingRegisterGroup[] =>
  BUILDING_MENU.map(group => ({
    entries: entries.filter(entry => entry.size === group.size),
    id: group.size,
    label: getBuildingCategoryName(group.id, i18n)
  }));

/** One card: counts as text, accessible name, tooltip and whether it can be visited. */
export const getBuildingRegisterCard = (
  { completed, id, name, sites }: BuildingRegisterEntry, i18n?: I18n
) => ({
  built: String(completed.length),
  disabled: !completed.length,
  id,
  label: translateMessage(i18n, M.register.cardLabel, {
    name, built: completed.length, sites
  }),
  name,
  sites: String(sites),
  title: translateMessage(i18n, M.register.cardTitle, {
    name, built: completed.length, sites
  })
});

/**
 * The completed building a card click visits: each click moves to the next one of that type, wrapping
 * around; undefined when none is complete. `visits` counts earlier clicks per type and is updated.
 */
export const getNextRegisterVisit = (entry: BuildingRegisterEntry, visits: Map<number, number>) => {
  if (!entry.completed.length) return undefined;
  const index = visits.get(entry.id) ?? 0;
  visits.set(entry.id, index + 1);
  return entry.completed[index % entry.completed.length];
};
