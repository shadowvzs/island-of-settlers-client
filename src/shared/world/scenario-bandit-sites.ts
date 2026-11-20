import { banditByMilitaryBuilding, isBanditSiteRef } from "@shared/catalog";

import { banditCampPlan, banditMilitaryTypeId } from "../../render-common/buildings/bandit-camp-plan";
import { isSaveObject } from "../settlement/save-validation";

/**
 * A map-file building's bandit fields: none on a plain military building; otherwise a known `bandit:` code and
 * layout, the catalog's military building as `type`, and no more defenders than the layout holds.
 */
export const validScenarioBanditSite = (entry: {
  bandit?: unknown; defenders?: unknown; enclosure?: unknown; type?: unknown
}) => {
  if (entry.enclosure !== undefined && entry.enclosure !== "building") return false;
  if (entry.bandit === undefined) return true;
  if (!isBanditSiteRef(entry.bandit) || entry.type !== banditMilitaryTypeId(entry.bandit)) return false;
  return (entry.defenders as number) <= banditCampPlan(entry.bandit).capacity;
};

const convertRetiredBuilding = (entry: unknown) => {
  if (!isSaveObject(entry) || entry.model === undefined || entry.bandit !== undefined) return;
  const site = banditByMilitaryBuilding(entry.type as number);
  if (!site) return;
  entry.bandit = { code: site.code, layout: entry.model };
  delete entry.model;
};

/**
 * One-time conversion on load (BANDIT-CODES): map files before 2026-11-11 stored a bandit site as building type
 * 2/4/9 plus `model`; they now store `bandit: { code, layout }`. An entry it cannot convert keeps `model` and
 * fails the scenario check.
 */
export const convertRetiredScenarioBanditSites = (scenario: unknown) => {
  if (!isSaveObject(scenario) || !Array.isArray(scenario.buildings)) return;
  scenario.buildings.forEach(convertRetiredBuilding);
};
